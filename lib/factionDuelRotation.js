'use strict';

const { GLOBAL_FACTION_KEYS } = require('./globalFactions');

/** All unique duel pairings (round-robin set), stable order. */
const ROTATION_PAIRS = (() => {
    const names = [...GLOBAL_FACTION_KEYS];
    const pairs = [];
    for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
            pairs.push([names[i], names[j]]);
        }
    }
    return pairs;
})();

/** Rotating 1v1 pairings across global factions (slot = UTC day slot). */
function duelPairForDailySlot(slotIndex) {
    const i = Math.max(0, Math.floor(Number(slotIndex) || 0));
    return [...ROTATION_PAIRS[i % ROTATION_PAIRS.length]];
}

module.exports = {
    ROTATION_PAIRS,
    duelPairForDailySlot,
};
