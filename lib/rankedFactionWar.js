'use strict';

const { assertValidGameType } = require('./factionChallengeDefaults');
const { GLOBAL_FACTION_KEYS } = require('./globalFactions');

/** @typedef {'ranked'|'unranked'} ChallengeMode */

const RANKED_DEFAULT_ROSTER_CAP = 7;
const RANKED_FIXED_SCORING_MODE = 'top_n_avg';
const RANKED_FIXED_TOP_N = 5;
/** User-facing label for official ranked wars (slash create always uses fixed mode + top N). */
const RANKED_SCORING_DISPLAY_LABEL = `Top ${RANKED_FIXED_TOP_N} average`;
/** Slash `/faction_challenge` ranked creates use v2 rules (roster cap optional; no built-in default cap). */
const RANKED_SLASH_CREATE_WAR_VERSION = 2;

function challengeModeOf(docOrMode) {
    if (docOrMode == null) return 'ranked';
    if (typeof docOrMode === 'string') return docOrMode === 'unranked' ? 'unranked' : 'ranked';
    const m = docOrMode.challengeMode;
    return m === 'unranked' ? 'unranked' : 'ranked';
}

function isChallengeRanked(challenge) {
    return challengeModeOf(challenge) === 'ranked';
}

/**
 * @param {string|null|undefined} capsCsv e.g. "trivia:500,unscramble:200"
 * @returns {Record<string, number>|null}
 */
function parseContributionCapsCsv(capsCsv) {
    if (capsCsv == null || !String(capsCsv).trim()) return null;
    const out = {};
    for (const part of String(capsCsv).split(',')) {
        const [tagRaw, limRaw] = part.split(':').map((s) => s && s.trim());
        if (!tagRaw || limRaw == null) continue;
        const tag = tagRaw.toLowerCase();
        if (!assertValidGameType(tag) || tag === 'all') continue;
        const lim = Math.round(Number(limRaw));
        if (!Number.isFinite(lim) || lim <= 0) continue;
        out[tag] = lim;
    }
    return Object.keys(out).length ? out : null;
}

/**
 * @param {object} params
 * @param {ChallengeMode} params.challengeMode
 * @param {number|null|undefined} params.pointCap
 * @param {number|null|undefined} params.maxPerTeam
 * @param {string} params.scoringMode
 * @param {number} params.topN
 * @returns {string[]}
 */
function validateChallengeCreateParams({ challengeMode, pointCap, maxPerTeam, scoringMode, topN, warVersion }) {
    const errs = [];
    const ranked = challengeMode !== 'unranked';
    if (ranked) {
        if (pointCap != null && pointCap > 0) {
            errs.push('Official ranked wars cannot use a point goal — that rule is for casual challenges only.');
        }
        if (warVersion !== 2 && (maxPerTeam == null || maxPerTeam < 1)) {
            errs.push(`Official ranked wars need a roster cap (try **max_per_team** ${RANKED_DEFAULT_ROSTER_CAP}, or set a server default).`);
        }
        if (scoringMode !== RANKED_FIXED_SCORING_MODE) {
            errs.push(`Official ranked wars use **top ${RANKED_FIXED_TOP_N} average** scoring only.`);
        }
        if (!Number.isFinite(topN) || topN !== RANKED_FIXED_TOP_N) {
            errs.push(`Official ranked wars use **top_n** **${RANKED_FIXED_TOP_N}** only.`);
        }
    }
    return errs;
}

/**
 * @param {import('../models').SystemConfig|null} config
 * @returns {number}
 */
function rankedDefaultRosterCapFromConfig(config) {
    const v = config?.factionRankedDefaultRosterCap;
    if (v != null && Number.isFinite(Number(v)) && Number(v) >= 1) return Math.min(25, Math.max(1, Math.round(Number(v))));
    return RANKED_DEFAULT_ROSTER_CAP;
}

/**
 * @param {import('../models').SystemConfig|null} config
 * @returns {Record<string, number>|null}
 */
function rankedContributionCapsFromConfig(config) {
    const caps = config?.factionRankedContributionCapsByTag;
    if (!caps || typeof caps !== 'object') return null;
    const out = {};
    for (const [k, v] of Object.entries(caps)) {
        const lim = Math.round(Number(v));
        if (!k || !Number.isFinite(lim) || lim <= 0) continue;
        const tag = String(k).toLowerCase();
        if (!assertValidGameType(tag) || tag === 'all') continue;
        out[tag] = lim;
    }
    return Object.keys(out).length ? out : null;
}

/**
 * Validate v2 faction selection: 2–6 unique factions from GLOBAL_FACTION_KEYS.
 * @param {string[]} factions
 * @returns {string[]} error messages (empty = valid)
 */
function validateV2FactionSelection(factions) {
    const errs = [];
    if (!Array.isArray(factions)) { errs.push('Factions must be an array.'); return errs; }
    const unique = [...new Set(factions)];
    if (unique.length !== factions.length) {
        errs.push('Duplicate factions are not allowed.');
    }
    if (unique.length < 2 || unique.length > 6) {
        errs.push('Select **2–6** factions for a ranked war.');
        return errs;
    }
    for (const f of unique) {
        if (!GLOBAL_FACTION_KEYS.includes(f)) {
            errs.push(`Unknown faction: **${f}**. Valid: ${GLOBAL_FACTION_KEYS.join(', ')}.`);
        }
    }
    return errs;
}

/**
 * Validate v2 game selection: 1–3 tags, each rankedEligible + warScoringEligible.
 * @param {string[]} gameTags
 * @param {object} settings - GamePlatformSettings doc (for resolveGame)
 * @returns {string[]} error messages (empty = valid)
 */
function validateV2GameSelection(gameTags, settings) {
    const { resolveGame } = require('./gamePlatform/configStore');
    const errs = [];
    if (!Array.isArray(gameTags) || gameTags.length === 0) {
        errs.push('Select **1–3** ranked-eligible games for a v2 war.');
        return errs;
    }
    if (gameTags.length > 3) {
        errs.push('Maximum **3** games per war.');
        return errs;
    }
    for (const tag of gameTags) {
        const def = resolveGame(tag, settings);
        if (!def) {
            errs.push(`Unknown game tag: **${tag}**.`);
            continue;
        }
        if (!def.rankedEligible) {
            errs.push(`**${def.displayName}** (\`${tag}\`) is not ranked-eligible.`);
        }
        if (!def.warScoringEligible) {
            errs.push(`**${def.displayName}** (\`${tag}\`) is not war-scoring-eligible.`);
        }
    }
    return errs;
}

module.exports = {
    RANKED_DEFAULT_ROSTER_CAP,
    RANKED_FIXED_SCORING_MODE,
    RANKED_FIXED_TOP_N,
    RANKED_SCORING_DISPLAY_LABEL,
    RANKED_SLASH_CREATE_WAR_VERSION,
    challengeModeOf,
    isChallengeRanked,
    parseContributionCapsCsv,
    validateChallengeCreateParams,
    rankedDefaultRosterCapFromConfig,
    rankedContributionCapsFromConfig,
    validateV2FactionSelection,
    validateV2GameSelection,
};
