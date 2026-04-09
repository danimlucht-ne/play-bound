'use strict';

const { User, ReferralProfile } = require('../models');
const { ensureReferralProfile } = require('./referrals');
const { guildIdNotExcludedMatch } = require('./publicStatsExclude');

/** Product steps (0 = welcome; 7 = finished). */
const STEP_WELCOME = 0;
const STEP_FACTION = 1;
const STEP_FIRST_GAME = 2;
const STEP_POST_GAME = 3;
const STEP_WARS = 4;
const STEP_ROTATION = 5;
const STEP_EXPLORE = 6;
const STEP_COMPLETE = 7;

const LEGACY_CREDITS_THRESHOLD = 500;
const LEGACY_ARENA_THRESHOLD = 50;

async function quickUserSignal(userId) {
    const gEx = guildIdNotExcludedMatch();
    const [row] = await User.aggregate([
        { $match: { userId, ...gEx } },
        {
            $group: {
                _id: null,
                credits: { $sum: '$points' },
                arena: { $sum: '$competitivePoints' },
                hasFaction: {
                    $max: {
                        $cond: [{ $and: [{ $ne: ['$faction', null] }, { $ne: ['$faction', ''] }] }, 1, 0],
                    },
                },
            },
        },
    ]);
    return {
        credits: Math.round(Number(row?.credits || 0)),
        arena: Math.round(Number(row?.arena || 0)),
        hasFaction: Number(row?.hasFaction || 0) > 0,
    };
}

/**
 * One-time bootstrap: heavy players (pre-feature) skip the tour; everyone else gets step 0.
 */
async function bootstrapIfNeeded(userId, p) {
    if (p.onboardingBootstrappedAt) return p;
    if (p.onboardingCompletedAt || p.onboardingSkippedAt) {
        await ReferralProfile.updateOne({ userId }, { $set: { onboardingBootstrappedAt: new Date() } });
        return ReferralProfile.findOne({ userId });
    }
    const sig = await quickUserSignal(userId);
    const legacyHeavy =
        sig.credits >= LEGACY_CREDITS_THRESHOLD ||
        sig.arena >= LEGACY_ARENA_THRESHOLD ||
        (sig.hasFaction && sig.credits >= 50);
    if (legacyHeavy) {
        await ReferralProfile.updateOne(
            { userId },
            {
                $set: {
                    onboardingBootstrappedAt: new Date(),
                    onboardingCompletedAt: new Date(),
                    onboardingStep: STEP_COMPLETE,
                    hasJoinedFaction: sig.hasFaction || !!p.hasJoinedFaction,
                    hasPlayedFirstGame: true,
                },
            },
        );
        return ReferralProfile.findOne({ userId });
    }
    await ReferralProfile.updateOne({ userId }, { $set: { onboardingBootstrappedAt: new Date() } });
    return ReferralProfile.findOne({ userId });
}

async function syncFactionFlag(userId, p) {
    const gEx = guildIdNotExcludedMatch();
    const fac = await User.findOne({ userId, ...gEx, faction: { $nin: [null, ''] } })
        .select('faction')
        .lean();
    if (fac && !p.hasJoinedFaction) {
        await ReferralProfile.updateOne({ userId }, { $set: { hasJoinedFaction: true } });
        p = await ReferralProfile.findOne({ userId });
    }
    if (
        fac &&
        Number(p.onboardingStep) < STEP_FIRST_GAME &&
        !p.onboardingCompletedAt &&
        !p.onboardingSkippedAt
    ) {
        await ReferralProfile.updateOne({ userId }, { $set: { onboardingStep: STEP_FIRST_GAME } });
        p = await ReferralProfile.findOne({ userId });
    }
    return p;
}

/**
 * @returns {Promise<object>} Serializable snapshot for API + Discord.
 */
async function getOnboardingSnapshot(userId) {
    let p = await ensureReferralProfile(userId);
    p = await bootstrapIfNeeded(userId, p);
    p = await syncFactionFlag(userId, p);

    if (p.hasPlayedFirstGame && Number(p.onboardingStep) === STEP_FIRST_GAME) {
        await ReferralProfile.updateOne({ userId }, { $set: { onboardingStep: STEP_POST_GAME } });
        p = await ReferralProfile.findOne({ userId });
    }

    const step = Math.min(STEP_COMPLETE, Math.max(0, Number(p.onboardingStep) || 0));
    const complete = !!p.onboardingCompletedAt || step >= STEP_COMPLETE;
    const skipped = !!p.onboardingSkippedAt && !complete;
    const active = !complete && !skipped;

    return {
        active,
        complete,
        skipped: !!p.onboardingSkippedAt,
        step,
        hasJoinedFaction: !!p.hasJoinedFaction,
        hasPlayedFirstGame: !!p.hasPlayedFirstGame,
        hasSeenChallenge: !!p.hasSeenChallenge,
        onboardingComplete: complete,
    };
}

