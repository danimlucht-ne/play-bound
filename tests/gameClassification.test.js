'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    classifyScoreTag,
    tagCreditsOfficialRankedWar,
    evaluateFactionWarCreditEligibility,
    validateRankedChallengeGameSelection,
    FactionCreditReasonCode,
} = require('../lib/gameClassification');

const settingsSocialOff = { socialGamesRankedAllowed: false };
const settingsSocialOn = { socialGamesRankedAllowed: true };

describe('gameClassification', () => {
    it('classifies platform vs hosted', () => {
        const p = classifyScoreTag('risk_roll', null);
        assert.equal(p.sourceType, 'platform');
        assert.equal(p.launchCommand, '/playgame');
        const h = classifyScoreTag('trivia', null);
        assert.equal(h.sourceType, 'hosted');
        assert.equal(h.launchCommand, '/trivia');
    });

    it('tagCreditsOfficialRankedWar rejects hosted', () => {
        assert.equal(tagCreditsOfficialRankedWar('trivia', settingsSocialOn), false);
        assert.equal(tagCreditsOfficialRankedWar('risk_roll', settingsSocialOn), true);
    });

    it('ranked challenge + hosted tag fails eligibility', () => {
        const challenge = {
            challengeMode: 'ranked',
            gameTypes: ['trivia'],
            gameType: 'trivia',
        };
        const r = evaluateFactionWarCreditEligibility(challenge, 'trivia', settingsSocialOn);
        assert.equal(r.ok, false);
        assert.equal(r.reasonCode, FactionCreditReasonCode.HOSTED_EXCLUDED_FROM_RANKED);
    });

    it('ranked challenge + platform ranked-eligible tag passes gate before roster checks', () => {
        const challenge = {
            challengeMode: 'ranked',
            gameTypes: ['risk_roll'],
            gameType: 'risk_roll',
        };
        const r = evaluateFactionWarCreditEligibility(challenge, 'risk_roll', settingsSocialOn);
        assert.equal(r.ok, true);
    });

    it('ranked challenge + all uses platform-only pool for match (hosted trivia out)', () => {
        const challenge = {
            challengeMode: 'ranked',
            gameTypes: ['all'],
            gameType: 'all',
        };
        const hosted = evaluateFactionWarCreditEligibility(challenge, 'trivia', settingsSocialOn);
        assert.equal(hosted.ok, false);
        const plat = evaluateFactionWarCreditEligibility(challenge, 'risk_roll', settingsSocialOn);
        assert.equal(plat.ok, true);
    });

    it('unranked challenge + hosted trivia allowed in explicit list', () => {
        const challenge = {
            challengeMode: 'unranked',
            gameTypes: ['trivia'],
            gameType: 'trivia',
        };
        const r = evaluateFactionWarCreditEligibility(challenge, 'trivia', settingsSocialOn);
        assert.equal(r.ok, true);
    });

    it('validateRankedChallengeGameSelection rejects hosted tags', () => {
        const errs = validateRankedChallengeGameSelection(['trivia', 'risk_roll'], settingsSocialOn);
        assert.ok(errs.some((e) => /hosted/i.test(e)));
    });

    it('validateRankedChallengeGameSelection allows platform tags', () => {
        const errs = validateRankedChallengeGameSelection(['risk_roll', 'target_21'], settingsSocialOn);
        assert.equal(errs.length, 0);
    });

    it('validateRankedChallengeGameSelection rejects non-ranked-eligible platform game', () => {
        const errs = validateRankedChallengeGameSelection(['vote_the_winner'], settingsSocialOn);
        assert.ok(errs.length > 0);
    });

    it('unranked all + hosted passes eligibility (local scoring)', () => {
        const challenge = { challengeMode: 'unranked', gameTypes: ['all'], gameType: 'all' };
        const r = evaluateFactionWarCreditEligibility(challenge, 'moviequotes', settingsSocialOn);
        assert.equal(r.ok, true);
    });
});
