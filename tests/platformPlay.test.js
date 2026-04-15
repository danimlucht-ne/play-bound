const test = require('node:test');
const assert = require('node:assert/strict');

const { clearModule, repoPath, withMockedModules } = require('./routerTestUtils');

const platformPlayPath = repoPath('games', 'platformPlay.js');
const dbPath = repoPath('lib', 'db.js');
const utilsPath = repoPath('lib', 'utils.js');
const rotationPath = repoPath('lib', 'gamePlatform', 'rotation.js');
const configStorePath = repoPath('lib', 'gamePlatform', 'configStore.js');
const scoringPath = repoPath('lib', 'gamePlatform', 'scoring.js');
const analyticsPath = repoPath('lib', 'gamePlatform', 'analytics.js');
const factionChallengePath = repoPath('lib', 'factionChallenge.js');
const classificationPath = repoPath('lib', 'gameClassification.js');
const isBotDeveloperPath = repoPath('lib', 'isBotDeveloper.js');

function buildReactionRushDef() {
    return {
        tag: 'reaction_rush',
        displayName: 'Reaction Rush',
        enabled: true,
        rankedEligible: true,
        defaultBasePoints: 10,
        defaultCasualRewards: { first: 12, second: 5, participate: 2 },
        balancingConfig: { matchRounds: 1 },
    };
}

function loadPlatformPlay(overrides = {}) {
    clearModule(platformPlayPath);
    return withMockedModules(
        {
            [dbPath]:
                overrides.db || {
                    getUser: async () => ({ isPremium: false }),
                    checkAndIncrementDailyPlaygame: async () => ({
                        allowed: true,
                        countsForPoints: true,
                        message: null,
                    }),
                },
            [utilsPath]:
                overrides.utils || {
                    defaultGameThreadName: (name) => `${name} Thread`,
                },
            [rotationPath]:
                overrides.rotation || {
                    ensureRotationForDate: async () => ({
                        activeTags: ['reaction_rush'],
                        featuredTag: 'reaction_rush',
                    }),
                },
            [configStorePath]:
                overrides.configStore || {
                    getSettings: async () => ({ featuredCasualBonusPct: 10 }),
                    resolveGame: (tag) => (tag === 'reaction_rush' ? buildReactionRushDef() : null),
                },
            [scoringPath]:
                overrides.scoring || {
                    awardPlatformGameScore: async () => ({ factionChallengeCredit: null }),
                },
            [analyticsPath]:
                overrides.analytics || {
                    recordSessionStarted: async () => {},
                    recordSessionCompleted: async () => {},
                },
            [factionChallengePath]:
                overrides.factionChallenge || {
                    getFactionChallengeOverlapWarning: async () => '',
                    isUserEnrolledInActiveFactionChallenge: async () => false,
                },
            [classificationPath]:
                overrides.classification || {
                    FactionCreditReasonCode: {
                        HOSTED_EXCLUDED_FROM_RANKED: 'HOSTED_EXCLUDED_FROM_RANKED',
                        NOT_RANKED_ELIGIBLE_PLATFORM: 'NOT_RANKED_ELIGIBLE_PLATFORM',
                        SOCIAL_RANKED_DISABLED: 'SOCIAL_RANKED_DISABLED',
                        TAG_NOT_IN_WAR_POOL: 'TAG_NOT_IN_WAR_POOL',
                    },
                },
            [isBotDeveloperPath]:
                overrides.isBotDeveloper || {
                    isBotDeveloper: () => false,
                },
        },
        () => require(platformPlayPath),
    );
}

function makeSlashInteraction(tag, overrides = {}) {
    const calls = {};
    return {
        guildId: overrides.guildId ?? 'guild-1',
        user: overrides.user || { id: 'user-1' },
        channel: overrides.channel || null,
        options: {
            getString(name, required) {
                if (name === 'game') return tag;
                if (name === 'thread_name') return overrides.threadName ?? null;
                return required ? null : null;
            },
            getBoolean(name) {
                return overrides[name] ?? null;
            },
        },
        async reply(payload) {
            calls.reply = payload;
            return payload;
        },
        async deferReply(payload) {
            calls.deferReply = payload;
        },
        async editReply(payload) {
            calls.editReply = payload;
            return payload;
        },
        calls,
    };
}

test('handleSlashPlaygame rejects games outside the daily rotation for normal users', async () => {
    const { handleSlashPlaygame } = loadPlatformPlay({
        rotation: {
            ensureRotationForDate: async () => ({
                activeTags: ['risk_roll'],
                featuredTag: 'risk_roll',
            }),
        },
        configStore: {
            getSettings: async () => ({}),
            resolveGame: () => buildReactionRushDef(),
        },
    });

    const interaction = makeSlashInteraction('reaction_rush');
    await handleSlashPlaygame(interaction, {});

    assert.match(interaction.calls.reply.content, /today.?s rotation/i);
    assert.equal(interaction.calls.reply.ephemeral, true);
});

