'use strict';

const { isChallengeRanked } = require('../rankedFactionWar');

const MAX_WAR_LEDGER_ENTRIES = 50_000;

/** Weights for `weighted_top5` final-hour slice (deterministic, length 5). */
const WEIGHTED_TOP5_WEIGHTS = [1, 0.85, 0.7, 0.55, 0.4];

function teamNamesFromChallenge(challenge) {
    if (Array.isArray(challenge.battleFactions) && challenge.battleFactions.length >= 2) {
        return challenge.battleFactions;
    }
    return [challenge.factionA, challenge.factionB];
}

function extractParticipants(challenge, factionName) {
    if (Array.isArray(challenge.battleFactions) && challenge.battleFactions.length >= 2) {
        const m = challenge.participantsByFaction;
        if (!m) return [];
        if (typeof m.get === 'function') {
            const arr = m.get(factionName);
            return Array.isArray(arr) ? [...arr] : [];
        }
        const arr = m[factionName];
        return Array.isArray(arr) ? [...arr] : [];
    }
    if (factionName === challenge.factionA) return [...(challenge.participantsA || [])];
    if (factionName === challenge.factionB) return [...(challenge.participantsB || [])];
    return [];
}

function getPhaseBounds(challenge) {
    const created = challenge.createdAt ? new Date(challenge.createdAt) : new Date();
    const endAt = new Date(challenge.endAt);
    const prepMs = Math.max(0, Number(challenge.prepMinutes) || 0) * 60000;
    const fhMs = Math.max(0, Number(challenge.finalHourMinutes) || 0) * 60000;
    const prepEnds = challenge.prepEndsAt ? new Date(challenge.prepEndsAt) : new Date(created.getTime() + prepMs);
    let fhStart = challenge.finalHourStartsAt ? new Date(challenge.finalHourStartsAt) : new Date(endAt.getTime() - fhMs);
    if (fhStart.getTime() < prepEnds.getTime()) fhStart = prepEnds;
    if (fhStart.getTime() > endAt.getTime()) fhStart = endAt;
    return { prepEnds, fhStart, endAt, created };
}

/**
 * @param {object} challenge
 * @param {Date} [now]
 * @returns {'prep'|'active'|'final_hour'|'ended'}
 */
function getWarPhase(challenge, now = new Date()) {
    const { prepEnds, fhStart, endAt } = getPhaseBounds(challenge);
    const t = now.getTime();
    if (t < prepEnds.getTime()) return 'prep';
    if (t < fhStart.getTime()) return 'active';
    if (t <= endAt.getTime()) return 'final_hour';
    return 'ended';
}

function _sum(values) {
    return values.reduce((a, b) => a + b, 0);
}

function _avgPositive(values) {
    const pos = values.filter((v) => v > 0);
    if (pos.length === 0) return 0;
    return pos.reduce((a, b) => a + b, 0) / pos.length;
}

function _topNAvg(values, n) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => b - a);
    const take = Math.min(n, sorted.length);
    const top = sorted.slice(0, take);
    return top.reduce((a, b) => a + b, 0) / take;
}

function _valueForRaw(raw, mode, topN) {
    if (mode === 'total_points') return _sum(raw);
    if (mode === 'avg_points') return _avgPositive(raw);
    return _topNAvg(raw, topN);
}

/**
 * Aggregate per-user final-hour totals for a roster using final-hour mode.
 * @param {number[]} fhByUser — one entry per enrolled user (order matches roster walk)
 */
function aggregateFinalHourSlice(fhByUser, finalHourMode) {
    const vals = fhByUser.map((x) => Math.max(0, Number(x) || 0)).filter((x) => x > 0);
    const sorted = [...vals].sort((a, b) => b - a);
    const top5 = sorted.slice(0, 5);
    if (finalHourMode === 'weighted_top5') {
        let s = 0;
        for (let i = 0; i < top5.length; i++) s += top5[i] * (WEIGHTED_TOP5_WEIGHTS[i] ?? 0);
        return s;
    }
    /** `top5_only` and `featured_only` (pre-filtered) use sum of top-5 individual totals. */
    return _sum(top5);
}

