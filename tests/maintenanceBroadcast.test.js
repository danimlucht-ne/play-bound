'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    formatDurationHuman,
    shouldAttemptAdvanceBroadcast,
} = require('../lib/maintenanceBroadcast');

test('formatDurationHuman covers days hours minutes', () => {
    assert.equal(formatDurationHuman(60000), '1 minute');
    assert.equal(formatDurationHuman(3600000), '1 hour');
    assert.equal(formatDurationHuman(3660000), '1 hour and 1 minute');
    assert.match(formatDurationHuman(90000000), /1 day/);
});

test('shouldAttemptAdvanceBroadcast respects start and max lead', () => {
    const w = { startMs: 1_000_000, endMs: 1_000_000 + 3600000 };
    assert.equal(shouldAttemptAdvanceBroadcast(500_000, w), true);
    assert.equal(shouldAttemptAdvanceBroadcast(1_000_000, w), false);
    const wFar = { startMs: 5_000_000, endMs: 5_000_000 + 3600000 };
    process.env.PLAYBOUND_MAINTENANCE_BROADCAST_MAX_LEAD_MS = '3600000';
    assert.equal(shouldAttemptAdvanceBroadcast(0, wFar), false);
    assert.equal(shouldAttemptAdvanceBroadcast(1_500_000, wFar), true);
    delete process.env.PLAYBOUND_MAINTENANCE_BROADCAST_MAX_LEAD_MS;
});
