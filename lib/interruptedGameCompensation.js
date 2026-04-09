'use strict';

const mongoRouter = require('./mongoRouter');
const { grantInterruptedGameGoodwill, refreshLeaderboard, addScore } = require('./db');
const models = require('../models');

const INTERRUPT_LEDGER_PREFIX = 'interrupt:';

/** Discord snowflake user id (excludes SYSTEM). */
function isDiscordUserId(v) {
    if (v == null) return false;
    const s = String(v).trim();
    if (s === 'SYSTEM') return false;
    return /^\d{17,20}$/.test(s);
}

/**
 * Best-effort: persisted `Game.state` does not always list everyone who played (e.g. Trivia clickers
 * before first score, Movie Quotes / Name That Tune / Spelling Bee rarely sync scores to Mongo).
 * @param {{ type?: string, state?: object }} gameDoc
 * @returns {string[]}
 */
function extractParticipantIdsFromPersistedGame(gameDoc) {
    const ids = new Set();
    const state = gameDoc.state;
    const type = gameDoc.type;
    if (!state || typeof state !== 'object') {
        return [];
    }

    function addKey(id) {
        if (!isDiscordUserId(id)) return;
        ids.add(String(id));
    }
    function addObj(obj) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
        for (const k of Object.keys(obj)) addKey(k);
    }
    function addArr(arr) {
        if (!Array.isArray(arr)) return;
        for (const x of arr) addKey(x);
    }

    if (type === 'Giveaway') {
        addArr(state.participants);
        return [...ids];
    }

    addObj(state.scores);
    addObj(state.players);
    addObj(state.guesses);
    addObj(state.playerStats);
    addArr(state.participants);
    addArr(state.winners);

    return [...ids];
}

function getCrashCompensationPoints() {
    const raw = process.env.PLAYBOUND_CRASH_COMPENSATION_POINTS;
    if (raw === undefined || raw === '') {
        return 25;
    }
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < 0) {
        return 0;
    }
    return n;
}

/**
 * Extract a sorted leaderboard from persisted Game.state.
 * Returns array of { uid, score } sorted by score descending.
 * @param {{ type?: string, state?: object }} gameDoc
 * @returns {{ uid: string, score: number }[]}
 */
function extractSortedScores(gameDoc) {
    const state = gameDoc.state;
    if (!state || typeof state !== 'object') return [];

    const scoreMap = new Map();
    function addScores(obj) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
        for (const [uid, val] of Object.entries(obj)) {
            if (!isDiscordUserId(uid)) continue;
            const n = typeof val === 'object'
                ? (val.score ?? val.wins ?? val.timeTaken ?? 0)
                : Number(val) || 0;
            if (n > 0) scoreMap.set(uid, Math.max(scoreMap.get(uid) || 0, n));
        }
    }

    addScores(state.scores);
    addScores(state.players);
    addScores(state.playerStats);

    return [...scoreMap.entries()]
        .map(([uid, score]) => ({ uid, score }))
        .sort((a, b) => b.score - a.score);
}

/**
 * Log + award placement credits when recovery concludes a game that was not resumed.
 * If persisted scores exist, awards placement points (1st/2nd/3rd from pointValues).
 * Otherwise falls back to flat goodwill credits.
 * Idempotent per game via InterruptedGameLog.gameMongoId; per-user via ledger marker.
 * @param {import('discord.js').Client} client
 * @param {import('mongoose').Document} gameDoc active Game row
 * @returns {Promise<{ participantCount: number, compensatedCount: number, pointsPerUser: number, skipped: boolean, placementAwarded: boolean }>}
 */
