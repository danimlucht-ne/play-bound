'use strict';

function getModels() {
    return require('../../models');
}

const K = 24;

function expectedScore(rA, rB) {
    return 1 / (1 + 10 ** ((rB - rA) / 400));
}

/**
 * @param {string} guildId
 * @param {string} winnerId
 * @param {string} loserId
 */
async function recordDuelOutcome(guildId, winnerId, loserId) {
    const wDoc = await getModels().DuelProfile.findOne({ guildId, userId: winnerId });
    const lDoc = await getModels().DuelProfile.findOne({ guildId, userId: loserId });
    const wR = wDoc?.rating ?? 1500;
    const lR = lDoc?.rating ?? 1500;
    const eW = expectedScore(wR, lR);
    const eL = expectedScore(lR, wR);
    const newWR = Math.round(wR + K * (1 - eW));
    const newLR = Math.round(lR + K * (0 - eL));

    const wStreak = (wDoc?.streak || 0) >= 0 ? (wDoc?.streak || 0) + 1 : 1;
    const lStreak = (lDoc?.streak || 0) <= 0 ? (lDoc?.streak || 0) - 1 : -1;

    await getModels().DuelProfile.findOneAndUpdate(
        { guildId, userId: winnerId },
        {
            $inc: { wins: 1 },
            $set: { rating: newWR, streak: wStreak },
        },
        { upsert: true },
    );
    await getModels().DuelProfile.findOneAndUpdate(
        { guildId, userId: loserId },
        {
            $inc: { losses: 1 },
            $set: { rating: newLR, streak: lStreak },
        },
        { upsert: true },
    );
}

module.exports = { recordDuelOutcome, expectedScore };