/**
 * Split ledger into pre-final-hour and final-hour per-user counted sums.
 * @param {object[]} ledger
 * @param {number} fhStartMs
 * @param {string} finalHourMode
 * @param {Set<string>} warFeaturedTags
 */
function partitionLedger(ledger, fhStartMs, finalHourMode, warFeaturedTags) {
    const preMap = Object.create(null);
    const fhMap = Object.create(null);
    const featured =
        finalHourMode === 'featured_only'
            ? warFeaturedTags instanceof Set
                ? warFeaturedTags
                : new Set((warFeaturedTags || []).map((t) => String(t).toLowerCase()))
            : null;

    for (const row of ledger || []) {
        const at = new Date(row.at).getTime();
        const uid = String(row.userId || '');
        const c = Math.max(0, Math.floor(Number(row.counted) || 0));
        const tag = String(row.gameTag || '').toLowerCase();
        if (!uid || c <= 0) continue;

        if (at < fhStartMs) {
            preMap[uid] = (preMap[uid] || 0) + c;
        } else if (finalHourMode === 'featured_only') {
            if (featured.has(tag)) fhMap[uid] = (fhMap[uid] || 0) + c;
        } else {
            fhMap[uid] = (fhMap[uid] || 0) + c;
        }
    }
    return { preMap, fhMap };
}

function shouldUseLedgerForOfficialScore(challenge) {
    if (!isChallengeRanked(challenge)) return false;
    const mode = challenge.finalHourMode || 'none';
    if (!mode || mode === 'none') return false;
    const ledger = challenge.warPointLedger;
    return Array.isArray(ledger) && ledger.length > 0;
}

/**
 * Official team values for winner / embeds. Uses ledger + final-hour rules when configured.
 * @param {object} challenge — FactionChallenge doc
 * @param {object} legacy — { getScoreByUser } from factionChallenge legacy path
 */
function computeOfficialTeamValues(challenge, legacy) {
    const names = teamNamesFromChallenge(challenge);
    const n = Math.max(1, challenge.topN || 5);
    let label = '';
    if (challenge.scoringMode === 'total_points') label = 'Total points (enrolled)';
    else if (challenge.scoringMode === 'avg_points') label = 'Average (players with >0 pts)';
    else label = `Top ${n} average`;

    if (!shouldUseLedgerForOfficialScore(challenge)) {
        const teams = names.map((name) => {
            const ids = extractParticipants(challenge, name);
            const raw = ids.map((uid) => legacy.getScoreByUser(challenge, uid));
            const value = _valueForRaw(raw, challenge.scoringMode, n);
            return { name, value, raw };
        });
        return { teams, label, usedLedger: false, finalHourMode: challenge.finalHourMode || 'none' };
    }

    const { fhStart } = getPhaseBounds(challenge);
    const fhMs = fhStart.getTime();
    const mode = challenge.finalHourMode;
    const warTags = new Set((challenge.warFeaturedTags || []).map((t) => String(t).toLowerCase()));
    const { preMap, fhMap } = partitionLedger(challenge.warPointLedger, fhMs, mode, warTags);

    label += ` · final hour: **${mode}** (ledger + capped base)`;

    const teams = names.map((name) => {
        const ids = extractParticipants(challenge, name);
        const preArr = ids.map((uid) => Number(preMap[uid] || 0));
        const fhArr = ids.map((uid) => Number(fhMap[uid] || 0));
        const preVal = _valueForRaw(preArr, challenge.scoringMode, n);
        const fhVal = aggregateFinalHourSlice(fhArr, mode);
        const value = preVal + fhVal;
        const raw = ids.map((uid) => Number(preMap[uid] || 0) + Number(fhMap[uid] || 0));
        return { name, value, raw, preVal, fhVal };
    });

    return { teams, label, usedLedger: true, finalHourMode: mode };
}

module.exports = {
    MAX_WAR_LEDGER_ENTRIES,
    WEIGHTED_TOP5_WEIGHTS,
    getPhaseBounds,
    getWarPhase,
    partitionLedger,
    aggregateFinalHourSlice,
    computeOfficialTeamValues,
    shouldUseLedgerForOfficialScore,
    teamNamesFromChallenge,
    extractParticipants,
};
