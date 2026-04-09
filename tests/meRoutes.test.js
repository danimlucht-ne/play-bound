const test = require('node:test');
const assert = require('node:assert/strict');

const { clearModule, repoPath, withMockedModules, withServer } = require('./routerTestUtils');

const meRoutesPath = repoPath('src', 'server', 'api', 'meRoutes.js');
const modelsPath = repoPath('models.js');
const mongoRouterPath = repoPath('lib', 'mongoRouter.js');
const referralsPath = repoPath('lib', 'referrals.js');
const onboardingServicePath = repoPath('lib', 'onboardingService.js');
const publicStatsExcludePath = repoPath('lib', 'publicStatsExclude.js');
const cachePath = repoPath('src', 'server', 'api', 'cache.js');

function loadMeRoutes(overrides = {}) {
    const models =
        overrides.models || {
            User: {
                aggregate: async () => [],
                findOne: () => ({ select: () => ({ lean: async () => null }) }),
            },
            ReferralFirstGamePayout: { countDocuments: async () => 0 },
        };
    clearModule(meRoutesPath);
    return withMockedModules(
        {
            [modelsPath]: models,
            [mongoRouterPath]:
                overrides.mongoRouter || {
                    listModelBags: () => [models],
                    runWithForcedModels: async (_bag, fn) => fn(),
                    getModelsProd: () => models,
                    getModelsTest: () => models,
                    isDualMode: () => false,
                    ensureLazyScriptConnection: () => {},
                },
            [referralsPath]:
                overrides.referrals || {
                    ensureReferralProfile: async () => ({ referralCode: 'PB-CODE' }),
                },
            [onboardingServicePath]:
                overrides.onboardingService || {
                    STEP_COMPLETE: 7,
                    getOnboardingSnapshot: async () => ({ active: true, step: 0 }),
                    goToNextStep: async () => ({ active: true, step: 1 }),
                    skipOnboarding: async () => ({ skipped: true }),
                    resumeOnboarding: async () => ({ active: true, skipped: false }),
                    setStep: async (_uid, step) => ({ complete: step === 7, step }),
                },
            [publicStatsExcludePath]:
                overrides.publicStatsExclude || {
                    getExcludedGuildIds: () => [],
                    guildIdNotExcludedMatch: () => ({}),
                },
            [cachePath]: overrides.cache || { cached: async (_key, _ttl, fn) => fn() },
        },
        () => require(meRoutesPath),
    );
}

test('GET /api/me returns logged-out payload when no session exists', async () => {
    const { createMeRouter } = loadMeRoutes();
    await withServer(createMeRouter(), { session: null }, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/`);
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { loggedIn: false });
    });
});

test('GET /api/me returns merged session, profile, referral, and onboarding data', async () => {
    const { createMeRouter } = loadMeRoutes({
        models: {
            User: {
                aggregate: async () => [{ arenaScoreTotal: 88, creditsTotal: 250, weeklyCreditsTotal: 40, monthlyCreditsTotal: 120, streakMax: 5, premiumCount: 1 }],
                findOne: () => ({ select: () => ({ lean: async () => ({ faction: 'Dragons' }) }) }),
            },
            ReferralFirstGamePayout: { countDocuments: async () => 3 },
        },
        cache: { cached: async (_key, _ttl, fn) => fn() },
        referrals: { ensureReferralProfile: async () => ({ referralCode: 'PB-XYZ' }) },
        onboardingService: { getOnboardingSnapshot: async () => ({ active: true, step: 2 }) },
    });

    const session = {
        discordUserId: 'u123',
        username: 'player1',
        globalName: 'Player One',
        adminGuildIds: ['g1'],
        isDeveloper: false,
    };

    await withServer(createMeRouter(), { session }, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.loggedIn, true);
        assert.equal(body.user.displayName, 'Player One');
        assert.equal(body.referral.code, 'PB-XYZ');
        assert.equal(body.referral.successfulServerCount, 3);
        assert.equal(body.admin.eligible, true);
        assert.equal(body.onboarding.step, 2);
        assert.equal(body.profile.factionName, 'Dragons');
        assert.equal(body.profile.statsScope, 'global_non_excluded');
    });
});

test('POST /api/me/onboarding routes actions to onboarding service and rejects bad actions', async () => {
    const calls = [];
    const onboardingService = {
        STEP_COMPLETE: 7,
        goToNextStep: async (uid) => {
            calls.push(['next', uid]);
            return { step: 1 };
        },
        skipOnboarding: async (uid) => {
            calls.push(['skip', uid]);
            return { skipped: true };
        },
        resumeOnboarding: async (uid) => {
            calls.push(['resume', uid]);
            return { active: true };
        },
        getOnboardingSnapshot: async (uid) => {
            calls.push(['refresh', uid]);
            return { step: 0 };
        },
        setStep: async (uid, step) => {
            calls.push(['finish', uid, step]);
            return { complete: true, step };
        },
    };
    const { createMeRouter } = loadMeRoutes({ onboardingService });
    const session = { discordUserId: 'u999', username: 'tester', globalName: null, adminGuildIds: [], isDeveloper: false };

    await withServer(createMeRouter(), { session }, async (baseUrl) => {
        const nextRes = await fetch(`${baseUrl}/onboarding`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'next' }),
        });
        assert.equal(nextRes.status, 200);
        assert.equal((await nextRes.json()).onboarding.step, 1);

        const finishRes = await fetch(`${baseUrl}/onboarding`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'finish' }),
        });
        assert.equal(finishRes.status, 200);
        assert.equal((await finishRes.json()).onboarding.complete, true);

        const badRes = await fetch(`${baseUrl}/onboarding`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'bogus' }),
        });
        assert.equal(badRes.status, 400);

        assert.deepEqual(calls, [
            ['next', 'u999'],
            ['finish', 'u999', 7],
        ]);
    });
});
