const test = require('node:test');
const assert = require('node:assert/strict');

const { clearModule, repoPath, withMockedModules } = require('./routerTestUtils');

const compensationPath = require.resolve(repoPath('lib', 'interruptedGameCompensation.js'));
const mongoRouterPath = require.resolve(repoPath('lib', 'mongoRouter.js'));
const dbPath = require.resolve(repoPath('lib', 'db.js'));
const modelsPath = require.resolve(repoPath('models.js'));

function loadCompensation({ models, dbOverrides = {}, guildCalls = [] }) {
    clearModule(compensationPath);
    return withMockedModules(
        {
            [mongoRouterPath]: {
                runWithGuild: async (guildId, fn) => {
                    guildCalls.push(guildId);
                    return fn();
                },
            },
            [dbPath]: {
                grantInterruptedGameGoodwill: async () => ({ granted: true }),
                refreshLeaderboard: async () => {},
                ...dbOverrides,
            },
            [modelsPath]: models,
        },
        () => require(compensationPath),
    );
}

test('extractParticipantIdsFromPersistedGame finds persisted players and ignores non-snowflakes', () => {
    const { extractParticipantIdsFromPersistedGame } = loadCompensation({
        models: {
            InterruptedGameLog: {},
            User: {},
        },
    });

    const ids = extractParticipantIdsFromPersistedGame({
        type: 'Trivia',
        state: {
            scores: {
                '111111111111111111': 3,
                SYSTEM: 100,
                not_a_user: 1,
            },
            players: {
                '222222222222222222': {},
            },
            guesses: {
                '333333333333333333': [],
            },
            playerStats: {
                '444444444444444444': { correct: 1 },
            },
            participants: ['555555555555555555', 'bad'],
            winners: ['666666666666666666'],
        },
    });

    assert.deepEqual(ids, [
        '111111111111111111',
        '222222222222222222',
        '333333333333333333',
        '444444444444444444',
        '555555555555555555',
        '666666666666666666',
    ]);
});

test('compensateUnresumableGameOnRecovery is idempotent and reconciles an existing interruption log', async () => {
    const guildCalls = [];
    const grantCalls = [];
    const savedLogs = [];
    const existingLog = {
        guildId: 'guild-1',
        channelId: 'chan-old',
        threadId: 'thread-old',
        gameType: 'Trivia',
        gameMongoId: 'game-1',
        participantIds: ['111111111111111111'],
        pointsGrantedPerUser: 25,
        usersCompensated: 0,
        set(update) {
            Object.assign(this, update);
        },
        async save() {
            savedLogs.push({ ...this });
        },
    };
    const models = {
        InterruptedGameLog: {
            async create() {
                const err = new Error('duplicate');
                err.code = 11000;
                throw err;
            },
            async findOne(filter) {
                assert.deepEqual(filter, { gameMongoId: 'game-1' });
                return existingLog;
            },
        },
        User: {
            async countDocuments(filter) {
                assert.equal(filter.guildId, 'guild-1');
                assert.deepEqual(filter.userId.$in, ['111111111111111111', '222222222222222222']);
                assert.equal(filter.pointLedger.$elemMatch.reason, 'interrupt:game-1');
                return 2;
            },
        },
    };
    const { compensateUnresumableGameOnRecovery } = loadCompensation({
        models,
        guildCalls,
        dbOverrides: {
            grantInterruptedGameGoodwill: async (guildId, userId, gameMongoId, amount) => {
                grantCalls.push({ guildId, userId, gameMongoId, amount });
                return { granted: false };
            },
        },
    });

    const result = await compensateUnresumableGameOnRecovery(
        { channels: { cache: new Map() } },
        {
            _id: 'game-1',
            guildId: 'guild-1',
            channelId: 'chan-1',
            threadId: 'thread-1',
            type: 'Trivia',
            state: {
                scores: {
                    '111111111111111111': 5,
                    '222222222222222222': 3,
                },
            },
        },
    );

    assert.deepEqual(guildCalls, ['guild-1']);
    // On duplicate (skipped=true), no re-granting happens — idempotent
    assert.deepEqual(grantCalls, []);
    assert.equal(result.participantCount, 2);
    assert.equal(result.compensatedCount, 0);
    assert.equal(result.skipped, true);
    assert.equal(result.placementAwarded, false);
});

test('extractSortedScores returns sorted leaderboard from scores object', () => {
    const { extractSortedScores } = loadCompensation({ models: {} });

    const sorted = extractSortedScores({
        type: 'Trivia',
        state: {
            scores: {
                '111111111111111111': 10,
                '222222222222222222': 25,
                '333333333333333333': 5,
            },
        },
    });

    assert.equal(sorted.length, 3);
    assert.equal(sorted[0].uid, '222222222222222222');
    assert.equal(sorted[0].score, 25);
    assert.equal(sorted[1].uid, '111111111111111111');
    assert.equal(sorted[1].score, 10);
    assert.equal(sorted[2].uid, '333333333333333333');
    assert.equal(sorted[2].score, 5);
});

test('extractSortedScores handles players object with nested score property', () => {
    const { extractSortedScores } = loadCompensation({ models: {} });

    const sorted = extractSortedScores({
        type: 'UnscrambleSprint',
        state: {
            players: {
                '111111111111111111': { score: 8, timeTaken: 12000 },
                '222222222222222222': { score: 3, timeTaken: 45000 },
            },
        },
    });

    assert.equal(sorted.length, 2);
    assert.equal(sorted[0].uid, '111111111111111111');
    assert.equal(sorted[0].score, 8);
    assert.equal(sorted[1].uid, '222222222222222222');
    assert.equal(sorted[1].score, 3);
});

test('extractSortedScores returns empty array when no state', () => {
    const { extractSortedScores } = loadCompensation({ models: {} });

    assert.deepEqual(extractSortedScores({ type: 'Trivia', state: null }), []);
    assert.deepEqual(extractSortedScores({ type: 'Trivia' }), []);
});

test('buildPartialResultsSummary formats leaderboard from persisted scores', () => {
    const { buildPartialResultsSummary } = loadCompensation({ models: {} });

    const summary = buildPartialResultsSummary({
        type: 'Trivia',
        state: {
            scores: {
                '111111111111111111': 10,
                '222222222222222222': 25,
            },
        },
    });

    assert.ok(summary.includes('Partial standings'));
    assert.ok(summary.includes('222222222222222222'));
    assert.ok(summary.includes('**25**'));
    assert.ok(summary.includes('111111111111111111'));
    assert.ok(summary.includes('**10**'));
});

test('buildPartialResultsSummary returns empty string when no scores', () => {
    const { buildPartialResultsSummary } = loadCompensation({ models: {} });

    assert.equal(buildPartialResultsSummary({ type: 'Trivia', state: {} }), '');
    assert.equal(buildPartialResultsSummary({ type: 'Trivia', state: null }), '');
});
