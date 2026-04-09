'use strict';

const { FactionChallenge, Faction, SystemConfig } = require('../models');
const { automatedServerPostsEnabled } = require('./automatedPosts');
const { isGuildExcludedFromGlobalCounts } = require('./publicStatsExclude');
const { isChallengeRanked } = require('./rankedFactionWar');
const { recordRankedWarSeasonStats } = require('./factionSeasons');
const { getSettings } = require('./gamePlatform/configStore');
const {
    evaluateFactionWarCreditEligibility,
    FactionCreditReasonCode,
    isHostedScoreTag,
} = require('./gameClassification');
const { playboundDebugLog } = require('./playboundDebug');

const FACTION_SWITCH_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
/** Same window as faction switch: free players who **leave** wait this long before `/faction join` again. */
const FACTION_JOIN_AFTER_LEAVE_COOLDOWN_MS = FACTION_SWITCH_COOLDOWN_MS;

const { ROYALE_FACTIONS } = require('./globalFactions');

/**
 * Tags must match /faction_challenge create game_type choices.
 * Pass null from addScore for non-game sources (welcome, redirects, etc.) — those never count.
 */
const { VALID_TAGS } = require('./factionChallengeTags');

function isRoyale(challenge) {
    return Array.isArray(challenge.battleFactions) && challenge.battleFactions.length >= 2;
}

function teamNames(challenge) {
    if (isRoyale(challenge)) return challenge.battleFactions;
    return [challenge.factionA, challenge.factionB];
}

function getParticipantIds(challenge, factionName) {
    if (isRoyale(challenge)) {
        const m = challenge.participantsByFaction;
        if (!m) return [];
        if (typeof m.get === 'function') {
            const arr = m.get(factionName);
            return Array.isArray(arr) ? [...arr] : [];
        }
        const arr = m[factionName];
        return Array.isArray(arr) ? [...arr] : [];
    }
    if (factionName === challenge.factionA) return [...challenge.participantsA];
    if (factionName === challenge.factionB) return [...challenge.participantsB];
    return [];
}

/** @returns {boolean} true if this faction’s roster is at cap (join should be rejected). */
function isRosterFullForFaction(challenge, factionName) {
    const cap = challenge.maxPerTeam;
    if (cap == null || cap <= 0) return false;
    return getParticipantIds(challenge, factionName).length >= cap;
}

function getScoreByUser(challenge, userId) {
    const m = challenge.scoresByUser;
    if (!m) return 0;
    if (typeof m.get === 'function') return Number(m.get(userId) || 0);
    return Number(m[userId] || m[String(userId)] || 0);
}

function getRawScoreByUser(challenge, userId) {
    const m = challenge.rawScoresByUser;
    if (!m || typeof m.get !== 'function') return getScoreByUser(challenge, userId);
    if (m.size === 0) return getScoreByUser(challenge, userId);
    return Number(m.get(userId) || 0);
}

function ensureDualLedgerMigrated(challenge) {
    if (!challenge.rawScoresByUser || typeof challenge.rawScoresByUser.get !== 'function') {
        challenge.rawScoresByUser = new Map();
        challenge.markModified('rawScoresByUser');
    }
    if (!challenge.countedPointsByUserTag || typeof challenge.countedPointsByUserTag.get !== 'function') {
        challenge.countedPointsByUserTag = new Map();
        challenge.markModified('countedPointsByUserTag');
    }
    if (challenge.rawScoresByUser.size === 0 && challenge.scoresByUser && challenge.scoresByUser.size > 0) {
        for (const [uid, sc] of challenge.scoresByUser) {
            challenge.rawScoresByUser.set(uid, Number(sc) || 0);
        }
        challenge.markModified('rawScoresByUser');
    }
}

function teamRawPointSum(challenge, factionName) {
    let sum = 0;
    for (const uid of getParticipantIds(challenge, factionName)) {
        sum += getRawScoreByUser(challenge, uid);
    }
    return sum;
}

function buildRankedRulesSnapshot(partial) {
    return {
        challengeMode: partial.challengeMode || 'ranked',
        scoringMode: partial.scoringMode,
        topN: partial.topN,
        maxPerTeam: partial.maxPerTeam ?? null,
        gameTypes: partial.gameTypes || [],
        contributionCapsByTag: partial.contributionCapsByTag || null,
        pointCap: partial.pointCap ?? null,
    };
}

function challengeGameTypesList(challenge) {
    if (Array.isArray(challenge.gameTypes) && challenge.gameTypes.length > 0) {
        return challenge.gameTypes;
    }
    return [challenge.gameType || 'all'];
}

