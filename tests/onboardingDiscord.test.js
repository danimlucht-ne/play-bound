const test = require('node:test');
const assert = require('node:assert/strict');

const { clearModule, repoPath, withMockedModules } = require('./routerTestUtils');

const onboardingDiscordPath = repoPath('lib', 'onboardingDiscord.js');
const onboardingServicePath = repoPath('lib', 'onboardingService.js');
const officialFactionJoinPath = repoPath('lib', 'officialFactionJoin.js');
const platformPlayPath = repoPath('games', 'platformPlay.js');
const rotationPath = repoPath('lib', 'gamePlatform', 'rotation.js');
const factionChallengePath = repoPath('lib', 'factionChallenge.js');
const configStorePath = repoPath('lib', 'gamePlatform', 'configStore.js');
const utilsPath = repoPath('lib', 'utils.js');

function loadOnboardingDiscord(overrides = {}) {
    clearModule(onboardingDiscordPath);
    return withMockedModules(
        {
            [onboardingServicePath]:
                overrides.onboardingService || {
                    STEP_WELCOME: 0,
                    STEP_FACTION: 1,
                    STEP_FIRST_GAME: 2,
                    STEP_POST_GAME: 3,
                    STEP_WARS: 4,
                    STEP_ROTATION: 5,
                    STEP_EXPLORE: 6,
                    STEP_COMPLETE: 7,
                    getOnboardingSnapshot: async () => ({ step: 0, skipped: false, complete: false }),
                    skipOnboarding: async () => ({}),
                    resumeOnboarding: async () => ({}),
                    goToNextStep: async () => ({}),
                    setStep: async () => ({}),
                    recordFactionJoined: async () => ({}),
                },
            [officialFactionJoinPath]:
                overrides.officialFactionJoin || {
                    joinOfficialFactionInGuild: async () => ({ ok: true, content: 'Joined Dragons' }),
                },
            [platformPlayPath]:
                overrides.platformPlay || {
                    launchPlatformGameThread: async () => ({ ok: true, thread: '#thread' }),
                    pickOnboardingGameTag: async () => 'risk_roll',
                },
            [rotationPath]:
                overrides.rotation || {
                    ensureRotationForDate: async () => ({ activeTags: ['risk_roll'], featuredTag: 'risk_roll' }),
                },
            [factionChallengePath]:
                overrides.factionChallenge || {
                    getActiveChallenge: async () => null,
                },
            [configStorePath]:
                overrides.configStore || {
                    getSettings: async () => ({}),
                    resolveGame: () => ({ displayName: 'Risk Roll' }),
                },
            [utilsPath]:
                overrides.utils || {
                    defaultGameThreadName: (name) => `${name} Thread`,
                },
        },
        () => require(onboardingDiscordPath),
    );
}

function makeCommandInteraction(flags = {}) {
    const calls = {};
    return {
        guildId: 'guild-1',
        user: { id: 'user-1' },
        options: {
            getBoolean(name) {
                return flags[name] ?? null;
            },
        },
        async reply(payload) {
            calls.reply = payload;
            return payload;
        },
        calls,
    };
}

function makeButtonInteraction(customId, overrides = {}) {
    const calls = {
        replies: [],
        updates: [],
        edits: [],
    };
    return {
        customId,
        guildId: overrides.guildId ?? 'guild-1',
        user: overrides.user || { id: 'user-1' },
        deferred: false,
        replied: false,
        isButton: () => true,
        async reply(payload) {
            calls.replies.push(payload);
            this.replied = true;
            return payload;
        },
        async update(payload) {
            calls.updates.push(payload);
            this.replied = true;
            return payload;
        },
        async deferUpdate() {
            calls.deferred = true;
            this.deferred = true;
        },
        async editReply(payload) {
            calls.edits.push(payload);
            return payload;
        },
        calls,
    };
}

test('handleOnboardingCommand skips the tour when skip=true', async () => {
    const skipCalls = [];
    const { handleOnboardingCommand } = loadOnboardingDiscord({
        onboardingService: {
            STEP_WELCOME: 0,
            STEP_FACTION: 1,
            STEP_FIRST_GAME: 2,
            STEP_POST_GAME: 3,
            STEP_WARS: 4,
            STEP_ROTATION: 5,
            STEP_EXPLORE: 6,
            STEP_COMPLETE: 7,
            skipOnboarding: async (uid) => {
                skipCalls.push(uid);
            },
            getOnboardingSnapshot: async () => ({ step: 0, skipped: false, complete: false }),
        },
    });

    const interaction = makeCommandInteraction({ skip: true });
    await handleOnboardingCommand(interaction);

    assert.deepEqual(skipCalls, ['user-1']);
    assert.match(interaction.calls.reply.content, /tour hidden/i);
    assert.equal(interaction.calls.reply.ephemeral, true);
});

