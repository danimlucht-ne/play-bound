'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isCompetitiveLedgerLabel, competitiveLedgerLabelsForMatch } = require('../lib/competitivePoints');

test('isCompetitiveLedgerLabel accepts tagged mini-game labels', () => {
    assert.equal(isCompetitiveLedgerLabel('trivia'), true);
    assert.equal(isCompetitiveLedgerLabel('TRIVIA'), true);
});

test('isCompetitiveLedgerLabel rejects empty, all, and non-game labels', () => {
    assert.equal(isCompetitiveLedgerLabel(''), false);
    assert.equal(isCompetitiveLedgerLabel('all'), false);
    assert.equal(isCompetitiveLedgerLabel('admin_adjust:1'), false);
});

test('competitiveLedgerLabelsForMatch omits all and returns lowercase strings', () => {
    const labels = competitiveLedgerLabelsForMatch();
    assert.ok(Array.isArray(labels));
    assert.ok(labels.length > 0);
    assert.ok(!labels.includes('all'));
    for (const L of labels) {
        assert.equal(L, String(L).toLowerCase());
    }
});
