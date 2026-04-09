'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { clearModule, repoPath, withMockedModules } = require('./routerTestUtils');

// ── Absolute paths for modules under test and their dependencies ──
const factionChallengePath = repoPath('lib', 'factionChallenge.js');
const factionProvisioningPath = repoPath('lib', 'factionProvisioning.js');
const modelsPath = repoPath('models.js');
const automatedPostsPath = repoPath('lib', 'automatedPosts.js');
const publicStatsExcludePath = repoPath('lib', 'publicStatsExclude.js');
const rankedFactionWarPath = repoPath('lib', 'rankedFactionWar.js');
const factionSeasonsPath = repoPath('lib', 'factionSeasons.js');
const configStorePath = repoPath('lib', 'gamePlatform', 'configStore.js');
const classificationPath = repoPath('lib', 'gameClassification.js');
const playboundDebugPath = repoPath('lib', 'playboundDebug.js');
const globalFactionsPath = repoPath('lib', 'globalFactions.js');
const factionChallengeTagsPath = repoPath('lib', 'factionChallengeTags.js');
const factionWarEconomyPayoutPath = repoPath('lib', 'factionWarEconomyPayout.js');

// ── Helpers ──

/** Build a minimal mock FactionChallenge document */
function mockChallenge(overrides = {}) {
    return {
        _id: overrides._id || 'ch-' + Math.random().toString(36).slice(2, 8),
        guildId: overrides.guildId || 'guild-1',
        status: overrides.status || 'active',
        factionA: overrides.factionA || null,
        factionB: overrides.factionB || null,
        battleFactions: overrides.battleFactions || null,
        endAt: overrides.endAt || new Date(Date.now() + 3600_000),
        participantsA: overrides.participantsA || [],
        participantsB: overrides.participantsB || [],
        scoresByUser: overrides.scoresByUser || new Map(),
        rawScoresByUser: overrides.rawScoresByUser || new Map(),
        countedPointsByUserTag: overrides.countedPointsByUserTag || new Map(),
        scoringMode: overrides.scoringMode || 'top_n_avg',
        topN: overrides.topN ?? 5,
        gameType: overrides.gameType || 'all',
        gameTypes: overrides.gameTypes || [],
        challengeMode: overrides.challengeMode || 'unranked',
        contributionCapsByTag: overrides.contributionCapsByTag || null,
        maxPerTeam: overrides.maxPerTeam ?? null,
        pointCap: overrides.pointCap ?? null,
        participantsByFaction: overrides.participantsByFaction || new Map(),
        markModified() {},
        async save() {},
    };
}

/**
 * Load factionChallenge.js with all heavy dependencies mocked out.
 * Only FactionChallenge.find / findOne are wired to the supplied data.
 */
function loadFactionChallenge(activeChallenges = []) {
    clearModule(factionChallengePath);
    return withMockedModules(
        {
            [modelsPath]: {
                FactionChallenge: {
                    find: async (query) => {
                        return activeChallenges.filter(
                            (c) =>
                                c.guildId === query.guildId &&
                                c.status === query.status &&
                                c.endAt > (query.endAt?.$gt || new Date()),
                        );
                    },
                    findOne: async (query) => {
                        return (
                            activeChallenges.find(
                                (c) =>
                                    c.guildId === query.guildId &&
                                    c.status === query.status &&
                                    c.endAt > (query.endAt?.$gt || new Date()),
                            ) || null
                        );
                    },
                    findById: async () => null,
                    findOneAndUpdate: async () => null,
                },
                Faction: { findOne: async () => null, updateOne: async () => {} },
                SystemConfig: { findOne: async () => null, findOneAndUpdate: async () => null },
            },
            [automatedPostsPath]: { automatedServerPostsEnabled: () => false },
            [publicStatsExcludePath]: { isGuildExcludedFromGlobalCounts: () => false },
            [rankedFactionWarPath]: {
                isChallengeRanked: (ch) => (ch.challengeMode || 'ranked') !== 'unranked',
            },
            [factionSeasonsPath]: { recordRankedWarSeasonStats: async () => {} },
            [configStorePath]: { getSettings: async () => ({}) },
            [classificationPath]: {
                evaluateFactionWarCreditEligibility: () => ({ ok: true, reasonCode: 'credited', userMessage: null, logDetail: '' }),
                FactionCreditReasonCode: { CREDITED: 'credited', NO_POINTS_OR_FACTION: 'no_points_or_faction', NO_GAME_TAG: 'no_game_tag', NO_ACTIVE_CHALLENGE: 'no_active_challenge', TAG_NOT_IN_WAR_POOL: 'tag_not_in_war_pool', HOSTED_EXCLUDED_FROM_RANKED: 'hosted_excluded_from_ranked', NOT_RANKED_ELIGIBLE_PLATFORM: 'not_ranked_eligible_platform', SOCIAL_RANKED_DISABLED: 'social_ranked_disabled', WRONG_FACTION: 'wrong_faction', NOT_ENROLLED: 'not_enrolled' },
                isHostedScoreTag: () => false,
            },
            [playboundDebugPath]: { playboundDebugLog: () => {} },
            [globalFactionsPath]: { ROYALE_FACTIONS: ['Phoenixes', 'Unicorns', 'Fireflies', 'Dragons', 'Wolves', 'Eagles'], GLOBAL_FACTION_KEYS: ['Phoenixes', 'Unicorns', 'Fireflies', 'Dragons', 'Wolves', 'Eagles'] },
            [factionChallengeTagsPath]: { VALID_TAGS: new Set(['all', 'trivia']) },
            [factionWarEconomyPayoutPath]: { grantWarEndPersonalCredits: async () => {} },
        },
        () => require(factionChallengePath),
    );
}

