const test = require('node:test');
const assert = require('node:assert/strict');

const { clearModule, repoPath, withMockedModules } = require('./routerTestUtils');

const readyPath = repoPath('src', 'events', 'ready.js');
const modelsPath = repoPath('models.js');
const mongoRouterPath = repoPath('lib', 'mongoRouter.js');
const factionSeasonsPath = repoPath('lib', 'factionSeasons.js');
const rotationPath = repoPath('lib', 'gamePlatform', 'rotation.js');
const dbPath = repoPath('lib', 'db.js');
const auraBoostPath = repoPath('lib', 'auraBoostRegistry.js');
const automatedPostsPath = repoPath('lib', 'automatedPosts.js');
const serverdlePath = repoPath('games', 'serverdle.js');
const triviaPath = repoPath('games', 'trivia.js');
const interruptedGameCompensationPath = repoPath('lib', 'interruptedGameCompensation.js');
const maintenanceBroadcastPath = repoPath('lib', 'maintenanceBroadcast.js');

function loadReady(overrides = {}) {
    const modelBag =
        overrides.models || {
            Game: { find: async () => [] },
            User: { find: async () => [], updateMany: async () => {} },
            SystemConfig: { find: async () => [] },
            RecurringGame: { find: async () => [] },
        };
    clearModule(readyPath);
    return withMockedModules(
        {
            [require.resolve('node-cron', { paths: [repoPath()] })]:
                overrides.cron || {
                    schedule: () => ({}),
                },
            [modelsPath]: modelBag,
            [mongoRouterPath]:
                overrides.mongoRouter || {
                    listModelBags: () => [modelBag],
                    runWithForcedModels: async (_bag, fn) => fn(),
                    runWithGuild: async (_gid, fn) => fn(),
                    getModelsProd: () => modelBag,
                    getModelsTest: () => modelBag,
                    getModelsForGuild: () => modelBag,
                    isDualMode: () => false,
                    getCurrentGuildId: () => null,
                    ensureLazyScriptConnection: () => {},
                },
            [factionSeasonsPath]:
                overrides.factionSeasons || {
                    processSeasonBoundaries: async () => {},
                },
            [rotationPath]:
                overrides.rotation || {
                    ensureRotationForDate: async () => ({ activeTags: [] }),
                },
            [dbPath]:
                overrides.db || {
                    refreshLeaderboard: async () => {},
                    updateUser: async () => {},
                    recordLeaderboardPeriodSnapshot: async () => {},
                },
            [auraBoostPath]:
                overrides.auraBoost || {
                    registerAuraBoostTarget: () => {},
                },
            [automatedPostsPath]:
                overrides.automatedPosts || {
                    automatedServerPostsEnabled: () => false,
                },
            [serverdlePath]:
                overrides.serverdle || {
                    getActiveGames: () => new Map(),
                    forceEnd: async () => {},
                    startServerdleGame: async () => {},
                },
            [triviaPath]:
                overrides.trivia || {
                    startTriviaGame: async () => {},
                },
            [interruptedGameCompensationPath]:
                overrides.interruptedGameCompensation || {
                    compensateUnresumableGameOnRecovery: async () => ({
                        participantCount: 0,
                        compensatedCount: 0,
                        pointsPerUser: 0,
                        skipped: false,
                        placementAwarded: false,
                    }),
                    buildPartialResultsSummary: () => '',
                },
            [maintenanceBroadcastPath]:
                overrides.maintenanceBroadcast || {
                    runMaintenanceAdvanceBroadcast: async () => ({ sent: 0, failed: 0, skipped: true }),
                },
        },
        () => require(readyPath),
    );
}

