'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    computeFactionWarEndPersonalCredits,
    FACTION_WAR_MAX_PERSONAL_CREDITS,
    FACTION_WAR_PARTICIPATION_CREDITS,
} = require('../lib/factionWarEconomyConstants');

test('faction war end personal credits: participation + top-5 ladder, max 150', () => {
    assert.equal(computeFactionWarEndPersonalCredits(0), FACTION_WAR_PARTICIPATION_CREDITS + 100);
    assert.equal(computeFactionWarEndPersonalCredits(1), FACTION_WAR_PARTICIPATION_CREDITS + 70);
    assert.equal(computeFactionWarEndPersonalCredits(2), FACTION_WAR_PARTICIPATION_CREDITS + 50);
    assert.equal(computeFactionWarEndPersonalCredits(3), FACTION_WAR_PARTICIPATION_CREDITS + 30);
    assert.equal(computeFactionWarEndPersonalCredits(4), FACTION_WAR_PARTICIPATION_CREDITS + 10);
    assert.equal(computeFactionWarEndPersonalCredits(5), FACTION_WAR_PARTICIPATION_CREDITS);
    assert.equal(computeFactionWarEndPersonalCredits(99), FACTION_WAR_PARTICIPATION_CREDITS);
    assert.equal(computeFactionWarEndPersonalCredits(0), FACTION_WAR_MAX_PERSONAL_CREDITS);
});
