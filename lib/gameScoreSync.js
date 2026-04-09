'use strict';

const { updateActiveGame } = require('./db');

const _lastSync = new Map();
const SYNC_INTERVAL_MS = 5000;

/**
 * Debounced sync of in-memory game scores to MongoDB Game.state.
 * Call after any player score change. At most once per 5 seconds per game.
 * @param {string} threadId
 * @param {object} liveState — the in-memory game state object
 */
function syncGameScores(threadId, liveState) {
    const now = Date.now();
    if (now - (_lastSync.get(threadId) || 0) < SYNC_INTERVAL_MS) return;
    _lastSync.set(threadId, now);
    updateActiveGame(threadId, (s) => {
        if (!s || typeof s !== 'object') return;
        if (liveState.scores && typeof liveState.scores === 'object') {
            s.scores = { ...liveState.scores };
        }
        if (liveState.players && typeof liveState.players === 'object') {
            const copy = {};
            for (const [uid, p] of Object.entries(liveState.players)) {
                copy[uid] = { ...p };
            }
            s.players = copy;
        }
        if (liveState.playerStats && typeof liveState.playerStats === 'object') {
            const copy = {};
            for (const [uid, p] of Object.entries(liveState.playerStats)) {
                copy[uid] = { ...p };
            }
            s.playerStats = copy;
        }
    }).catch(() => {});
}

/**
 * Clear the debounce timer for a game (call when the game ends).
 * @param {string} threadId
 */
function clearSyncTimer(threadId) {
    _lastSync.delete(threadId);
}

module.exports = { syncGameScores, clearSyncTimer };
