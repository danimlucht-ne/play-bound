'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getActiveMaintenanceWindow,
    getGameSchedulingDenialMessage,
    throwIfGameSchedulingBlocked,
    throwIfImmediateGameStartBlockedByMaintenance,
    throwIfNewGamesBlockedDuringMaintenanceWindow,
    throwIfSessionWouldOverlapMaintenance,
    GameSchedulingBlockedError,
} = require('../lib/maintenanceScheduling');

const ENV_KEYS = [
    'PLAYBOUND_MAINTENANCE_SCHEDULE_START_UTC',
    'PLAYBOUND_MAINTENANCE_SCHEDULE_END_UTC',
    'PLAYBOUND_MAINTENANCE_SCHEDULE_MESSAGE',
    'PLAYBOUND_MAINTENANCE_GAME_START_MESSAGE',
];

function withMaintenanceEnv(values, fn) {
    const prev = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    Object.assign(process.env, values);
    try {
        fn();
    } finally {
        for (const key of ENV_KEYS) {
            if (prev[key] === undefined) delete process.env[key];
            else process.env[key] = prev[key];
        }
    }
}

test('maintenance scheduling parses valid windows and ignores invalid ones', () => {
    withMaintenanceEnv(
        {
            PLAYBOUND_MAINTENANCE_SCHEDULE_START_UTC: '2026-04-10T10:00:00.000Z',
            PLAYBOUND_MAINTENANCE_SCHEDULE_END_UTC: '2026-04-10T11:00:00.000Z',
        },
        () => {
            assert.deepEqual(getActiveMaintenanceWindow(), {
                startMs: Date.parse('2026-04-10T10:00:00.000Z'),
                endMs: Date.parse('2026-04-10T11:00:00.000Z'),
            });
        },
    );

    withMaintenanceEnv(
        {
            PLAYBOUND_MAINTENANCE_SCHEDULE_START_UTC: '2026-04-10T11:00:00.000Z',
            PLAYBOUND_MAINTENANCE_SCHEDULE_END_UTC: '2026-04-10T10:00:00.000Z',
        },
        () => {
            assert.equal(getActiveMaintenanceWindow(), null);
        },
    );
});

test('delayed schedules are blocked only when their start lands inside the maintenance window', () => {
    withMaintenanceEnv(
        {
            PLAYBOUND_MAINTENANCE_SCHEDULE_START_UTC: '2026-04-10T10:00:00.000Z',
            PLAYBOUND_MAINTENANCE_SCHEDULE_END_UTC: '2026-04-10T11:00:00.000Z',
            PLAYBOUND_MAINTENANCE_SCHEDULE_MESSAGE: 'custom delayed block',
        },
        () => {
            assert.equal(getGameSchedulingDenialMessage(Date.parse('2026-04-10T09:59:59.999Z')), null);
            assert.equal(
                getGameSchedulingDenialMessage(Date.parse('2026-04-10T10:00:00.000Z')),
                'custom delayed block',
            );
            assert.equal(
                getGameSchedulingDenialMessage(Date.parse('2026-04-10T10:30:00.000Z')),
                'custom delayed block',
            );
            assert.equal(getGameSchedulingDenialMessage(Date.parse('2026-04-10T11:00:00.000Z')), null);
            assert.throws(
                () => throwIfGameSchedulingBlocked(Date.parse('2026-04-10T10:15:00.000Z')),
                GameSchedulingBlockedError,
            );
        },
    );
});

test('immediate starts are blocked during maintenance and when estimated duration overlaps it', () => {
    withMaintenanceEnv(
        {
            PLAYBOUND_MAINTENANCE_SCHEDULE_START_UTC: '2026-04-10T10:00:00.000Z',
            PLAYBOUND_MAINTENANCE_SCHEDULE_END_UTC: '2026-04-10T11:00:00.000Z',
            PLAYBOUND_MAINTENANCE_GAME_START_MESSAGE: 'custom immediate block',
        },
        () => {
            assert.throws(
                () => throwIfNewGamesBlockedDuringMaintenanceWindow(Date.parse('2026-04-10T10:30:00.000Z')),
                /custom immediate block/,
            );
            assert.doesNotThrow(() =>
                throwIfSessionWouldOverlapMaintenance(
                    Date.parse('2026-04-10T09:00:00.000Z'),
                    60 * 60 * 1000,
                ),
            );
            assert.throws(
                () =>
                    throwIfSessionWouldOverlapMaintenance(
                        Date.parse('2026-04-10T09:30:00.000Z'),
                        31 * 60 * 1000,
                    ),
                /custom immediate block/,
            );
            assert.throws(
                () =>
                    throwIfImmediateGameStartBlockedByMaintenance(
                        Date.parse('2026-04-10T09:45:00.000Z'),
                        20 * 60 * 1000,
                    ),
                GameSchedulingBlockedError,
            );
        },
    );
});
