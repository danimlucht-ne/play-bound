'use strict';

/**
 * Block **new** game/event schedules whose start time falls inside a maintenance window
 * (intentional bot downtime). Set both env vars to ISO 8601 UTC strings, e.g.
 * `2026-04-10T14:00:00.000Z`.
 *
 * PLAYBOUND_MAINTENANCE_SCHEDULE_START_UTC — window start (inclusive)
 * PLAYBOUND_MAINTENANCE_SCHEDULE_END_UTC   — window end (exclusive)
 * PLAYBOUND_MAINTENANCE_SCHEDULE_MESSAGE   — optional override for user-facing text (delayed schedules only)
 *
 * PLAYBOUND_MAINTENANCE_GAME_START_MESSAGE — optional override when blocking **immediate** starts
 * (during the window, or session would still be running when maintenance begins).
 */

const { logOpsEvent } = require('./opsEventLog');

const ENV_START = 'PLAYBOUND_MAINTENANCE_SCHEDULE_START_UTC';
const ENV_END = 'PLAYBOUND_MAINTENANCE_SCHEDULE_END_UTC';
const ENV_MSG = 'PLAYBOUND_MAINTENANCE_SCHEDULE_MESSAGE';
const ENV_GAME_START_MSG = 'PLAYBOUND_MAINTENANCE_GAME_START_MESSAGE';

function parseIsoMs(s) {
    if (s == null || String(s).trim() === '') return null;
    const t = Date.parse(String(s).trim());
    return Number.isFinite(t) ? t : null;
}

/**
 * @returns {{ startMs: number, endMs: number } | null}
 */
function getActiveMaintenanceWindow() {
    const startMs = parseIsoMs(process.env[ENV_START]);
    const endMs = parseIsoMs(process.env[ENV_END]);
    if (startMs == null || endMs == null) return null;
    if (startMs >= endMs) {
        console.warn('[maintenanceScheduling] Invalid window (start >= end); ignoring.');
        return null;
    }
    return { startMs, endMs };
}

/**
 * @param {number} scheduledStartMs epoch ms when the game or recurring run would start
 * @returns {string|null} user-facing message if blocked
 */
function getGameSchedulingDenialMessage(scheduledStartMs) {
    const w = getActiveMaintenanceWindow();
    if (!w) return null;
    const t = Number(scheduledStartMs);
    if (!Number.isFinite(t)) return null;
    if (t >= w.startMs && t < w.endMs) {
        const custom = process.env[ENV_MSG];
        if (custom != null && String(custom).trim() !== '') {
            return String(custom).trim();
        }
        return (
            '⏸️ **Scheduling is paused** for bot maintenance. ' +
            `Pick a start time **on or after** ${new Date(w.endMs).toISOString()} (UTC), or try again after maintenance.`
        );
    }
    return null;
}

class GameSchedulingBlockedError extends Error {
    /**
     * @param {string} userMessage
     */
    constructor(userMessage) {
        super(userMessage);
        this.name = 'GameSchedulingBlockedError';
        /** @type {string} */
        this.userMessage = userMessage;
        this.code = 'GAME_SCHEDULING_BLOCKED';
    }
}

/**
 * @param {number} scheduledStartMs
 * @param {Record<string, unknown>} [ctx]
 */
function throwIfGameSchedulingBlocked(scheduledStartMs, ctx = {}) {
    const msg = getGameSchedulingDenialMessage(scheduledStartMs);
    if (msg) {
        const w = getActiveMaintenanceWindow();
        logOpsEvent('maintenance_block', {
            ...ctx,
            rule: 'scheduled_start_in_window',
            scheduledStartMs: Number(scheduledStartMs),
            windowStartMs: w?.startMs ?? null,
            windowEndMs: w?.endMs ?? null,
        });
        throw new GameSchedulingBlockedError(msg);
    }
}

/**
 * @param {'during'|'overlap'} kind
 * @param {{ startMs: number, endMs: number }} w
 */
function immediateStartUserMessage(kind, w) {
    const o = process.env[ENV_GAME_START_MSG];
    if (o != null && String(o).trim() !== '') {
        return String(o).trim();
    }
    if (kind === 'during') {
        return '⏸️ The bot is in a **maintenance window**. New games cannot be started until maintenance ends.';
    }
    return (
        '⏸️ This session would still be running when **bot maintenance** begins ' +
        `(${new Date(w.startMs).toISOString()}–${new Date(w.endMs).toISOString()} UTC). ` +
        'Shorten duration or other limits, or wait until after maintenance.'
    );
}

/**
 * Block any new game while `now` is inside the maintenance window.
 * @param {number} nowMs
 * @param {Record<string, unknown>} [ctx]
 */
function throwIfNewGamesBlockedDuringMaintenanceWindow(nowMs, ctx = {}) {
    const w = getActiveMaintenanceWindow();
    if (!w) return;
    const now = Number(nowMs);
    if (!Number.isFinite(now)) return;
    if (now >= w.startMs && now < w.endMs) {
        logOpsEvent('maintenance_block', {
            ...ctx,
            rule: 'immediate_during_window',
            nowMs: now,
            windowStartMs: w.startMs,
            windowEndMs: w.endMs,
        });
        throw new GameSchedulingBlockedError(immediateStartUserMessage('during', w));
    }
}

/**
 * Block if [nowMs, nowMs + durationMs) overlaps [maintStart, maintEnd).
 * @param {number} nowMs
 * @param {number} durationMs must be > 0
 * @param {Record<string, unknown>} [ctx]
 */
function throwIfSessionWouldOverlapMaintenance(nowMs, durationMs, ctx = {}) {
    const w = getActiveMaintenanceWindow();
    if (!w) return;
    const now = Number(nowMs);
    const dur = Number(durationMs);
    if (!Number.isFinite(now) || !Number.isFinite(dur) || dur <= 0) return;
    if (now >= w.endMs) return;
    if (now < w.endMs && now + dur > w.startMs) {
        logOpsEvent('maintenance_block', {
            ...ctx,
            rule: 'session_overlap',
            nowMs: now,
            durationMs: dur,
            windowStartMs: w.startMs,
            windowEndMs: w.endMs,
        });
        throw new GameSchedulingBlockedError(immediateStartUserMessage('overlap', w));
    }
}

/**
 * During-window block always; overlap block when `durationMs` is a positive finite estimate.
 * @param {number} nowMs
 * @param {number|null|undefined} durationMs
 * @param {Record<string, unknown>} [ctx]
 */
function throwIfImmediateGameStartBlockedByMaintenance(nowMs, durationMs, ctx = {}) {
    throwIfNewGamesBlockedDuringMaintenanceWindow(nowMs, ctx);
    if (durationMs != null) {
        const dur = Number(durationMs);
        if (Number.isFinite(dur) && dur > 0) {
            throwIfSessionWouldOverlapMaintenance(nowMs, dur, ctx);
        }
    }
}

module.exports = {
    getActiveMaintenanceWindow,
    getGameSchedulingDenialMessage,
    throwIfGameSchedulingBlocked,
    throwIfImmediateGameStartBlockedByMaintenance,
    throwIfNewGamesBlockedDuringMaintenanceWindow,
    throwIfSessionWouldOverlapMaintenance,
    GameSchedulingBlockedError,
};