test('registerReadyHandler bootstraps startup tasks and schedules recurring jobs', async () => {
    const cronCalls = [];
    const seasonCalls = [];
    const rotationCalls = [];
    const timeouts = [];
    const intervals = [];
    const originalSetTimeout = global.setTimeout;
    const originalSetInterval = global.setInterval;

    global.setTimeout = (fn, delay) => {
        timeouts.push({ fn, delay });
        return { delay };
    };
    global.setInterval = (fn, delay) => {
        intervals.push({ fn, delay });
        return { delay };
    };

    try {
        const { registerReadyHandler } = loadReady({
            cron: {
                schedule: (expr, fn, opts) => {
                    cronCalls.push({ expr, fn, opts });
                    return { expr };
                },
            },
            factionSeasons: {
                processSeasonBoundaries: async (client) => {
                    seasonCalls.push(client.user.tag);
                },
            },
            rotation: {
                ensureRotationForDate: async (date) => {
                    rotationCalls.push(date);
                    return { activeTags: [] };
                },
            },
        });

        const onceCalls = {};
        const client = {
            user: {
                tag: 'PlayBound#0001',
                setActivity: (text, opts) => {
                    onceCalls.activity = { text, opts };
                },
            },
            once(event, cb) {
                onceCalls[event] = cb;
            },
            channels: {
                fetch: async () => null,
                cache: new Map(),
            },
        };

        const deps = {
            state: { activeGiveaways: new Map() },
            triggers: { endGiveaway: () => {} },
            loadGameData: async () => {
                onceCalls.loaded = true;
            },
            resumeScheduledGames: async () => {
                onceCalls.resumed = true;
            },
        };

        registerReadyHandler(client, deps);
        await onceCalls.ready();

        assert.equal(onceCalls.loaded, true);
        assert.equal(onceCalls.resumed, true);
        assert.match(onceCalls.activity.text, /playbound/i);
        assert.equal(rotationCalls.length, 1);
        assert.equal(timeouts[0].delay, 120000);
        await timeouts[0].fn();
        assert.deepEqual(seasonCalls, ['PlayBound#0001']);
        assert.deepEqual(
            cronCalls.map((call) => call.expr),
            ['5 0 * * *', '20 * * * *', '5 * * * *', '0 20 * * 0', '0 20 1 * *', '*/5 * * * *'],
        );
        assert.equal(intervals.length, 1);
        assert.equal(intervals[0].delay, 3600000);
    } finally {
        global.setTimeout = originalSetTimeout;
        global.setInterval = originalSetInterval;
    }
});

test('registerReadyHandler recovers resumable games and safely closes fast games after reboot', async () => {
    const giveawayTimeouts = [];
    const auraTargets = [];
    const activeServerdles = new Map();
    const fastGameThread = {
        async send(message) {
            fastGameThread.lastMessage = message;
        },
        isThread() {
            return true;
        },
        async setArchived(value) {
            fastGameThread.archived = value;
        },
    };
    const originalSetTimeout = global.setTimeout;
    const originalSetInterval = global.setInterval;
    global.setTimeout = (fn, delay) => {
        giveawayTimeouts.push({ fn, delay });
        return { delay };
    };
    global.setInterval = () => ({});

    try {
        const triviaGame = { startTriviaGame: async () => {} };
        const { registerReadyHandler } = loadReady({
            models: {
                Game: {
                    find: async () => [
                        {
                            _id: 'g-1',
                            type: 'Giveaway',
                            guildId: 'guild-1',
                            channelId: 'chan-1',
                            threadId: 'thread-giveaway',
                            endTime: new Date(Date.now() + 60000),
                            state: {
                                winnersCount: 2,
                                participants: ['a', 'b'],
                                ignoredUsers: [],
                                ignoredRoles: [],
                                cooldownDays: 7,
                                pointValues: { first: 5 },
                            },
                            hostIsPremium: true,
                            premiumAuraBoost: false,
                        },
                        {
                            _id: 'g-2',
                            type: 'Serverdle',
                            guildId: 'guild-1',
                            channelId: 'chan-2',
                            threadId: 'thread-serverdle',
                            endTime: new Date(Date.now() + 90000),
                            state: {
                                word: 'alpha',
                                pointValues: { win: 8 },
                                players: {},
                                winners: [],
                            },
                            hostIsPremium: false,
                            premiumAuraBoost: true,
                        },
                        {
                            _id: 'g-3',
                            type: 'Trivia',
                            threadId: 'thread-fast',
                            status: 'active',
                            async save() {
                                this.saved = true;
                            },
                        },
                    ],
                    updateOne: async () => {},
                },
                User: { find: async () => [], updateMany: async () => {} },
                SystemConfig: { find: async () => [] },
                RecurringGame: { find: async () => [] },
            },
            auraBoost: {
                registerAuraBoostTarget: (threadId) => {
                    auraTargets.push(threadId);
                },
            },
            serverdle: {
                getActiveGames: () => activeServerdles,
                forceEnd: async () => {},
                startServerdleGame: async () => {},
            },
            trivia: triviaGame,
        });

        const readyFns = {};
        const activeGiveaways = new Map();
        const client = {
            user: {
                tag: 'PlayBound#0001',
                setActivity: () => {},
            },
            once(event, cb) {
                readyFns[event] = cb;
            },
            channels: {
                async fetch(id) {
                    return id === 'thread-fast' ? fastGameThread : null;
                },
                cache: new Map(),
            },
        };

        registerReadyHandler(client, {
            state: { activeGiveaways },
            triggers: { endGiveaway: () => {} },
            loadGameData: async () => {},
            resumeScheduledGames: async () => {},
        });
        await readyFns.ready();

        assert.equal(activeGiveaways.has('thread-giveaway'), true);
        assert.equal(activeGiveaways.get('thread-giveaway').guildId, 'guild-1');
        assert.equal(activeServerdles.has('thread-serverdle'), true);
        assert.deepEqual(auraTargets, ['thread-serverdle']);
        assert.match(fastGameThread.lastMessage, /system reboot/i);
        assert.equal(fastGameThread.archived, true);
        assert.ok(giveawayTimeouts.length >= 3);
    } finally {
        global.setTimeout = originalSetTimeout;
        global.setInterval = originalSetInterval;
    }
});