function formatChallengeGameFilterLabel(challenge) {
    const list = challengeGameTypesList(challenge);
    if (list.length === 1) return list[0];
    if (list.includes('all')) return 'all';
    return list.join(', ');
}

/**
 * When a member leaves a faction (or server), keep `Faction.members` in sync. Global `Faction.totalPoints`
 * come only from ended challenges, not from Arena score.
 */
async function reconcileFactionTotalsForLeavingMember(factionName, _userCompetitivePoints, guildId) {
    if (!factionName) return;
    if (guildId != null && isGuildExcludedFromGlobalCounts(guildId)) return;
    const fac = await Faction.findOne({ name: factionName });
    if (!fac) return;
    fac.members = Math.max(0, (fac.members || 0) - 1);
    await fac.save();
}

/** Drop user from all active challenge rosters and their challenge score bucket. */
async function removeUserFromFactionChallengeEnrollment(guildId, userId) {
    const list = await FactionChallenge.find({ guildId, status: 'active' });
    for (const ch of list) {
        let touched = false;
        if (isRoyale(ch)) {
            const names = teamNames(ch);
            for (const name of names) {
                const before = getParticipantIds(ch, name);
                const arr = before.filter((id) => id !== userId);
                if (arr.length !== before.length) touched = true;
                ch.participantsByFaction.set(name, arr);
            }
            ch.markModified('participantsByFaction');
        } else {
            const la = ch.participantsA.filter((id) => id !== userId);
            const lb = ch.participantsB.filter((id) => id !== userId);
            if (la.length !== ch.participantsA.length || lb.length !== ch.participantsB.length) touched = true;
            ch.participantsA = la;
            ch.participantsB = lb;
        }
        if (ch.scoresByUser && ch.scoresByUser.has(userId)) {
            if (typeof ch.scoresByUser.delete === 'function') ch.scoresByUser.delete(userId);
            else ch.scoresByUser.set(userId, undefined);
            ch.markModified('scoresByUser');
            touched = true;
        }
        if (ch.rawScoresByUser && ch.rawScoresByUser.has(userId)) {
            if (typeof ch.rawScoresByUser.delete === 'function') ch.rawScoresByUser.delete(userId);
            ch.markModified('rawScoresByUser');
            touched = true;
        }
        if (ch.countedPointsByUserTag && typeof ch.countedPointsByUserTag.keys === 'function') {
            const prefix = `${userId}::`;
            for (const key of [...ch.countedPointsByUserTag.keys()]) {
                if (String(key).startsWith(prefix)) {
                    ch.countedPointsByUserTag.delete(key);
                    touched = true;
                }
            }
            if (touched) ch.markModified('countedPointsByUserTag');
        }
        if (touched) await ch.save();
    }
}

async function grantFactionVictoryRoleIfConfigured(client, guildId, winnerFaction, challenge) {
    if (!winnerFaction || !client) return;
    const config = await SystemConfig.findOne({ guildId }).lean();
    const roleId = config?.factionVictoryRoleId;
    if (!roleId) return;
    const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return;
    const ids = getParticipantIds(challenge, winnerFaction);
    for (const uid of ids) {
        const m = await guild.members.fetch(uid).catch(() => null);
        if (m) await m.roles.add(roleId).catch(() => {});
    }
}