/**
 * Load factionProvisioning.js with discord.js and models mocked.
 */
function loadFactionProvisioning(modelsMock) {
    clearModule(factionProvisioningPath);

    // Resolve discord.js from the project's node_modules
    const discordJsPath = require.resolve('discord.js', {
        paths: [path.join(__dirname, '..')],
    });

    return withMockedModules(
        {
            [modelsPath]: {
                SystemConfig: modelsMock.SystemConfig || {
                    findOneAndUpdate: async () => null,
                },
            },
            [discordJsPath]: {
                ChannelType: { GuildText: 0 },
                PermissionFlagsBits: { ViewChannel: 1n, SendMessages: 2n },
            },
        },
        () => require(factionProvisioningPath),
    );
}

// ── Mock guild builder ──
function makeGuild(overrides = {}) {
    let roleCounter = 0;
    let channelCounter = 0;
    return {
        id: overrides.guildId || 'guild-1',
        roles: {
            create: async ({ name }) => ({ id: `role-${++roleCounter}`, name }),
            fetch: async (id) => (overrides.existingRoles?.[id] || null),
        },
        channels: {
            create: async ({ name }) => ({ id: `chan-${++channelCounter}`, name }),
            fetch: async (id) => (overrides.existingChannels?.[id] || null),
        },
        members: { me: { id: 'bot-user-id' } },
    };
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

test('getActiveChallengeForFaction returns the correct war for each faction', async () => {
    const warAB = mockChallenge({ guildId: 'guild-1', factionA: 'Phoenixes', factionB: 'Unicorns' });
    const warCD = mockChallenge({ guildId: 'guild-1', factionA: 'Dragons', factionB: 'Wolves' });

    const { getActiveChallengeForFaction } = loadFactionChallenge([warAB, warCD]);

    const resultA = await getActiveChallengeForFaction('guild-1', 'Phoenixes');
    assert.equal(resultA._id, warAB._id, 'Phoenixes should match war A-B');

    const resultC = await getActiveChallengeForFaction('guild-1', 'Dragons');
    assert.equal(resultC._id, warCD._id, 'Dragons should match war C-D');

    const resultE = await getActiveChallengeForFaction('guild-1', 'Eagles');
    assert.equal(resultE, null, 'Eagles should not match any war');
});

test('getAllActiveChallenges returns all active wars', async () => {
    const warAB = mockChallenge({ guildId: 'guild-1', factionA: 'Phoenixes', factionB: 'Unicorns' });
    const warCD = mockChallenge({ guildId: 'guild-1', factionA: 'Dragons', factionB: 'Wolves' });

    const { getAllActiveChallenges } = loadFactionChallenge([warAB, warCD]);

    const all = await getAllActiveChallenges('guild-1');
    assert.equal(all.length, 2);
    const ids = all.map((c) => c._id).sort();
    assert.deepEqual(ids, [warAB._id, warCD._id].sort());
});

test('checkFactionOverlap detects conflicts with existing wars', async () => {
    const warAB = mockChallenge({ guildId: 'guild-1', factionA: 'Phoenixes', factionB: 'Unicorns' });

    const { checkFactionOverlap } = loadFactionChallenge([warAB]);

    const overlap = await checkFactionOverlap('guild-1', ['Phoenixes', 'Dragons']);
    assert.equal(overlap.conflict, true, 'Should detect overlap with Phoenixes');
    assert.ok(overlap.factions.includes('Phoenixes'));

    const noOverlap = await checkFactionOverlap('guild-1', ['Dragons', 'Wolves']);
    assert.equal(noOverlap.conflict, false, 'No overlap with Dragons+Wolves');
});

test('ensureFactionRole naming convention: {NAME}_MEMBER', async () => {
    const factions = ['Dragons', 'Phoenixes', 'Wolves'];
    const configUpdate = {};
    const { ensureFactionRole } = loadFactionProvisioning({
        SystemConfig: { findOneAndUpdate: async (_, update) => { Object.assign(configUpdate, update); return null; } },
    });

    for (const name of factions) {
        const guild = makeGuild();
        const config = { factionRoleMap: {} };
        const result = await ensureFactionRole(guild, name, config);

        assert.equal(result.error, null);
        assert.equal(result.created, true);
        // The role name should be UPPERCASE_MEMBER
        assert.equal(result.roleId !== null, true);
    }
});

test('ensureFactionChannel naming convention: {name}-hq', async () => {
    const factions = ['Dragons', 'Phoenixes', 'Wolves'];
    const { ensureFactionChannel } = loadFactionProvisioning({
        SystemConfig: { findOneAndUpdate: async () => null },
    });

    for (const name of factions) {
        const guild = makeGuild();
        const config = { factionChannelMap: {} };
        const result = await ensureFactionChannel(guild, name, config, 'role-1');

        assert.equal(result.error, null);
        assert.equal(result.created, true);
        assert.equal(result.channelId !== null, true);
    }
});

test('ensureFactionRole returns existing ID without creating when factionRoleMap is set', async () => {
    const existingRoleId = 'existing-role-dragons';
    const { ensureFactionRole } = loadFactionProvisioning({
        SystemConfig: { findOneAndUpdate: async () => null },
    });

    const guild = makeGuild({
        existingRoles: { [existingRoleId]: { id: existingRoleId, name: 'DRAGONS_MEMBER' } },
    });
    const config = { factionRoleMap: { Dragons: existingRoleId } };

    const result = await ensureFactionRole(guild, 'Dragons', config);

    assert.equal(result.roleId, existingRoleId);
    assert.equal(result.created, false);
    assert.equal(result.error, null);
});
