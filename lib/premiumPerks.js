'use strict';

/** Max streak bonus points stacked onto the base score (see addScore). */
const STREAK_BONUS_CAP_FREE = 5;
const STREAK_BONUS_CAP_PREMIUM = 12;

/** When the game host has Premium, all players earn this multiplier on points from that session. */
const HOST_AURA_MULTIPLIER = 1.35;

/**
 * Upper bounds for host-selected sizes. Free vs Premium host (person who ran the slash command).
 * @type {Record<string, { min: number, freeMax: number, premiumMax: number }>}
 */
const HOST_GAME_CAPS = {
    movieRounds: { min: 1, freeMax: 25, premiumMax: 50 },
    triviaQuestions: { min: 1, freeMax: 25, premiumMax: 40 },
    sprintQuestions: { min: 1, freeMax: 50, premiumMax: 80 },
    unscrambleRounds: { min: 1, freeMax: 25, premiumMax: 50 },
    tuneRounds: { min: 1, freeMax: 15, premiumMax: 30 },
    spellingBeeRounds: { min: 1, freeMax: 15, premiumMax: 30 },
};

/**
 * @param {number} raw
 * @param {boolean} hostPremium
 * @param {keyof typeof HOST_GAME_CAPS} key
 */
function clampHostGameInt(raw, hostPremium, key) {
    const c = HOST_GAME_CAPS[key];
    if (!c) return raw;
    const n = parseInt(String(raw), 10);
    const max = hostPremium ? c.premiumMax : c.freeMax;
    if (Number.isNaN(n)) return c.min;
    return Math.min(Math.max(n, c.min), max);
}

/** True if this game session gets the host-aura point multiplier (starter Premium or a Premium member used the thread boost button). */
function sessionHasHostAura(state) {
    if (!state) return false;
    return state.hostIsPremium === true || state.premiumAuraBoost === true;
}

module.exports = {
    STREAK_BONUS_CAP_FREE,
    STREAK_BONUS_CAP_PREMIUM,
    HOST_AURA_MULTIPLIER,
    HOST_GAME_CAPS,
    clampHostGameInt,
    sessionHasHostAura,
};