function buildEndgameGlobalMergePayload(challenge) {
    const names = teamNames(challenge);
    const rawTotals = {};
    const countedPlayers = {};
    for (const n of names) {
        rawTotals[n] = Math.round(teamRawPointSum(challenge, n));
        countedPlayers[n] = getParticipantIds(challenge, n).length;
    }
    const { teams, label } = computeTeamValues(challenge);
    const officialByFaction = {};
    for (const t of teams) {
        officialByFaction[t.name] = Number(Number(t.value).toFixed(4));
    }
    const winnerFaction = pickChallengeWinner(challenge);
    const matchPointsByFaction = {};
    const winsInc = {};
    const lossesInc = {};
    const tiesInc = {};
    for (const n of names) {
        matchPointsByFaction[n] = 0;
        winsInc[n] = 0;
        lossesInc[n] = 0;
        tiesInc[n] = 0;
    }

    let summaryLine = '';
    if (names.length === 2) {
        const [a, b] = names;
        if (!winnerFaction) {
            matchPointsByFaction[a] = 1;
            matchPointsByFaction[b] = 1;
            tiesInc[a] = 1;
            tiesInc[b] = 1;
            summaryLine = 'Tie — each team earns **1** match point toward global standings.';
        } else {
            const loser = winnerFaction === a ? b : a;
            matchPointsByFaction[winnerFaction] = 3;
            matchPointsByFaction[loser] = 0;
            winsInc[winnerFaction] = 1;
            lossesInc[loser] = 1;
            summaryLine = `**${winnerFaction}** wins — **+3** match points (opponent **+0**).`;
        }
    } else {
        if (!winnerFaction) {
            for (const n of names) {
                matchPointsByFaction[n] = 1;
                tiesInc[n] = 1;
            }
            summaryLine = `${names.length}-way tie — each faction earns **1** match point.`;
        } else {
            for (const n of names) {
                if (n === winnerFaction) {
                    matchPointsByFaction[n] = 3;
                    winsInc[n] = 1;
                } else {
                    matchPointsByFaction[n] = 0;
                    lossesInc[n] = 1;
                }
            }
            summaryLine = `**${winnerFaction}** wins the royale — **+3** match points (others **+0**).`;
        }
    }

    const scoringSummary = `${label}. Official scores: ${teams.map((t) => `${t.name} ${t.value.toFixed(2)}`).join(' · ')}`;

    return {
        rawTotals,
        officialByFaction,
        countedPlayers,
        matchPointsByFaction,
        winsInc,
        lossesInc,
        tiesInc,
        summaryLine,
        scoringSummary,
    };
}

/**
 * Idempotent: snapshot totals, then for **ranked** wars credit global **match points** (and secondary raw totals).
 * **Unranked** wars store snapshots only — no global faction updates.
 */
async function applyEndedChallengeToGlobalTotals(_client, _guildId, challengeId) {
    const ch = await FactionChallenge.findById(challengeId).exec();
    if (!ch || ch.status !== 'ended') return;

    const payload = buildEndgameGlobalMergePayload(ch);

    const updated = await FactionChallenge.findOneAndUpdate(
        { _id: challengeId, status: 'ended', globalTotalsApplied: { $ne: true } },
        {
            $set: {
                globalTotalsApplied: true,
                finalRawTotalsByFaction: payload.rawTotals,
                officialScoreByFaction: payload.officialByFaction,
                countedPlayersByFaction: payload.countedPlayers,
                matchPointsAwarded: payload.matchPointsByFaction,
                rankedResultSummary: payload.summaryLine,
                scoringSummary: payload.scoringSummary,
            },
        },
        { returnDocument: 'after' },
    );
    if (!updated) return;

    if (isGuildExcludedFromGlobalCounts(updated.guildId)) return;

    if (!isChallengeRanked(updated)) return;

    for (const name of teamNames(updated)) {
        const mp = Math.round(Number(payload.matchPointsByFaction[name] || 0));
        const w = Math.round(Number(payload.winsInc[name] || 0));
        const l = Math.round(Number(payload.lossesInc[name] || 0));
        const t = Math.round(Number(payload.tiesInc[name] || 0));
        const rawTot = Math.round(Number(payload.rawTotals[name] || 0));
        const inc = {};
        if (mp) inc.matchPoints = mp;
        if (w) inc.rankedWins = w;
        if (l) inc.rankedLosses = l;
        if (t) inc.rankedTies = t;
        if (rawTot > 0) inc.rawWarContributionTotal = rawTot;
        if (Object.keys(inc).length === 0) continue;
        await Faction.updateOne({ name }, { $inc: inc }).catch(() => {});
    }

    await recordRankedWarSeasonStats(updated.guildId, updated, payload).catch((e) =>
        console.error('[FactionSeasons] recordRankedWarSeasonStats', e),
    );
}