test('registerReadyHandler picks up a dropped giveaway and finishes it from the restored timer', async () => {
    const timeouts = [];
    const runWithGuildCalls = [];
    const endedGiveaways = [];
    const originalSetTimeout = global.setTimeout;
    const originalSetInterval = global.setInterval;

    global.setTimeout = (fn, delay) => {
        timeouts.push({ fn, delay });
        return { delay };
    };
    global.setInterval = () => ({});

    try {
        const droppedGiveaway = {
            _id: 'giveaway-reboot-1',
            type: 'Giveaway',
            guildId: 'guild-resume',
            channelId: 'channel-prizes',
            threadId: 'message-giveaway',
            endTime: new Date(Date.now() + 45000),
            state: {
                winnersCount: 1,
                participants: ['user-a', 'user-b'],
                ignoredUsers: ['ignored-user'],
                ignoredRoles: ['ignored-role'],
                cooldownDays: 3,
                pointValues: { first: 20 },
            },
            hostIsPremium: true,
            premiumAuraBoost: true,
        };
        const modelBag = {
            Game: { find: async () => [droppedGiveaway] },
            User: { find: async () => [], updateMany: async () => {} },
            SystemConfig: { find: async () => [] },
            RecurringGame: { find: async () => [] },
        };
        const { registerReadyHandler } = loadReady({
            models: modelBag,
            mongoRouter: {
                listModelBags: () => [modelBag],
                runWithForcedModels: async (_bag, fn) => fn(),
                runWithGuild: async (guildId, fn) => {
                    runWithGuildCalls.push(guildId);
                    return fn();
                },
                getModelsProd: () => modelBag,
                getModelsTest: () => modelBag,
                getModelsForGuild: () => modelBag,
                isDualMode: () => false,
                getCurrentGuildId: () => null,
                ensureLazyScriptConnection: () => {},
            },
        });

        const readyFns = {};
        const activeGiveaways = new Map();
        const client = {
            user: { tag: 'PlayBound#0001', setActivity: () => {} },
            once(event, cb) {
                readyFns[event] = cb;
            },
            channels: { fetch: async () => null, cache: new Map() },
        };

        registerReadyHandler(client, {
            state: { activeGiveaways },
            triggers: {
                endGiveaway: (threadId) => {
                    endedGiveaways.push(threadId);
                },
            },
            loadGameData: async () => {},
            resumeScheduledGames: async () => {},
        });
        await readyFns.ready();

        const restored = activeGiveaways.get('message-giveaway');
        assert.equal(restored.guildId, 'guild-resume');
        assert.equal(restored.channelId, 'channel-prizes');
        assert.deepEqual([...restored.participants], ['user-a', 'user-b']);
        assert.equal(restored.hostIsPremium, true);
        assert.equal(restored.premiumAuraBoost, true);

        const restoredTimer = timeouts.find((t) => t.delay > 0 && t.delay < 60000);
        assert.ok(restoredTimer, 'expected a restored giveaway timeout');
        await restoredTimer.fn();

        assert.deepEqual(runWithGuildCalls, ['guild-resume']);
        assert.deepEqual(endedGiveaways, ['message-giveaway']);
    } finally {
        global.setTimeout = originalSetTimeout;
        global.setInterval = originalSetInterval;
    }
});

