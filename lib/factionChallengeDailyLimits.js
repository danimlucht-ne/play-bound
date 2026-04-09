'use strict';

const { FactionChallenge } = require('../models');

const DAILY_FACTION_CHALLENGE_CAP = 6;

function utcDayBounds(d = new Date()) {
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const end = new Date(start.getTime() + 86400000);
    return { start, end };
}

function inferChallengeTypeDoc(doc) {
    if (doc.challengeType === 'duel' || doc.challengeType === 'royale') return doc.challengeType;
    const bf = doc.battleFactions;
    if (Array.isArray(bf) && bf.length >= 2) return 'royale';
    return 'duel';
}

/**
 * How many challenges of this type were **created** on the current UTC day (includes ended).
 */
async function countFactionChallengesOfTypeToday(guildId, type) {
    const { start, end } = utcDayBounds();
    const docs = await FactionChallenge.find({
        guildId,
        createdAt: { $gte: start, $lt: end },
    })
        .select('challengeType battleFactions')
        .lean();
    return docs.filter((d) => inferChallengeTypeDoc(d) === type).length;
}

/**
 * All faction challenges (duel + royale) created on the current UTC day.
 */
async function countFactionChallengesToday(guildId) {
    const { start, end } = utcDayBounds();
    return FactionChallenge.countDocuments({
        guildId,
        createdAt: { $gte: start, $lt: end },
    });
}

module.exports = {
    DAILY_FACTION_CHALLENGE_CAP,
    utcDayBounds,
    inferChallengeTypeDoc,
    countFactionChallengesOfTypeToday,
    countFactionChallengesToday,
};