async function tryFinalizeChallengeOnPointCap(client, guildId, ch) {
    if (!ch.pointCap || ch.pointCap <= 0 || ch.status !== 'active') return;
    if (isChallengeRanked(ch)) return;
    const names = teamNames(ch);
    const sums = names.map((name) => ({ name, sum: teamRawPointSum(ch, name) }));
    if (!sums.some((x) => x.sum >= ch.pointCap)) return;
    const max = Math.max(...sums.map((x) => x.sum));
    const leaders = sums.filter((x) => x.sum === max);
    ch.status = 'ended';
    ch.endedAt = new Date();
    ch.winnerFaction = leaders.length === 1 ? leaders[0].name : null;
    await ch.save();
    await applyEndedChallengeToGlobalTotals(client, guildId, ch._id);
    await grantFactionVictoryRoleIfConfigured(client, guildId, ch.winnerFaction, ch);
    const { grantWarEndPersonalCredits } = require('./factionWarEconomyPayout');
    await grantWarEndPersonalCredits(client, guildId, ch._id);
    if (!client || !client.channels) return;
    const config = await SystemConfig.findOne({ guildId }).lean();
    const chanId = config?.announceChannel;
    if (!chanId) return;
    if (!automatedServerPostsEnabled(config)) return;
    let chan = client.channels.cache.get(chanId);
    if (!chan) chan = await client.channels.fetch(chanId).catch(() => null);
    if (!chan || !chan.send) return;
    const w = ch.winnerFaction || 'Tie';
    await chan
        .send({
            content:
                `🏁 **Faction challenge ended** — **point goal (${Number(ch.pointCap).toLocaleString()})** reached!\n` +
                `Winner: **${w}**`,
        })
        .catch(() => {});
}

function matchesGameFilter(challenge, scoreTag) {
    if (scoreTag == null) return false;
    const types = challengeGameTypesList(challenge);
    if (types.includes('all')) return true;
    return types.includes(scoreTag);
}

/**
 * If a game with this tag would run while an active challenge is still live (and the tag matches the
 * challenge filter), returns a short staff-facing notice. Otherwise null.
 * @param {import('mongoose').Document|null} challenge
 * @param {number} delayMs ms until the game starts (0 = now)
 * @param {string|null|undefined} gameTag addScore tag (e.g. trivia, moviequotes)
 * @returns {string|null}
 */
function buildFactionChallengeOverlapWarning(challenge, delayMs, gameTag) {
    if (!challenge || gameTag == null || gameTag === '') return null;
    const delay = Math.max(0, Number(delayMs) || 0);
    const gameStart = new Date(Date.now() + delay);
    const endAt = new Date(challenge.endAt);
    if (gameStart.getTime() >= endAt.getTime()) return null;
    if (!matchesGameFilter(challenge, gameTag)) return null;
    const filter = formatChallengeGameFilterLabel(challenge);
    const endTs = Math.floor(endAt.getTime() / 1000);
    const ranked = isChallengeRanked(challenge);
    const hosted = isHostedScoreTag(gameTag);
    const rankedHostedNote =
        ranked && hosted
            ? ' **Hosted games never count toward ranked wars** — only **/playgame** official games do.'
            : ranked
              ? ' **Official ranked** wars count **/playgame** games only (ranked-eligible tags).'
              : ' **Casual** wars can include hosted games if the filter allows.';
    return (
        `⚠️ **Faction challenge overlap:** A war is active until <t:${endTs}:R>. ` +
        `**${gameTag}** may credit **${ranked ? 'ranked' : 'casual'}** war points only when rules allow — enrolled players only. ` +
        `Filter: \`${filter}\`.` +
        rankedHostedNote
    );
}

async function getFactionChallengeOverlapWarning(guildId, delayMs, gameTag) {
    if (gameTag == null || gameTag === '') return null;
    const ch = await getActiveChallenge(guildId);
    return buildFactionChallengeOverlapWarning(ch, delayMs, gameTag);
}

/**
 * @param {object} params
 * @param {string} params.guildId
 * @param {string} params.userId
 * @param {string|null|undefined} params.factionName
 * @param {number} params.points — base in-game award only (before streak / premium / consumables / host aura)
 * @param {string|null|undefined} params.gameTag
 * @param {import('discord.js').Client|null} [params.client]
 * @returns {Promise<{ credited: boolean, reasonCode: string, userMessage: string|null, pointsAdded?: number }>}
 */
