const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeSongTitle,
  parsePointValues,
  MAX_POINTS_PER_PLACEMENT,
  isFuzzyMatch,
} = require('../lib/utils');

test('normalizeSongTitle removes common metadata suffixes', () => {
  assert.equal(normalizeSongTitle('My Song (feat. Artist)'), 'my song');
  assert.equal(normalizeSongTitle('Classic Hit [2011 Remaster]'), 'classic hit');
});

test('parsePointValues clamps negatives and large values', () => {
  assert.deepEqual(parsePointValues('10,-2,5001,abc'), [10, 0, MAX_POINTS_PER_PLACEMENT, 0]);
});

test('isFuzzyMatch still matches minor typos', () => {
  assert.equal(isFuzzyMatch('bohemain rhapsody', 'bohemian rhapsody'), true);
  assert.equal(isFuzzyMatch('completely different', 'bohemian rhapsody'), false);
});