async function compensateUnresumableGameOnRecovery(client, gameDoc) {
    const guildId = String(gameDoc.guildId);
    const flatPoints = getCrashCompensationPoints();

    return mongoRouter.runWithGuild(guildId, async () => {
        const { InterruptedGameLog, User } = models;

        const extractedParticipantIds = extractParticipantIdsFromPersistedGame(gameDoc);
        const sorted = extractSortedScores(gameDoc);
        const pointValues = gameDoc.state?.pointValues;
        const hasPlacementData = sorted.length > 0 && Array.isArray(pointValues) && pointValues.length > 0;

        let log;
        let skipped = false;
        try {
            log = await InterruptedGameLog.create({
                guildId,
                channelId: gameDoc.channelId || null,
                threadId: gameDoc.threadId || null,
                gameType: gameDoc.type,
                gameMongoId: gameDoc._id,
                reason: 'bot_restart_unresumable',
                participantIds: extractedParticipantIds,
                pointsGrantedPerUser: hasPlacementData ? 0 : flatPoints,
                usersCompensated: 0,
            });
        } catch (e) {
            if (!e || e.code !== 11000) {
                throw e;
            }
            skipped = true;
            log = await InterruptedGameLog.findOne({ gameMongoId: gameDoc._id });
        }

        if (skipped) {
            return {
                participantCount: extractedParticipantIds.length,
                compensatedCount: log?.usersCompensated || 0,
                pointsPerUser: log?.pointsGrantedPerUser || 0,
                skipped: true,
                placementAwarded: false,
            };
        }

        const participantIds = Array.from(new Set([
            ...((log && Array.isArray(log.participantIds)) ? log.participantIds : []),
            ...extractedParticipantIds,
        ]));

        let compensatedCount = 0;
        const gameTag = String(gameDoc.type || '').toLowerCase().replace(/\s+/g, '');

        if (hasPlacementData) {
            // Award placement points based on persisted scores
            for (let i = 0; i < sorted.length; i++) {
                const pts = i < pointValues.length ? Number(pointValues[i]) || 1 : 1;
                await addScore(client, guildId, sorted[i].uid, pts, null, false, gameTag);
                compensatedCount++;
            }
            // Participation credit for anyone who played but didn't place
            const placedIds = new Set(sorted.map((s) => s.uid));
            for (const uid of participantIds) {
                if (!placedIds.has(uid)) {
                    await addScore(client, guildId, uid, 1, null, false, gameTag);
                    compensatedCount++;
                }
            }
        } else if (flatPoints > 0) {
            // Fallback: flat goodwill for everyone
            for (const uid of participantIds) {
                await grantInterruptedGameGoodwill(guildId, uid, gameDoc._id, flatPoints);
                compensatedCount++;
            }
        }

        if (compensatedCount > 0) {
            await refreshLeaderboard(client, guildId);
        }

        if (log) {
            log.set({
                guildId,
                channelId: gameDoc.channelId || null,
                threadId: gameDoc.threadId || null,
                gameType: gameDoc.type,
                gameMongoId: gameDoc._id,
                reason: 'bot_restart_unresumable',
                participantIds,
                pointsGrantedPerUser: hasPlacementData ? -1 : flatPoints,
                usersCompensated: compensatedCount,
            });
            await log.save();
        }

        return {
            participantCount: participantIds.length,
            compensatedCount,
            pointsPerUser: hasPlacementData ? -1 : flatPoints,
            skipped: false,
            placementAwarded: hasPlacementData,
        };
    });
}

/**
 * Build a human-readable partial-results summary from whatever scores are persisted in Game.state.
 * Returns an empty string if no scores are available.
 * @param {{ type?: string, state?: object }} gameDoc
 * @returns {string}
 */
function buildPartialResultsSummary(gameDoc) {
    const sorted = extractSortedScores(gameDoc);
    if (sorted.length === 0) return '';

    const lines = sorted.slice(0, 10).map(({ uid, score }, i) =>
        `${i + 1}. <@${uid}> \u2014 **${score}** pts`,
    );
    if (sorted.length > 10) lines.push(`_...and ${sorted.length - 10} more_`);
    return '\n\n\ud83d\udcca **Partial standings at time of interruption:**\n' + lines.join('\n');
}

module.exports = {
    extractParticipantIdsFromPersistedGame,
    extractSortedScores,
    getCrashCompensationPoints,
    compensateUnresumableGameOnRecovery,
    buildPartialResultsSummary,
};