async function recordFactionChallengePoints({ client, guildId, userId, factionName, points, gameTag }) {
    if (!factionName || !points || points <= 0) {
        return { credited: false, reasonCode: FactionCreditReasonCode.NO_POINTS_OR_FACTION, userMessage: null };
    }
    if (gameTag == null || gameTag === '') {
        return { credited: false, reasonCode: FactionCreditReasonCode.NO_GAME_TAG, userMessage: null };
    }

    const challenge = await getActiveChallengeForFaction(guildId, factionName);
    if (!challenge) {
        return { credited: false, reasonCode: FactionCreditReasonCode.NO_ACTIVE_CHALLENGE, userMessage: null };
    }

    const settings = await getSettings();
    const elig = evaluateFactionWarCreditEligibility(challenge, gameTag, settings);
    if (!elig.ok) {
        playboundDebugLog(
            `[faction-war-skip] guild=${guildId} user=${userId} tag=${gameTag} reason=${elig.reasonCode} ${elig.logDetail}`,
        );
        return { credited: false, reasonCode: elig.reasonCode, userMessage: elig.userMessage };
    }

    const names = teamNames(challenge);
    if (!names.includes(factionName)) {
        return { credited: false, reasonCode: FactionCreditReasonCode.WRONG_FACTION, userMessage: null };
    }

    const sideList = getParticipantIds(challenge, factionName);
    if (!sideList.includes(userId)) {
        return { credited: false, reasonCode: FactionCreditReasonCode.NOT_ENROLLED, userMessage: null };
    }

    const ch = await FactionChallenge.findById(challenge._id);
    if (!ch || ch.status !== 'active') {
        return { credited: false, reasonCode: FactionCreditReasonCode.NO_ACTIVE_CHALLENGE, userMessage: null };
    }

    ensureDualLedgerMigrated(ch);

    const rawCur = getRawScoreByUser(ch, userId);
    const countedCur = getScoreByUser(ch, userId);

    let addCounted = points;
    const caps = ch.contributionCapsByTag;
    if (isChallengeRanked(ch) && caps && typeof caps === 'object') {
        const cap = caps[gameTag];
        if (cap != null && Number.isFinite(Number(cap)) && Number(cap) > 0) {
            const capN = Math.max(0, Math.round(Number(cap)));
            const k = `${userId}::${gameTag}`;
            const prev = ch.countedPointsByUserTag.get(k) || 0;
            const room = Math.max(0, capN - prev);
            addCounted = Math.min(points, room);
            ch.countedPointsByUserTag.set(k, prev + addCounted);
            ch.markModified('countedPointsByUserTag');
        }
    }

    ch.rawScoresByUser.set(userId, rawCur + points);
    ch.markModified('rawScoresByUser');
    ch.scoresByUser.set(userId, countedCur + addCounted);
    ch.markModified('scoresByUser');
    await ch.save();
    await tryFinalizeChallengeOnPointCap(client, guildId, ch);
    return {
        credited: true,
        reasonCode: FactionCreditReasonCode.CREDITED,
        userMessage: null,
        pointsAdded: addCounted,
        rawPointsAdded: points,
    };
}

function _scoresRawForTeam(challenge, factionName) {
    const ids = getParticipantIds(challenge, factionName);
    const arr = [];
    for (const uid of ids) {
        arr.push(getScoreByUser(challenge, uid));
    }
    return arr;
}

function _topNAvg(values, n) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => b - a);
    const take = Math.min(n, sorted.length);
    const top = sorted.slice(0, take);
    return top.reduce((a, b) => a + b, 0) / take;
}

function _avgPositive(values) {
    const pos = values.filter((v) => v > 0);
    if (pos.length === 0) return 0;
    return pos.reduce((a, b) => a + b, 0) / pos.length;
}

function _sum(values) {
    return values.reduce((a, b) => a + b, 0);
}

function _valueForRaw(raw, mode, topN) {
    if (mode === 'total_points') return _sum(raw);
    if (mode === 'avg_points') return _avgPositive(raw);
    return _topNAvg(raw, topN);
}

/**
 * All competing teams with aggregate scores (duel = 2 teams, royale = 3).
 */
function computeTeamValues(challenge) {
    const names = teamNames(challenge);
    const n = Math.max(1, challenge.topN || 5);
    let label = '';
    if (challenge.scoringMode === 'total_points') label = 'Total points (enrolled)';
    else if (challenge.scoringMode === 'avg_points') label = 'Average (players with >0 pts)';
    else label = `Top ${n} average`;

    const teams = names.map((name) => {
        const raw = _scoresRawForTeam(challenge, name);
        const value = _valueForRaw(raw, challenge.scoringMode, n);
        return { name, value, raw };
    });
    return { teams, label };
}

/**
 * Backward-compatible shape for duel; includes `teams` for multi-faction status UIs.
 */
function computeScores(challenge) {
    const { teams, label } = computeTeamValues(challenge);
    const [t0, t1] = teams;
    return {
        valueA: t0?.value ?? 0,
        valueB: t1?.value ?? 0,
        label,
        rawA: t0?.raw ?? [],
        rawB: t1?.raw ?? [],
        teams,
    };
}

function pickWinner(valueA, valueB, factionA, factionB) {
    if (valueA > valueB) return factionA;
    if (valueB > valueA) return factionB;
    return null;
}