test('handleOnboardingButton resumes a paused tour and refreshes the UI', async () => {
    let snapshotCall = 0;
    const resumeCalls = [];
    const { handleOnboardingButton } = loadOnboardingDiscord({
        onboardingService: {
            STEP_WELCOME: 0,
            STEP_FACTION: 1,
            STEP_FIRST_GAME: 2,
            STEP_POST_GAME: 3,
            STEP_WARS: 4,
            STEP_ROTATION: 5,
            STEP_EXPLORE: 6,
            STEP_COMPLETE: 7,
            getOnboardingSnapshot: async () => {
                snapshotCall += 1;
                if (snapshotCall === 1) return { skipped: true, complete: false, step: 0 };
                return { skipped: false, complete: false, step: 0 };
            },
            resumeOnboarding: async (uid) => {
                resumeCalls.push(uid);
            },
        },
    });

    const interaction = makeButtonInteraction('ob_resume');
    const handled = await handleOnboardingButton(interaction, {});

    assert.equal(handled, true);
    assert.deepEqual(resumeCalls, ['user-1']);
    assert.equal(interaction.calls.updates.length, 1);
    assert.equal(interaction.calls.updates[0].embeds[0].data.title, 'Welcome');
});

test('handleOnboardingButton joins a faction and advances the user', async () => {
    const joinCalls = [];
    const recordCalls = [];
    const { handleOnboardingButton } = loadOnboardingDiscord({
        onboardingService: {
            STEP_WELCOME: 0,
            STEP_FACTION: 1,
            STEP_FIRST_GAME: 2,
            STEP_POST_GAME: 3,
            STEP_WARS: 4,
            STEP_ROTATION: 5,
            STEP_EXPLORE: 6,
            STEP_COMPLETE: 7,
            getOnboardingSnapshot: async () => ({ skipped: false, complete: false, step: 1 }),
            recordFactionJoined: async (uid) => {
                recordCalls.push(uid);
            },
        },
        officialFactionJoin: {
            joinOfficialFactionInGuild: async (_interaction, name) => {
                joinCalls.push(name);
                return { ok: true, content: 'Joined Dragons\nWelcome aboard.' };
            },
        },
    });

    const interaction = makeButtonInteraction('ob_fac_dragons');
    const handled = await handleOnboardingButton(interaction, {});

    assert.equal(handled, true);
    assert.equal(interaction.calls.deferred, true);
    assert.deepEqual(joinCalls, ['Dragons']);
    assert.deepEqual(recordCalls, ['user-1']);
    assert.match(interaction.calls.edits[0].content, /joined dragons/i);
});

test('handleOnboardingButton launches the quick game thread when onboarding play is tapped', async () => {
    const launchCalls = [];
    const { handleOnboardingButton } = loadOnboardingDiscord({
        onboardingService: {
            STEP_WELCOME: 0,
            STEP_FACTION: 1,
            STEP_FIRST_GAME: 2,
            STEP_POST_GAME: 3,
            STEP_WARS: 4,
            STEP_ROTATION: 5,
            STEP_EXPLORE: 6,
            STEP_COMPLETE: 7,
            getOnboardingSnapshot: async () => ({ skipped: false, complete: false, step: 2 }),
        },
        platformPlay: {
            pickOnboardingGameTag: async () => 'risk_roll',
            launchPlatformGameThread: async (payload) => {
                launchCalls.push(payload);
                return { ok: true, thread: '#risk-roll-thread' };
            },
        },
        configStore: {
            getSettings: async () => ({}),
            resolveGame: () => ({ displayName: 'Risk Roll' }),
        },
        utils: {
            defaultGameThreadName: (name) => `${name} Thread`,
        },
    });

    const interaction = makeButtonInteraction('ob_play');
    const handled = await handleOnboardingButton(interaction, { id: 'client-1' });

    assert.equal(handled, true);
    assert.equal(interaction.calls.deferred, true);
    assert.equal(launchCalls.length, 1);
    assert.equal(launchCalls[0].tag, 'risk_roll');
    assert.equal(launchCalls[0].threadName, 'Risk Roll Thread');
    assert.match(interaction.calls.edits[0].content, /\*\*thread:\*\*\s+#risk-roll-thread/i);
});
