'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { GAME_REGISTRY, mergeGameWithOverrides } = require('../lib/gamePlatform/registry');
const { tagCreditsOfficialRankedWar } = require('../lib/gameClassification');
const { pickRankedFeaturedTags } = require('../lib/gamePlatform/rankedFeaturedPick');
const {
    partitionLedger,
    aggregateFinalHourSlice,
    computeOfficialTeamValues,
    getWarPhase,
    getPhaseBounds,
} = require('../lib/engagement/warScoring');
const { computeRankedFeaturedWarBonus } = require('../lib/engagement/rankedFeaturedWarBonus');
const { tagCountsForMission } = require('../lib/engagement/missionGates');

test('GAME_REGISTRY exposes eligibility flags for all platform tags', () => {
    for (const t of Object.keys(GAME_REGISTRY)) {
        const g = GAME_REGISTRY[t];
        assert.equal(typeof g.duelEligible, 'boolean');
        assert.equal(typeof g.missionEligible, 'boolean');
        assert.equal(typeof g.featuredEligible, 'boolean');
        assert.equal(typeof g.seasonalPoolEligible, 'boolean');
    }
});

test('mergeGameWithOverrides preserves engagement flags when not overridden', () => {
    const base = GAME_REGISTRY.risk_roll;
    const m = mergeGameWithOverrides(base, { enabled: false });
    assert.equal(m.duelEligible, base.duelEligible);
    assert.equal(m.missionEligible, base.missionEligible);
});

test('ranked eligibility filter: social platform tags off by default', () => {
    const settings = { socialGamesRankedAllowed: false };
    assert.equal(tagCreditsOfficialRankedWar('lie_detector', settings), false);
    assert.equal(tagCreditsOfficialRankedWar('risk_roll', settings), true);
});

test('pickRankedFeaturedTags is deterministic and subset of active pool', () => {
    const active = ['risk_roll', 'lie_detector', 'dice_duel'];
    const resolve = (t) => GAME_REGISTRY[t] || null;
    const a = pickRankedFeaturedTags('2026-04-15', active, resolve);
    const b = pickRankedFeaturedTags('2026-04-15', active, resolve);
    assert.deepEqual(a, b);
    assert.ok(a.length <= 2);
    for (const t of a) assert.ok(active.includes(t));
    assert.ok(!a.includes('lie_detector'));
});

test('ranked featured war bonus is capped and zero when tag not highlighted', () => {
    const x = computeRankedFeaturedWarBonus({
        basePoints: 100,
        gameTag: 'risk_roll',
        rankedFeaturedTags: ['dice_duel'],
        bonusCap: 3,
    });
    assert.equal(x.bonus, 0);
    const y = computeRankedFeaturedWarBonus({
        basePoints: 100,
        gameTag: 'risk_roll',
        rankedFeaturedTags: ['risk_roll'],
        bonusCap: 3,
    });
    assert.equal(y.bonus, 3);
});

test('partitionLedger: featured_only drops non-featured rows in final hour', () => {
    const fhStart = new Date('2026-04-15T10:00:00Z').getTime();
    const ledger = [
        { at: new Date('2026-04-15T09:00:00Z'), userId: 'u1', gameTag: 'risk_roll', counted: 5, raw: 5 },
        { at: new Date('2026-04-15T11:00:00Z'), userId: 'u1', gameTag: 'risk_roll', counted: 4, raw: 4 },
        { at: new Date('2026-04-15T11:00:00Z'), userId: 'u1', gameTag: 'dice_duel', counted: 6, raw: 6 },
    ];
    const { preMap, fhMap } = partitionLedger(ledger, fhStart, 'featured_only', new Set(['risk_roll']));
    assert.equal(preMap.u1, 5);
    assert.equal(fhMap.u1, 4);
});

test('aggregateFinalHourSlice: top5_only sums top five per-user totals', () => {
    const v = aggregateFinalHourSlice([10, 3, 8, 1, 9, 7], 'top5_only');
    assert.equal(v, 10 + 9 + 8 + 7 + 3);
});

test('getWarPhase respects prep and final hour bounds', () => {
    const ch = {
        createdAt: new Date('2026-04-15T08:00:00Z'),
        endAt: new Date('2026-04-15T12:00:00Z'),
        prepMinutes: 60,
        finalHourMinutes: 60,
        prepEndsAt: new Date('2026-04-15T09:00:00Z'),
        finalHourStartsAt: new Date('2026-04-15T11:00:00Z'),
        finalHourMode: 'none',
        battleFactions: ['A', 'B'],
        participantsByFaction: new Map([
            ['A', ['u1']],
            ['B', ['u2']],
        ]),
    };
    assert.equal(getWarPhase(ch, new Date('2026-04-15T08:30:00Z')), 'prep');
    assert.equal(getWarPhase(ch, new Date('2026-04-15T10:00:00Z')), 'active');
    assert.equal(getWarPhase(ch, new Date('2026-04-15T11:30:00Z')), 'final_hour');
});

test('computeOfficialTeamValues uses ledger when finalHourMode active', () => {
    const challenge = {
        challengeMode: 'ranked',
        scoringMode: 'total_points',
        topN: 5,
        finalHourMode: 'top5_only',
        finalHourMinutes: 60,
        prepMinutes: 0,
        createdAt: new Date('2026-04-15T08:00:00Z'),
        endAt: new Date('2026-04-15T14:00:00Z'),
        prepEndsAt: new Date('2026-04-15T08:00:00Z'),
        finalHourStartsAt: new Date('2026-04-15T13:00:00Z'),
        factionA: 'A',
        factionB: 'B',
        participantsA: ['u1'],
        participantsB: ['u2'],
        warFeaturedTags: [],
        warPointLedger: [
            { at: new Date('2026-04-15T12:00:00Z'), userId: 'u1', gameTag: 'risk_roll', counted: 10, raw: 10 },
            { at: new Date('2026-04-15T13:30:00Z'), userId: 'u1', gameTag: 'risk_roll', counted: 4, raw: 4 },
            { at: new Date('2026-04-15T13:30:00Z'), userId: 'u2', gameTag: 'risk_roll', counted: 20, raw: 20 },
        ],
    };
    const { teams, usedLedger } = computeOfficialTeamValues(challenge, {
        getScoreByUser: () => 0,
    });
    assert.equal(usedLedger, true);
    const a = teams.find((t) => t.name === 'A');
    const b = teams.find((t) => t.name === 'B');
    assert.ok(a.value < b.value);
});

test('mission tag gate: social excluded unless allowBroaderPool', () => {
    const def = { allowBroaderPool: false };
    const social = GAME_REGISTRY.lie_detector;
    const ranked = GAME_REGISTRY.risk_roll;
    assert.equal(tagCountsForMission(def, social), false);
    assert.equal(tagCountsForMission(def, ranked), true);
});

test('duel Elo expected score is 0.5 for equal ratings', () => {
    const expectedScore = (rA, rB) => 1 / (1 + 10 ** ((rB - rA) / 400));
    assert.ok(Math.abs(expectedScore(1500, 1500) - 0.5) < 1e-9);
});
