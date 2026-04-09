'use strict';

/** Flat Credits for every enrolled player when a faction challenge ends. */
const FACTION_WAR_PARTICIPATION_CREDITS = 50;
/** Extra Credits for ranks 1–5 within each faction (by raw war score). */
const FACTION_WAR_TOP5_EXTRA_CREDITS = [100, 70, 50, 30, 10];
const FACTION_WAR_MAX_PERSONAL_CREDITS = FACTION_WAR_PARTICIPATION_CREDITS + FACTION_WAR_TOP5_EXTRA_CREDITS[0];

/**
 * @param {number} rankIndexZeroBased position after sorting that faction's roster by raw score (desc)
 * @returns {number} flat Credits for this participant
 */
function computeFactionWarEndPersonalCredits(rankIndexZeroBased) {
    const i = Math.max(0, Math.floor(rankIndexZeroBased));
    const extra = i < FACTION_WAR_TOP5_EXTRA_CREDITS.length ? FACTION_WAR_TOP5_EXTRA_CREDITS[i] : 0;
    return FACTION_WAR_PARTICIPATION_CREDITS + extra;
}

module.exports = {
    FACTION_WAR_PARTICIPATION_CREDITS,
    FACTION_WAR_TOP5_EXTRA_CREDITS,
    FACTION_WAR_MAX_PERSONAL_CREDITS,
    computeFactionWarEndPersonalCredits,
};
