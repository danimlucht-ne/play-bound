'use strict';

/**
 * @param {{ repeat_days?: number|null, repeat_hrs?: number|null }} opts
 * @returns {number} milliseconds between runs (>= 3600000 enforced for Premium recurring)
 */
function recurringIntervalMs(opts) {
    const d = Math.max(0, Math.min(30, Number(opts?.repeat_days) || 0));
    const h = Math.max(0, Math.min(168, Number(opts?.repeat_hrs) || 0));
    return d * 86400000 + h * 3600000;
}

/** @returns {{ intervalDays: number, intervalHours: number }} */
function splitRecurringParts(opts) {
    const d = Math.max(0, Math.min(30, Number(opts?.repeat_days) || 0));
    const h = Math.max(0, Math.min(168, Number(opts?.repeat_hrs) || 0));
    return { intervalDays: d, intervalHours: h };
}

module.exports = { recurringIntervalMs, splitRecurringParts };
