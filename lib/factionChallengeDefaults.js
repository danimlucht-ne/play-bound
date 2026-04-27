'use strict';

const { PLATFORM_GAME_TAGS } = require('./gamePlatform/registry');

const VALID_GAME_TYPES = new Set([
    'all',
    'trivia',
    'triviasprint',
    'serverdle',
    'guessthenumber',
    'mastermind',
    'moviequotes',
    'unscramble',
    'caption',
    'namethattune',
    'spellingbee',
    ...PLATFORM_GAME_TAGS,
]);

const VALID_SCORING_MODES = new Set(['total_points', 'avg_points', 'top_n_avg']);

const BUILTIN_DEFAULT_GAME = 'all';
const BUILTIN_DEFAULT_SCORING = 'top_n_avg';
const BUILTIN_DEFAULT_TOPN = 5;

/**
 * @param {import('../models').SystemConfig} config
 * @param {{ gameType?: string|null, scoringMode?: string|null, topN?: number|null }} opts — raw from slash (null/undefined = use defaults)
 */
function resolveFactionChallengeCreateOptions(config, opts) {
    const gameType =
        opts.gameType != null && opts.gameType !== ''
            ? opts.gameType
            : config.factionChallengeDefaultGameType || BUILTIN_DEFAULT_GAME;
    const scoringMode =
        opts.scoringMode != null && opts.scoringMode !== ''
            ? opts.scoringMode
            : config.factionChallengeDefaultScoringMode || BUILTIN_DEFAULT_SCORING;
    let topN = opts.topN;
    if (topN == null || !Number.isFinite(topN)) {
        topN = config.factionChallengeDefaultTopN;
    }
    if (topN == null || !Number.isFinite(topN)) {
        topN = BUILTIN_DEFAULT_TOPN;
    }
    topN = Math.min(50, Math.max(1, Math.round(Number(topN))));
    return { gameType, scoringMode, topN };
}

function assertValidGameType(v) {
    return VALID_GAME_TYPES.has(v);
}

function assertValidScoringMode(v) {
    return VALID_SCORING_MODES.has(v);
}

/**
 * @param {string|null|undefined} gamesCsv — comma-separated tags, max 3 (e.g. `trivia,unscramble`)
 * @param {string} fallbackSingle — from `game_type` / guild default / built-in
 * @returns {string[]} non-empty, each in VALID_GAME_TYPES, max 3 unique
 */
function resolveGameTypesArrayForChallenge(gamesCsv, fallbackSingle) {
    const out = [];
    if (gamesCsv != null && String(gamesCsv).trim()) {
        const parts = String(gamesCsv)
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean);
        for (const p of parts) {
            if (!VALID_GAME_TYPES.has(p) || p === 'all') continue;
            if (!out.includes(p)) out.push(p);
            if (out.length >= 3) break;
        }
    }
    if (out.length === 0) {
        const g = fallbackSingle && VALID_GAME_TYPES.has(fallbackSingle) ? fallbackSingle : BUILTIN_DEFAULT_GAME;
        return [g];
    }
    return out;
}

module.exports = {
    VALID_GAME_TYPES,
    VALID_SCORING_MODES,
    BUILTIN_DEFAULT_GAME,
    BUILTIN_DEFAULT_SCORING,
    BUILTIN_DEFAULT_TOPN,
    resolveFactionChallengeCreateOptions,
    resolveGameTypesArrayForChallenge,
    assertValidGameType,
    assertValidScoringMode,
};