/** Winner faction name, or null if tie / no teams. */
function pickChallengeWinner(challenge) {
    const { teams } = computeTeamValues(challenge);
    if (teams.length === 0) return null;
    const max = Math.max(...teams.map((t) => t.value));
    const leaders = teams.filter((t) => t.value === max);
    if (leaders.length !== 1) return null;
    return leaders[0].name;
}

/**
 * @deprecated Use {@link getActiveChallengeForFaction} for faction-specific lookup
 * or {@link getAllActiveChallenges} for all active wars. This function returns only
 * one arbitrary active war and does not support multiple concurrent wars per guild.
 */
async function getActiveChallenge(guildId) {
    return FactionChallenge.findOne({
        guildId,
        status: 'active',
        endAt: { $gt: new Date() },
    });
}

/**
 * Find the active war that includes the given faction.
 * @param {string} guildId
 * @param {string} factionName — canonical faction name
 * @returns {Promise<import('mongoose').Document|null>}
 */
async function getActiveChallengeForFaction(guildId, factionName) {
    const active = await FactionChallenge.find({
        guildId,
        status: 'active',
        endAt: { $gt: new Date() },
    });
    for (const ch of active) {
        if (teamNames(ch).includes(factionName)) return ch;
    }
    return null;
}

/**
 * Return all active wars in a guild.
 * @param {string} guildId
 * @returns {Promise<import('mongoose').Document[]>}
 */
async function getAllActiveChallenges(guildId) {
    return FactionChallenge.find({
        guildId,
        status: 'active',
        endAt: { $gt: new Date() },
    });
}

/**
 * True if this user is on the active challenge roster for their faction (duel or royale).
 */
async function isUserEnrolledInActiveFactionChallenge(guildId, userId, factionName) {
    if (!factionName || !userId) return false;
    const ch = await getActiveChallengeForFaction(guildId, factionName);
    if (!ch) return false;
    return getParticipantIds(ch, factionName).includes(userId);
}

/**
 * Marks expired challenges as ended and sets winnerFaction (may be null for ties).
 */
async function expireStaleChallenges(guildId, client = null) {
    const now = new Date();
    const stale = await FactionChallenge.find({
        guildId,
        status: 'active',
        endAt: { $lte: now },
    });
    for (const ch of stale) {
        ch.status = 'ended';
        ch.endedAt = now;
        ch.winnerFaction = pickChallengeWinner(ch);
        await ch.save();
        await applyEndedChallengeToGlobalTotals(client, guildId, ch._id);
        await grantFactionVictoryRoleIfConfigured(client, guildId, ch.winnerFaction, ch);
        const { grantWarEndPersonalCredits } = require('./factionWarEconomyPayout');
        await grantWarEndPersonalCredits(client, guildId, ch._id);
    }
}

async function checkFactionOverlap(guildId, factionNames) {
    const active = await FactionChallenge.find({
        guildId,
        status: 'active',
        endAt: { $gt: new Date() },
    });
    for (const ch of active) {
        const existing = teamNames(ch);
        const overlap = factionNames.filter(f => existing.includes(f));
        if (overlap.length > 0) {
            return { conflict: true, factions: overlap, endAt: ch.endAt };
        }
    }
    return { conflict: false };
}

module.exports = {
    isChallengeRanked,
    buildRankedRulesSnapshot,
    getScoreByUser,
    getRawScoreByUser,
    ROYALE_FACTIONS,
    /** Game-type tags passed to addScore; also used to detect competitive ledger lines. */
    VALID_TAGS,
    FACTION_SWITCH_COOLDOWN_MS,
    FACTION_JOIN_AFTER_LEAVE_COOLDOWN_MS,
    matchesGameFilter,
    buildFactionChallengeOverlapWarning,
    getFactionChallengeOverlapWarning,
    recordFactionChallengePoints,
    computeScores,
    computeTeamValues,
    pickWinner,
    pickChallengeWinner,
    isRoyale,
    teamNames,
    getParticipantIds,
    isRosterFullForFaction,
    teamRawPointSum,
    formatChallengeGameFilterLabel,
    challengeGameTypesList,
    getActiveChallenge,
    getActiveChallengeForFaction,
    getAllActiveChallenges,
    isUserEnrolledInActiveFactionChallenge,
    expireStaleChallenges,
    reconcileFactionTotalsForLeavingMember,
    removeUserFromFactionChallengeEnrollment,
    grantFactionVictoryRoleIfConfigured,
    tryFinalizeChallengeOnPointCap,
    applyEndedChallengeToGlobalTotals,
    checkFactionOverlap,
};
