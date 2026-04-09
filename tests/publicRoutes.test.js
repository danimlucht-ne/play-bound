const test = require('node:test');
const assert = require('node:assert/strict');

const { clearModule, repoPath, withMockedModules, withServer } = require('./routerTestUtils');

const publicRoutesPath = repoPath('src', 'server', 'api', 'publicRoutes.js');
const modelsPath = repoPath('models.js');
const cachePath = repoPath('src', 'server', 'api', 'cache.js');
const publicStatsExcludePath = repoPath('lib', 'publicStatsExclude.js');
const factionAggregatesPath = repoPath('lib', 'globalFactionAggregates.js');
const factionSeasonsPath = repoPath('lib', 'factionSeasons.js');
const competitivePointsPath = repoPath('lib', 'competitivePoints.js');
const rotationPath = repoPath('lib', 'gamePlatform', 'rotation.js');
const configStorePath = repoPath('lib', 'gamePlatform', 'configStore.js');

function loadPublicRoutes(overrides = {}) {
    clearModule(publicRoutesPath);
    return withMockedModules(
        {
            [modelsPath]: overrides.models || {
                User: { aggregate: async () => [], findOne: () => ({ select: () => ({ lean: async () => null }) }) },
                Game: { countDocuments: async () => 0 },
                SystemConfig: { countDocuments: async () => 0 },
                ReferralFirstGamePayout: { countDocuments: async () => 0, aggregate: async () => [] },
            },
            [cachePath]: overrides.cache || { cached: async (_key, _ttl, fn) => fn() },
            [publicStatsExcludePath]:
                overrides.publicStatsExclude || {
                    getExcludedGuildIds: () => [],
                    publicStatsCacheKeySuffix: () => '',
                    guildIdNotExcludedMatch: () => ({}),
                },
            [factionAggregatesPath]:
                overrides.factionAggregates || { getGlobalFactionStandingsFromUsers: async () => [] },
            [factionSeasonsPath]:
                overrides.factionSeasons || {
                    getCurrentSeasonOverview: async () => ({ seasonKey: '2026-Q2' }),
                    getHallOfChampions: async () => ({ quarters: [], years: [] }),
                    getSeasonStandingsForKey: async (key) => ({ seasonKey: key, entries: [] }),
                },
            [competitivePointsPath]:
                overrides.competitivePoints || { competitiveLedgerLabelsForMatch: () => ['Arena score'] },
            [rotationPath]:
                overrides.rotation || { ensureRotationForDate: async () => ({ dayUtc: '2026-04-08', activeTags: ['risk-roll'], featuredTag: 'risk-roll' }) },
            [configStorePath]:
                overrides.configStore || {
                    getSettings: async () => ({ featuredCasualBonusPct: 15 }),
                    allResolvedGames: () => [{ tag: 'risk-roll', displayName: 'Risk Roll', category: 'Trivia', enabled: true, rankedEligible: true }],
                    resolveGame: () => ({ tag: 'risk-roll', displayName: 'Risk Roll', category: 'Trivia', enabled: true, rankedEligible: true }),
                },
        },
        () => require(publicRoutesPath),
    );
}

test('public-config exposes invite and premium links', async () => {
    process.env.CLIENT_ID = '123456';
    process.env.SUPPORT_SERVER_INVITE = 'https://discord.gg/support';
    process.env.STRIPE_PAYMENT_LINK_MONTHLY = 'https://buy.stripe.com/monthly';
    process.env.STRIPE_PAYMENT_LINK_YEARLY = 'https://buy.stripe.com/yearly';

    const { createPublicApiRouter } = loadPublicRoutes();
    await withServer(createPublicApiRouter(), null, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/public-config`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.match(body.botInviteUrl, /discord\.com\/oauth2/);
        assert.equal(body.supportServerInvite, 'https://discord.gg/support');
        assert.equal(body.premiumMonthlyUrl, 'https://buy.stripe.com/monthly');
        assert.equal(body.premiumYearlyUrl, 'https://buy.stripe.com/yearly');
        assert.equal(body.clientId, '123456');
    });
});

test('leaderboard players validates board names and returns decorated entries', async () => {
    const { createPublicApiRouter } = loadPublicRoutes({
        models: {
            User: {
                aggregate: async () => [{ _id: 'u1', points: 99, streak: 3 }],
            },
            Game: { countDocuments: async () => 0 },
            SystemConfig: { countDocuments: async () => 0 },
            ReferralFirstGamePayout: { countDocuments: async () => 0, aggregate: async () => [] },
        },
    });

    const client = {
        isReady: () => true,
        users: {
            fetch: async () => ({ username: 'user-one', globalName: 'User One' }),
        },
    };

    await withServer(createPublicApiRouter(), { locals: { playbound: { client } } }, async (baseUrl) => {
        const bad = await fetch(`${baseUrl}/leaderboard/players?board=nope`);
        assert.equal(bad.status, 400);

        const res = await fetch(`${baseUrl}/leaderboard/players?limit=5&board=arena`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.board, 'arena');
        assert.equal(body.entries.length, 1);
        assert.equal(body.entries[0].displayName, 'User One');
        assert.equal(body.entries[0].points, 99);
    });
});

test('games/today returns rotation-driven payload for the website', async () => {
    const { createPublicApiRouter } = loadPublicRoutes({
        rotation: {
            ensureRotationForDate: async () => ({
                dayUtc: '2026-04-08',
                activeTags: ['risk-roll', 'daily-duel'],
                featuredTag: 'daily-duel',
            }),
        },
        configStore: {
            getSettings: async () => ({ featuredCasualBonusPct: 20 }),
            allResolvedGames: () => [
                { tag: 'risk-roll', displayName: 'Risk Roll', category: 'Trivia', enabled: true, rankedEligible: false },
                { tag: 'daily-duel', displayName: 'Daily Duel', category: 'Reaction', enabled: true, rankedEligible: true },
            ],
            resolveGame: (tag) =>
                ({
                    'risk-roll': { tag: 'risk-roll', displayName: 'Risk Roll', category: 'Trivia', enabled: true, rankedEligible: false },
                    'daily-duel': { tag: 'daily-duel', displayName: 'Daily Duel', category: 'Reaction', enabled: true, rankedEligible: true },
                })[tag] || null,
        },
    });

    await withServer(createPublicApiRouter(), null, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/games/today`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.featuredTag, 'daily-duel');
        assert.equal(body.featuredDisplayName, 'Daily Duel');
        assert.equal(body.activeGames.length, 2);
        assert.equal(body.catalogSummary.length, 2);
        assert.match(body.microcopy.featuredCasualOnly, /bonus casual credits only/i);
    });
});
