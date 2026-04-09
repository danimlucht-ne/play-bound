const test = require('node:test');
const assert = require('node:assert/strict');

const state = require('../src/bot/state');

test('state exports expected map-backed runtime stores', () => {
  const mapKeys = [
    'activeSprints',
    'activeCaptions',
    'activeTunes',
    'activeUnscrambles',
    'activeGiveaways',
    'activeMovieGames',
    'storyLastUserId',
    'scheduledGames',
    'activeDuels',
  ];

  for (const key of mapKeys) {
    assert.equal(state[key] instanceof Map, true, `${key} should be a Map`);
  }

  assert.equal(Array.isArray(state.WORDS), true);
  assert.equal(Array.isArray(state.PHRASES), true);
  assert.equal(typeof state.ACHIEVEMENTS_DB, 'object');
});
