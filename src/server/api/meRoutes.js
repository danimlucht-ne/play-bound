'use strict';

const express = require('express');
const mongoRouter = require('../../../lib/mongoRouter');
const { User, ReferralFirstGamePayout } = require('../../../models');
const { ensureReferralProfile } = require('../../../lib/referrals');
const onboardingService = require('../../../lib/onboardingService');
const { getExcludedGuildIds, guildIdNotExcludedMatch } = require('../../../lib/publicStatsExclude');
const { cached } = require('./cache');

const ME_PROFILE_TTL_MS = Number(process.env.API_ME_PROFILE_TTL_MS) || 60000;

/**
 * @param {string} discordUserId
 */
async function buildProfileStats(discordUserId) {
    return mongoRouter.runWithForcedModels(mongoRouter.getModelsProd(), async () => {
    const gEx = guildIdNotExcludedMatch();
    const matchUser = { userId: discordUserId, ...gEx };

    const [agg] = await User.aggregate([
        { $match: matchUser },
        {
            $group: {
                _id: null,
                arenaScoreTotal: { $sum: '$competitivePoints' },
                creditsTotal: { $sum: '$points' },
                weeklyCreditsTotal: { $sum: '$weeklyPoints' },
                monthlyCreditsTotal: { $sum: '$monthlyPoints' },
                streakMax: { $max: '$currentStreak' },
                premiumCount: { $sum: { $cond: ['$isPremium', 1, 0] } },
            },
        },
    ]);

    const arenaScoreTotal = Math.round(Number(agg?.arenaScoreTotal || 0));
    const creditsTotal = Math.round(Number(agg?.creditsTotal || 0));
    const weeklyCreditsTotal = Math.round(Number(agg?.weeklyCreditsTotal || 0));
    const monthlyCreditsTotal = Math.round(Number(agg?.monthlyCreditsTotal || 0));
    const streakMax = Math.round(Number(agg?.streakMax || 0));
    const isPremium = Number(agg?.premiumCount || 0) > 0;

    const [higherArena] = await User.aggregate([
        { $match: { userId: { $ne: 'SYSTEM' }, ...gEx } },
        { $group: { _id: '$userId', total: { $sum: '$competitivePoints' } } },
        { $match: { total: { $gt: arenaScoreTotal } } },
        { $count: 'n' },
    ]);
    const arenaRank = Math.round(Number(higherArena?.n || 0)) + 1;

    const [higherWeekly] = await User.aggregate([
        { $match: { userId: { $ne: 'SYSTEM' }, ...gEx } },
        { $group: { _id: '$userId', total: { $sum: '$weeklyPoints' } } },
        { $match: { total: { $gt: weeklyCreditsTotal } } },
        { $count: 'n' },
    ]);
    const weeklyCreditsRank = Math.round(Number(higherWeekly?.n || 0)) + 1;

    const [higherMonthly] = await User.aggregate([
        { $match: { userId: { $ne: 'SYSTEM' }, ...gEx } },
        { $group: { _id: '$userId', total: { $sum: '$monthlyPoints' } } },
        { $match: { total: { $gt: monthlyCreditsTotal } } },
        { $count: 'n' },
    ]);
    const monthlyCreditsRank = Math.round(Number(higherMonthly?.n || 0)) + 1;

    const factionRow = await User.findOne({
        userId: discordUserId,
        ...gEx,
        faction: { $nin: [null, ''] },
    })
        .select('faction')
        .lean();
    const factionName = factionRow?.faction || null;

    return {
        arenaScoreTotal,
        creditsTotal,
        weeklyCreditsTotal,
        monthlyCreditsTotal,
        streakMax,
        isPremium,
        arenaRank,
        weeklyCreditsRank,
        monthlyCreditsRank,
        factionName,
        /** Same scope as public boards (`PUBLIC_STATS_EXCLUDE_GUILD_IDS`). */
        statsScope: 'global_non_excluded',
        cachedAt: new Date().toISOString(),
    };
    });
}

function createMeRouter() {
    const router = express.Router();

    router.get('/', async (req, res) => {
        const sess = req.pbSession;
        if (!sess) {
            return res.json({ loggedIn: false });
        }
        try {
            const p = await mongoRouter.runWithForcedModels(mongoRouter.getModelsProd(), () =>
                ensureReferralProfile(sess.discordUserId),
            );
            const ex = getExcludedGuildIds();
            let successfulServerCount = 0;
            for (const models of mongoRouter.listModelBags()) {
                successfulServerCount += await models.ReferralFirstGamePayout.countDocuments({
                    referrerUserId: sess.discordUserId,
                    ...(ex.length ? { guildId: { $nin: ex } } : {}),
                });
            }
            const adminEligible = sess.isDeveloper || (sess.adminGuildIds && sess.adminGuildIds.length > 0);

            const cacheKey = `me:profile:${sess.discordUserId}${ex.length ? `:ex=${ex.slice().sort().join('|')}` : ''}`;
            const profile = await cached(cacheKey, ME_PROFILE_TTL_MS, () => buildProfileStats(sess.discordUserId));
            const onboarding = await onboardingService.getOnboardingSnapshot(sess.discordUserId);

            res.json({
                loggedIn: true,
                user: {
                    id: sess.discordUserId,
                    username: sess.username,
                    globalName: sess.globalName,
                    displayName: sess.globalName || sess.username || sess.discordUserId,
                },
                referral: {
                    code: p.referralCode,
                    successfulServerCount: Math.round(Number(successfulServerCount || 0)),
                },
                admin: {
                    eligible: adminEligible,
                    isDeveloper: Boolean(sess.isDeveloper),
                    guildIds: sess.isDeveloper ? [] : sess.adminGuildIds || [],
                },
                profile,
                onboarding,
            });
        } catch (e) {
            console.error('[API] GET /api/me', e);
            res.status(500).json({ error: 'me_unavailable' });
        }
    });

    router.post('/onboarding', async (req, res) => {
        const sess = req.pbSession;
        if (!sess) {
            return res.status(401).json({ error: 'login_required' });
        }
        const uid = sess.discordUserId;
        const action = String((req.body && req.body.action) || '');
        try {
            let snap;
            if (action === 'next') {
                snap = await onboardingService.goToNextStep(uid);
            } else if (action === 'skip') {
                snap = await onboardingService.skipOnboarding(uid);
            } else if (action === 'resume') {
                snap = await onboardingService.resumeOnboarding(uid);
            } else if (action === 'refresh') {
                snap = await onboardingService.getOnboardingSnapshot(uid);
            } else if (action === 'finish') {
                snap = await onboardingService.setStep(uid, onboardingService.STEP_COMPLETE);
            } else {
                return res.status(400).json({ error: 'bad_action' });
            }
            return res.json({ onboarding: snap });
        } catch (e) {
            console.error('[API] POST /api/me/onboarding', e);
            return res.status(500).json({ error: 'onboarding_failed' });
        }
    });

    return router;
}

module.exports = { createMeRouter };
