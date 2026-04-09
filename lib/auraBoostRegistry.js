'use strict';

/** @type {Map<string, () => void>} */
const targets = new Map();

function registerAuraBoostTarget(threadOrMessageId, applyFn) {
    targets.set(threadOrMessageId, applyFn);
}

function unregisterAuraBoostTarget(threadOrMessageId) {
    targets.delete(threadOrMessageId);
}

/** Apply in-memory premiumAuraBoost for the active game keyed by Game.threadId. */
function runAuraBoost(threadOrMessageId) {
    const fn = targets.get(threadOrMessageId);
    if (!fn) return false;
    fn();
    return true;
}

module.exports = {
    registerAuraBoostTarget,
    unregisterAuraBoostTarget,
    runAuraBoost,
};
