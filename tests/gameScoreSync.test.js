'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { clearModule, repoPath, withMockedModules } = require('./routerTestUtils');

const syncPath = repoPath('lib', 'gameScoreSync.js');
const dbPath = repoPath('lib', 'db.js');

function loadSync(updateCalls = []) {
    clearModule(syncPath);
    return withMockedModules(
        {
            [dbPath]: {
                updateActiveGame: async (threadId, fn) => {
                    const state = {};
                    fn(state);
                    updateCalls.push({ threadId, state });
                    return {};
                },
            },
        },
        () => require(syncPath),
    );
}

test('syncGameScores copies scores to Game.state via updateActiveGame', () => {
    const calls = [];
    const { syncGameScores, clearSyncTimer } = loadSync(calls);

    syncGameScores('thread-1', {
        scores: { user1: 10, user2: 5 },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].threadId, 'thread-1');
    assert.deepEqual(calls[0].state.scores, { user1: 10, user2: 5 });

    clearSyncTimer('thread-1');
});

test('syncGameScores copies players with nested objects', () => {
    const calls = [];
    const { syncGameScores, clearSyncTimer } = loadSync(calls);

    syncGameScores('thread-2', {
        players: {
            user1: { score: 8, timeTaken: 12000, qIndex: 3 },
            user2: { score: 3, timeTaken: null, qIndex: 1 },
        },
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].state.players.user1, { score: 8, timeTaken: 12000, qIndex: 3 });
    assert.deepEqual(calls[0].state.players.user2, { score: 3, timeTaken: null, qIndex: 1 });

    clearSyncTimer('thread-2');
});

test('syncGameScores debounces within 5 seconds', () => {
    const calls = [];
    const { syncGameScores, clearSyncTimer } = loadSync(calls);

    syncGameScores('thread-3', { scores: { user1: 1 } });
    syncGameScores('thread-3', { scores: { user1: 2 } });
    syncGameScores('thread-3', { scores: { user1: 3 } });

    // Only the first call should go through (debounce blocks the rest)
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].state.scores, { user1: 1 });

    clearSyncTimer('thread-3');
});

test('clearSyncTimer allows immediate re-sync', () => {
    const calls = [];
    const { syncGameScores, clearSyncTimer } = loadSync(calls);

    syncGameScores('thread-4', { scores: { user1: 1 } });
    assert.equal(calls.length, 1);

    clearSyncTimer('thread-4');

    syncGameScores('thread-4', { scores: { user1: 5 } });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].state.scores, { user1: 5 });

    clearSyncTimer('thread-4');
});

test('syncGameScores handles different thread IDs independently', () => {
    const calls = [];
    const { syncGameScores, clearSyncTimer } = loadSync(calls);

    syncGameScores('thread-a', { scores: { user1: 10 } });
    syncGameScores('thread-b', { scores: { user2: 20 } });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].threadId, 'thread-a');
    assert.equal(calls[1].threadId, 'thread-b');

    clearSyncTimer('thread-a');
    clearSyncTimer('thread-b');
});