test('registerReadyHandler picks up a dropped Serverdle and force-ends it from the restored timer', async () => {
    const timeouts = [];
    const runWithGuildCalls = [];
    const forceEnds = [];
    const auraTargets = [];
    const activeServerdles = new Map();
    const originalSetTimeout = global.setTimeout;
    const originalSetInterval = global.setInterval;

    global.setTimeout = (fn, delay) => {
        timeouts.push({ fn, delay });
        return { delay };
    };
    global.setInterval = () => ({});

    try {
        const droppedServerdle = {
            _id: 'serverdle-reboot-1',
            type: 'Serverdle',
            guildId: 'guild-serverdle',
            channelId: 'channel-word',
            threadId: 'thread-serverdle-resume',
            endTime: new Date(Date.now() + 50000),
            state: {
                word: 'orbit',
                pointValues: { first: 9 },
                players: { userA: { guesses: ['orate'], won: false } },
                winners: [],
            },
            hostIsPremium: false,
            premiumAuraBoost: false,
        };
        const modelBag = {
            Game: { find: async () => [droppedServerdle] },
            User: { find: async () => [], updateMany: async () => {} },
            SystemConfig: { find: async () => [] },
            RecurringGame: { find: async () => [] },
        };
        const { registerReadyHandler } = loadReady({
            models: modelBag,
            mongoRouter: {
                listModelBags: () => [modelBag],
                runWithForcedModels: async (_bag, fn) => fn(),
                runWithGuild: async (guildId, fn) => {
                    runWithGuildCalls.push(guildId);
                    return fn();
                },
                getModelsProd: () => modelBag,
                getModelsTest: () => modelBag,
                getModelsForGuild: () => modelBag,
                isDualMode: () => false,
                getCurrentGuildId: () => null,
                ensureLazyScriptConnection: () => {},
            },
            auraBoost: {
                registerAuraBoostTarget: (threadId, fn) => {
                    auraTargets.push({ threadId, fn });
                },
            },
            serverdle: {
                getActiveGames: () => activeServerdles,
                forceEnd: async (_client, threadId) => {
                    forceEnds.push(threadId);
                },
                startServerdleGame: async () => {},
            },
        });

        const readyFns = {};
        const client = {
            user: { tag: 'PlayBound#0001', setActivity: () => {} },
            once(event, cb) {
                readyFns[event] = cb;
            },
            channels: { fetch: async () => null, cache: new Map() },
        };

        registerReadyHandler(client, {
            state: { activeGiveaways: new Map() },
            triggers: { endGiveaway: () => {} },
            loadGameData: async () => {},
            resumeScheduledGames: async () => {},
        });
        await readyFns.ready();

        const restored = activeServerdles.get('thread-serverdle-resume');
        assert.equal(restored.guildId, 'guild-serverdle');
        assert.equal(restored.channelId, 'channel-word');
        assert.equal(restored.word, 'orbit');
        assert.deepEqual(restored.players.userA, { guesses: ['orate'], won: false });
        assert.deepEqual(auraTargets.map((x) => x.threadId), ['thread-serverdle-resume']);

        auraTargets[0].fn();
        assert.equal(activeServerdles.get('thread-serverdle-resume').premiumAuraBoost, true);

        const restoredTimer = timeouts.find((t) => t.delay > 0 && t.delay < 60000);
        assert.ok(restoredTimer, 'expected a restored Serverdle timeout');
        await restoredTimer.fn();

        assert.deepEqual(runWithGuildCalls, ['guild-serverdle']);
        assert.deepEqual(forceEnds, ['thread-serverdle-resume']);
    } finally {
        global.setTimeout = originalSetTimeout;
        global.setInterval = originalSetInterval;
    }
});