test('launchPlatformGameThread plus handlePlatformButton completes a reaction rush session', async () => {
    process.env.PLAYBOUND_SPEED_DELAY_MS = '0';
    try {
    const scoringCalls = [];
    const analyticsCalls = [];
    const { launchPlatformGameThread, handlePlatformButton } = loadPlatformPlay({
        scoring: {
            awardPlatformGameScore: async (payload) => {
                scoringCalls.push(payload);
                return { factionChallengeCredit: null };
            },
        },
        analytics: {
            recordSessionStarted: async (tag) => {
                analyticsCalls.push(['start', tag]);
            },
            recordSessionCompleted: async (tag, base) => {
                analyticsCalls.push(['complete', tag, base]);
            },
        },
    });

    /** Threadless reaction_rush uses editReply then followUp for the round prompt. */
    const ephemeralSends = [];
    const interaction = {
        guildId: 'guild-1',
        user: { id: 'host-1' },
        channel: { id: 'channel-1' },
        async editReply(payload) {
            ephemeralSends.push(payload);
            return { id: 'msg-intro', ...payload };
        },
        async followUp(payload) {
            ephemeralSends.push(payload);
            return { id: 'msg-question', ...payload };
        },
    };

    const out = await launchPlatformGameThread({
        interaction,
        client: { id: 'client-1' },
        tag: 'reaction_rush',
        threadName: 'Reaction Rush Thread',
        bypassRotation: true,
    });

    assert.equal(out.ok, true);
    assert.equal(out.threadless, true);
    assert.equal(analyticsCalls[0][0], 'start');
    const questionMessage = ephemeralSends.find((p) =>
        (p.components || []).some((row) =>
            (row.components || []).some((c) => {
                const id = c.data?.custom_id || c.data?.customId || '';
                return id.includes('|rru|');
            }),
        ),
    );
    assert.ok(questionMessage);
    assert.ok(Array.isArray(questionMessage.components));
    assert.ok(questionMessage.components.length > 0);
    // The reaction rush prompt can be sum, difference, double, sequence, or compare.
    // Extract all button values and find the correct one by solving the prompt.
    const allButtons = questionMessage.components.flatMap((row) => row.components);
    assert.ok(allButtons.length > 0);
    let correctAnswer;
    const sumMatch = /What is (\d+) \+ (\d+)\?/.exec(questionMessage.content);
    const diffMatch = /What is (\d+) - (\d+)\?/.exec(questionMessage.content);
    const doubleMatch = /What is double (\d+)\?/.exec(questionMessage.content);
    const seqMatch = /What comes next\? (\d+), (\d+), (\d+), \?/.exec(questionMessage.content);
    const compareMatch = /Which number is larger: (\d+) or (\d+)\?/.exec(questionMessage.content);
    if (sumMatch) correctAnswer = String(Number(sumMatch[1]) + Number(sumMatch[2]));
    else if (diffMatch) correctAnswer = String(Number(diffMatch[1]) - Number(diffMatch[2]));
    else if (doubleMatch) correctAnswer = String(Number(doubleMatch[1]) * 2);
    else if (seqMatch) {
        const step = Number(seqMatch[2]) - Number(seqMatch[1]);
        correctAnswer = String(Number(seqMatch[3]) + step);
    } else if (compareMatch) correctAnswer = String(Math.max(Number(compareMatch[1]), Number(compareMatch[2])));
    else throw new Error('Unknown reaction rush prompt format: ' + questionMessage.content);
    const button = allButtons.find((component) => {
        const id = component.data.custom_id || component.data.customId;
        return id && id.split('|')[4] === correctAnswer;
    });
    assert.ok(button, `No button found for answer ${correctAnswer}`);
    const customId = button.data.custom_id || button.data.customId;

    const buttonCalls = {};
    const buttonInteraction = {
        customId: customId.replace(`|${correctAnswer}`, `|${correctAnswer}`),
        user: { id: 'host-1' },
        isButton: () => true,
        message: { id: 'msg-question', ...questionMessage },
        channel: { id: 'channel-1' },
        async reply(payload) {
            buttonCalls.reply = payload;
            return payload;
        },
        async update(payload) {
            buttonCalls.update = payload;
            return payload;
        },
        async followUp(payload) {
            buttonCalls.followUp = payload;
            return payload;
        },
    };

    const handled = await handlePlatformButton(buttonInteraction, { id: 'client-1' });

    assert.equal(handled, true);
    assert.ok(buttonCalls.update);
    assert.equal(buttonCalls.update.components.length, 0);
    assert.equal(scoringCalls.length, 1);
    assert.equal(scoringCalls[0].gameTag, 'reaction_rush');
    assert.equal(scoringCalls[0].userId, 'host-1');
    assert.deepEqual(analyticsCalls.at(-1), ['complete', 'reaction_rush', 12]);
    } finally {
        delete process.env.PLAYBOUND_SPEED_DELAY_MS;
    }
});
