'use strict';

const { tagCreditsOfficialRankedWar } = require('../gameClassification');

/**
 * Whether this score should apply to an **official ranked** faction war ledger for the tag.
 * Delegates to {@link tagCreditsOfficialRankedWar} (platform + rankedEligible + social gate).
 */
async function platformTagCreditsRankedWar(gameTag, challenge) {
    const { isChallengeRanked } = require('../rankedFactionWar');
    const { getSettings } = require('./configStore');
    if (!challenge || !isChallengeRanked(challenge)) return true;
    const settings = await getSettings();
    return tagCreditsOfficialRankedWar(String(gameTag || '').toLowerCase(), settings);
}

module.exports = {
    platformTagCreditsRankedWar,
};
