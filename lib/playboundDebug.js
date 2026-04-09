'use strict';

/**
 * Opt-in verbose logging for production hosts (voice state transitions, redirect hits, etc.).
 * Set `PLAYBOUND_DEBUG=1` in `.env` when troubleshooting.
 */
function playboundDebugEnabled() {
    const v = process.env.PLAYBOUND_DEBUG;
    return v === '1' || v === 'true' || v === 'yes';
}

function playboundDebugLog(...args) {
    if (playboundDebugEnabled()) console.log(...args);
}

module.exports = { playboundDebugEnabled, playboundDebugLog };