test('recurring game checker starts due supported games and warns on unsupported ones', async () => {
    const cronCalls = [];
    const triviaRuns = [];
    const serverdleRuns = [];
    const unsupportedChannel = {
        async send(message) {
            unsupportedChannel.lastMessage = message;
        },
    };
    const recurringGames = [
        {
            _id: 'rec-1',
            type: 'trivia',
            guildId: 'guild-1',
            channelId: 'chan-trivia',
            intervalHours: 6,
            data: { diff: 'easy', cat: 'any', qCount: 5, pts: '5,3,1', threadName: 'Trivia Time', slowMode: false, hostIsPremium: true },
            nextRun: new Date(Date.now() - 1000),
            async save() {
                this.saved = true;
            },
        },
        {
            _id: 'rec-2',
            type: 'startserverdle',
            guildId: 'guild-2',
            channelId: 'chan-serverdle',
            intervalHours: 12,
            data: { dur: 30, customWord: 'orbit', threadName: 'Daily Serverdle', pts: '5,3,1', hostIsPremium: false },
            nextRun: new Date(Date.now() - 1000),
            async save() {
                this.saved = true;
            },
        },
        {
            _id: 'rec-3',
            type: 'caption',
            guildId: 'guild-3',
            channelId: 'chan-unsupported',
            intervalHours: 24,
            data: {},
            nextRun: new Date(Date.now() - 1000),
            async save() {
                this.saved = true;
            },
        },
    ];
    const originalSetTimeout = global.setTimeout;
    const originalSetInterval = global.setInterval;
    global.setTimeout = () => ({});
    global.setInterval = () => ({});

    try {
        const { registerReadyHandler } = loadReady({
            cron: {
                schedule: (expr, fn) => {
                    cronCalls.push({ expr, fn });
                    return { expr };
                },
            },
            models: {
                Game: { find: async () => [] },
                User: { find: async () => [], updateMany: async () => {} },
                SystemConfig: { find: async () => [] },
                RecurringGame: {
                    find: async () => recurringGames,
                    deleteOne: async () => {},
                },
            },
            trivia: {
                startTriviaGame: async (...args) => {
                    triviaRuns.push(args);
                },
            },
            serverdle: {
                getActiveGames: () => new Map(),
                forceEnd: async () => {},
                startServerdleGame: async (...args) => {
                    serverdleRuns.push(args);
                },
            },
        });

        const readyFns = {};
        const client = {
            user: { tag: 'PlayBound#0001', setActivity: () => {} },
            once(event, cb) {
                readyFns[event] = cb;
            },
            channels: {
                async fetch(id) {
                    if (id === 'chan-trivia') return { id };
                    if (id === 'chan-serverdle') return { id };
                    if (id === 'chan-unsupported') return unsupportedChannel;
                    return null;
                },
                cache: new Map(),
            },
        };

        registerReadyHandler(client, {
            state: { activeGiveaways: new Map() },
            triggers: { endGiveaway: () => {} },
            loadGameData: async () => {},
            resumeScheduledGames: async () => {},
        });
        await readyFns.ready();

        const recurringCheck = cronCalls.find((call) => call.expr === '*/5 * * * *');
        await recurringCheck.fn();

        assert.equal(triviaRuns.length, 1);
        assert.equal(serverdleRuns.length, 1);
        assert.match(unsupportedChannel.lastMessage, /automatic execution requires refactoring/i);
        assert.equal(recurringGames.every((game) => game.saved === true), true);
    } finally {
        global.setTimeout = originalSetTimeout;
        global.setInterval = originalSetInterval;
    }
});
