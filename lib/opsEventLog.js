'use strict';

/**
 * Structured one-line JSON for grep / log aggregators.
 * Disable with PLAYBOUND_OPS_EVENT_LOG=0 if volume is an issue.
 * Disable only high-volume interaction receipt lines with PLAYBOUND_INTERACTION_EVENT_LOG=0.
 */
function opsEventLogMuted() {
    const v = process.env.PLAYBOUND_OPS_EVENT_LOG;
    return v === '0' || v === 'false' || v === 'no';
}

function interactionEventLogMuted() {
    const v = process.env.PLAYBOUND_INTERACTION_EVENT_LOG;
    return v === '0' || v === 'false' || v === 'no';
}

function shouldLogInteractionReceived() {
    return !opsEventLogMuted() && !interactionEventLogMuted();
}

/**
 * @param {string} category
 * @param {Record<string, unknown>} data
 */
function logOpsEvent(category, data) {
    if (opsEventLogMuted()) return;
    const line = {
        ts: new Date().toISOString(),
        source: 'PlayBound',
        category,
        ...data,
    };
    console.log(`[PlayBound:ops] ${JSON.stringify(line)}`);
}

module.exports = { logOpsEvent, opsEventLogMuted, interactionEventLogMuted, shouldLogInteractionReceived };
