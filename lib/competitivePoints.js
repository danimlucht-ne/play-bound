'use strict';

const { VALID_TAGS } = require('./factionChallengeTags');

/**
 * Ledger labels that count toward competitive/global stats (mini-games with explicit addScore tags).
 * Excludes `all` (challenge filter only, never a ledger label).
 */
function isCompetitiveLedgerLabel(label) {
    const s = String(label || '').trim().toLowerCase();
    if (!s || s === 'all') return false;
    return VALID_TAGS.has(s);
}

/** For Mongo `$in` filters. */
function competitiveLedgerLabelsForMatch() {
    return [...VALID_TAGS].filter((x) => x !== 'all').map((x) => String(x).toLowerCase());
}

module.exports = {
    isCompetitiveLedgerLabel,
    competitiveLedgerLabelsForMatch,
};