async function goToNextStep(userId) {
    const p = await ensureReferralProfile(userId);
    const cur = Math.min(STEP_COMPLETE, Math.max(0, Number(p.onboardingStep) || 0));
    if (cur >= STEP_COMPLETE) return getOnboardingSnapshot(userId);
    if (cur === STEP_WARS) {
        await ReferralProfile.updateOne({ userId }, { $set: { hasSeenChallenge: true } });
    }
    const next = cur + 1;
    await ReferralProfile.updateOne({ userId }, { $set: { onboardingStep: next } });
    if (next >= STEP_COMPLETE) {
        await ReferralProfile.updateOne(
            { userId },
            { $set: { onboardingCompletedAt: new Date(), onboardingSkippedAt: null } },
        );
    }
    return getOnboardingSnapshot(userId);
}

async function setStep(userId, step) {
    const s = Math.min(STEP_COMPLETE, Math.max(0, Number(step) || 0));
    await ReferralProfile.updateOne({ userId }, { $set: { onboardingStep: s } });
    if (s >= STEP_COMPLETE) {
        await ReferralProfile.updateOne(
            { userId },
            { $set: { onboardingCompletedAt: new Date(), onboardingSkippedAt: null } },
        );
    }
    return getOnboardingSnapshot(userId);
}

async function skipOnboarding(userId) {
    await ReferralProfile.updateOne({ userId }, { $set: { onboardingSkippedAt: new Date() } });
    return getOnboardingSnapshot(userId);
}

async function resumeOnboarding(userId) {
    await ReferralProfile.updateOne({ userId }, { $set: { onboardingSkippedAt: null } });
    return getOnboardingSnapshot(userId);
}

async function recordFactionJoined(userId) {
    const p = await ensureReferralProfile(userId);
    if (p.onboardingCompletedAt || p.onboardingSkippedAt) {
        await ReferralProfile.updateOne({ userId }, { $set: { hasJoinedFaction: true } });
        return getOnboardingSnapshot(userId);
    }
    await ReferralProfile.updateOne(
        { userId },
        { $set: { hasJoinedFaction: true, onboardingStep: STEP_FIRST_GAME } },
    );
    return getOnboardingSnapshot(userId);
}

/** First scored mini-game / platform session (any tagged game credit). */
async function recordFirstGamePlayed(userId) {
    const p = await ensureReferralProfile(userId);
    if (p.hasPlayedFirstGame) return getOnboardingSnapshot(userId);
    if (p.onboardingCompletedAt || p.onboardingSkippedAt) {
        await ReferralProfile.updateOne({ userId }, { $set: { hasPlayedFirstGame: true } });
        return getOnboardingSnapshot(userId);
    }
    await ReferralProfile.updateOne(
        { userId },
        {
            $set: {
                hasPlayedFirstGame: true,
                onboardingStep: Math.max(Number(p.onboardingStep) || 0, STEP_POST_GAME),
            },
        },
    );
    return getOnboardingSnapshot(userId);
}

async function markSeenChallenge(userId) {
    await ReferralProfile.updateOne({ userId }, { $set: { hasSeenChallenge: true } });
    return getOnboardingSnapshot(userId);
}

function stepLabels(step) {
    const titles = [
        'Welcome',
        'Pick a team',
        'Play once',
        'Nice!',
        'Faction wars',
        'Today’s games',
        'Explore',
        'Done',
    ];
    return {
        key: step,
        title: titles[Math.min(step, titles.length - 1)] || 'Onboarding',
    };
}

module.exports = {
    STEP_WELCOME,
    STEP_FACTION,
    STEP_FIRST_GAME,
    STEP_POST_GAME,
    STEP_WARS,
    STEP_ROTATION,
    STEP_EXPLORE,
    STEP_COMPLETE,
    getOnboardingSnapshot,
    goToNextStep,
    setStep,
    skipOnboarding,
    resumeOnboarding,
    recordFactionJoined,
    recordFirstGamePlayed,
    markSeenChallenge,
    stepLabels,
};
