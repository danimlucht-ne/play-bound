'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CREDITS, ARENA_SCORE, creditsVsArenaBlurb } = require('../lib/pointBranding');

test('pointBranding exports stable economy vs competitive names', () => {
    assert.equal(CREDITS, 'Credits');
    assert.equal(ARENA_SCORE, 'Arena score');
});

test('creditsVsArenaBlurb mentions both balances', () => {
    const b = creditsVsArenaBlurb();
    assert.match(b, /Credits/);
    assert.match(b, /Arena score/);
    assert.match(b, /\/factions/i);
});
