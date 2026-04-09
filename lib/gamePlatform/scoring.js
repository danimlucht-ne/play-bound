'use strict';

const { addScore } = require('../db');
const { resolveGame, getSettings } = require('./configStore');

/**
 * Compute casual-only featured bonus (does not affect faction ledger).
 */
function computeFeaturedBonus(basePoints, featuredTag, gameTag, settingsDoc) {
    if (!settingsDoc || !featuredTag || featuredTag !== gameTag) return 0;
    const g = resolveGame(gameTag, settingsDoc);
    if (!g || !g.featuredBonusEligible) return 0;
    const pct = Math.max(0, Math.min(0.5, Number(settingsDoc.featuredCasualBonusPct) || 0));
    return Math.floor(Math.max(0, basePoints) * pct);
}

/**
 * Award points for a platform mini-game session.
 * @param {{ client: any, guildId: string, userId: string, gameTag: string, factionBasePoints: number, interaction?: any, hostIsPremium?: boolean, settingsDoc?: object|null, rotationFeaturedTag?: string|null, countsForPoints?: boolean, isWarSession?: boolean }} opts
 */
async function awardPlatformGameScore(opts) {
    const {
        client,
        guildId,
        userId,
        gameTag,
        factionBasePoints,
        interaction = null,
        hostIsPremium = false,
        settingsDoc = null,
        rotationFeaturedTag = null,
        countsForPoints = true,
        isWarSession = false,
    } = opts;

    const settings = settingsDoc || (await getSettings());
    const creditedBasePoints = countsForPoints ? factionBasePoints : 0;
    const casualBonus =
        countsForPoints && !isWarSession
            ? computeFeaturedBonus(factionBasePoints, rotationFeaturedTag, gameTag, settings)
            : 0;

    const addScoreExtras = {
        casualOnlyBonus: casualBonus,
        suppressPersonalCredits: !countsForPoints,
    };
    const fb = Math.max(0, Math.floor(Number(factionBasePoints) || 0));
    if (isWarSession && countsForPoints) {
        addScoreExtras.factionChallengeBasePoints = fb;
        /** Personal Credits from war playgames capped at 50 per user per UTC day (faction ledger uncapped). */
        addScoreExtras.warPlaygamePersonalCreditCap = true;
    }

    const addScoreResult = await addScore(
        client,
        guildId,
        userId,
        creditedBasePoints,
        interaction,
        hostIsPremium,
        gameTag,
        addScoreExtras,
    );

    return {
        factionBasePoints: Math.max(0, Math.floor(Number(factionBasePoints) || 0)),
        creditedBasePoints: Math.max(0, Math.floor(Number(creditedBasePoints) || 0)),
        casualOnlyBonus: casualBonus,
        factionChallengeCredit: addScoreResult?.factionChallengeCredit,
    };
}

/**
 * Preview for admin: no DB write.
 */
function previewPlatformScore(gameTag, factionBasePoints, settingsDoc, rotationFeaturedTag) {
    const casualBonus = computeFeaturedBonus(factionBasePoints, rotationFeaturedTag, gameTag, settingsDoc);
    return {
        factionBasePoints: Math.max(0, Math.floor(Number(factionBasePoints) || 0)),
        casualOnlyBonus: casualBonus,
        note: 'Streak / premium / pass multipliers apply only to (base + streak) in addScore; casualOnlyBonus is added after multipliers.',
    };
}

module.exports = {
    awardPlatformGameScore,
    previewPlatformScore,
    computeFeaturedBonus,
};
