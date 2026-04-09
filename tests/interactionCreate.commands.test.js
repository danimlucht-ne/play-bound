const test = require('node:test');
const assert = require('node:assert/strict');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const { clearModule, repoPath, withMockedModules } = require('./routerTestUtils');

const interactionCreatePath = repoPath('src', 'events', 'interactionCreate.js');
const axiosPath = require.resolve('axios', { paths: [repoPath()] });
const modelsPath = repoPath('models.js');
const factionChallengePath = repoPath('lib', 'factionChallenge.js');
const rankedFactionWarPath = repoPath('lib', 'rankedFactionWar.js');
const publicStatsExcludePath = repoPath('lib', 'publicStatsExclude.js');
const globalFactionAggregatesPath = repoPath('lib', 'globalFactionAggregates.js');
const factionPremiumInsightsPath = repoPath('lib', 'factionPremiumInsights.js');
const dbPath = repoPath('lib', 'db.js');
const announcementsPath = repoPath('lib', 'announcements.js');
const automatedPostsPath = repoPath('lib', 'automatedPosts.js');
const achievementsPath = repoPath('lib', 'achievements.js');
const utilsPath = repoPath('lib', 'utils.js');
const premiumPerksPath = repoPath('lib', 'premiumPerks.js');
const pointBrandingPath = repoPath('lib', 'pointBranding.js');
const auraBoostRegistryPath = repoPath('lib', 'auraBoostRegistry.js');
const gameAuraButtonPath = repoPath('lib', 'gameAuraButton.js');
const duelFlairPath = repoPath('lib', 'duelFlair.js');
const gameFlairPath = repoPath('lib', 'gameFlair.js');
const isBotDeveloperPath = repoPath('lib', 'isBotDeveloper.js');
const guildFactionPermissionsPath = repoPath('lib', 'guildFactionPermissions.js');
const playboundDebugPath = repoPath('lib', 'playboundDebug.js');
const supportPanelsPath = repoPath('lib', 'supportPanels.js');
const factionGuildPath = repoPath('lib', 'factionGuild.js');
const factionRoleLinkPath = repoPath('lib', 'faction_role_link.js');
const factionRenamePath = repoPath('lib', 'faction_rename.js');
const factionEmojiPath = repoPath('lib', 'faction_emoji.js');
const factionWarAnnouncePath = repoPath('lib', 'factionWarAnnounce.js');
const factionChallengeHostWarningPath = repoPath('lib', 'factionChallengeHostWarning.js');
const factionChallengeDefaultsPath = repoPath('lib', 'factionChallengeDefaults.js');
const configStorePath = repoPath('lib', 'gamePlatform', 'configStore.js');
const gameClassificationPath = repoPath('lib', 'gameClassification.js');
const factionChallengeDailyLimitsPath = repoPath('lib', 'factionChallengeDailyLimits.js');
const factionDuelRotationPath = repoPath('lib', 'factionDuelRotation.js');
const factionBalancePath = repoPath('lib', 'faction_balance.js');
const factionSeasonsPath = repoPath('lib', 'factionSeasons.js');
const premiumUpsellPath = repoPath('lib', 'premiumUpsell.js');
const premiumAnalyticsPath = repoPath('lib', 'premiumAnalytics.js');
const premiumAnalyticsCommandPath = repoPath('lib', 'premium_analytics.js');
const referralsPath = repoPath('lib', 'referrals.js');
const officialFactionJoinPath = repoPath('lib', 'officialFactionJoin.js');
const onboardingDiscordPath = repoPath('lib', 'onboardingDiscord.js');
const triviaPath = repoPath('games', 'trivia.js');
const serverdlePath = repoPath('games', 'serverdle.js');
const guessNumberPath = repoPath('games', 'guessthenumber.js');
const platformPlayPath = repoPath('games', 'platformPlay.js');
const spellingBeePath = repoPath('games', 'spellingbee.js');
const tournamentPath = repoPath('games', 'tournament.js');
const unscramblePath = repoPath('games', 'unscramble.js');
const supportServerAdminCommandsPath = repoPath('lib', 'supportServerAdminCommands.js');
const discordGameHostPath = repoPath('lib', 'discordGameHost.js');
const mongoRouterPath = repoPath('lib', 'mongoRouter.js');
const openTriviaFetchPath = repoPath('lib', 'openTriviaFetch.js');
const { ROYALE_FACTIONS: MOCK_ROYALE_FACTIONS } = require('../lib/globalFactions');

function noop() {}

function loadInteractionCreate(overrides = {}) {
    clearModule(interactionCreatePath);
    return withMockedModules(
        {
            [modelsPath]:
                overrides.models || {
                    User: {
                        findOne: async () => ({
                            guildId: 'guild-1',
                            userId: 'user-1',
                            isBlacklisted: false,
                            isPremium: false,
                            premiumSource: null,
                            agreedTermsVersion: '2026-04',
                            agreedPrivacyVersion: '2026-04',
                            save: async () => {},
                        }),
                        create: async () => ({
                            guildId: 'guild-1',
                            userId: 'user-1',
                            isBlacklisted: false,
                            isPremium: false,
                            premiumSource: null,
                            agreedTermsVersion: '2026-04',
                            agreedPrivacyVersion: '2026-04',
                            save: async () => {},
                        }),
                    },
                    ReferralProfile: {},
                    SystemConfig: {},
                    Game: { find: async () => [] },
                    Word: {},
                    Phrase: {},
                    MovieQuote: {},
                    Achievement: {},
                    ShopItem: { find: async () => [], findOne: async () => null },
                    RecurringGame: {},
                    Faction: {},
                    FactionChallenge: {},
                    LeaderboardPeriodSnapshot: {},
                    ReferralFirstGamePayout: {},
                },
            [axiosPath]:
                overrides.axios || {
                    get: async () => ({ data: { response_code: 0, results: [] } }),
                },
            [factionChallengePath]:
                overrides.factionChallenge || {
                    computeScores: () => [],
                    pickChallengeWinner: () => null,
                    expireStaleChallenges: async () => {},
                    getActiveChallenge: async () => null,
                    isRoyale: () => false,
                    getParticipantIds: () => [],
                    isRosterFullForFaction: () => false,
                    teamRawPointSum: () => 0,
                    getScoreByUser: () => 0,
                    getRawScoreByUser: () => 0,
                    buildRankedRulesSnapshot: () => ({}),
                    isChallengeRanked: () => false,
                    ROYALE_FACTIONS: [...MOCK_ROYALE_FACTIONS],
                    FACTION_SWITCH_COOLDOWN_MS: 0,
                    reconcileFactionTotalsForLeavingMember: async () => {},
                    removeUserFromFactionChallengeEnrollment: async () => {},
                    grantFactionVictoryRoleIfConfigured: async () => {},
                    isUserEnrolledInActiveFactionChallenge: async () => false,
                    formatChallengeGameFilterLabel: () => 'all',
                    applyEndedChallengeToGlobalTotals: async () => {},
                },
            [rankedFactionWarPath]:
                overrides.rankedFactionWar || {
                    validateChallengeCreateParams: () => {},
                    rankedDefaultRosterCapFromConfig: () => 7,
                    rankedContributionCapsFromConfig: () => ({}),
                    RANKED_FIXED_SCORING_MODE: 'top_n_avg',
                    RANKED_FIXED_TOP_N: 5,
                    RANKED_SCORING_DISPLAY_LABEL: 'Top 5 average',
                    RANKED_SLASH_CREATE_WAR_VERSION: 2,
                    parseContributionCapsCsv: () => ({}),
                },
            [publicStatsExcludePath]:
                overrides.publicStatsExclude || {
                    isGuildExcludedFromGlobalCounts: () => false,
                    guildIdNotExcludedMatch: () => ({}),
                    getExcludedGuildIds: () => [],
                },
            [globalFactionAggregatesPath]:
                overrides.globalFactionAggregates || {
                    getGlobalFactionStandingsFromUsers: async () => [],
                    getGlobalFactionTotalsForName: async () => ({}),
                    getTopGuildsForFactionChallengePoints: async () => [],
                },
            [factionPremiumInsightsPath]:
                overrides.factionPremiumInsights || {
                    formatPremiumGlobalBoardGap: () => '',
                    formatPremiumWarRosterInsight: () => '',
                    formatPremiumSeasonFactionPlacement: () => '',
                    formatPremiumServerArenaRank: () => '',
                },
            [dbPath]: (() => {
                const baseUser = (g, u) => ({
                    guildId: g || 'guild-1',
                    userId: u || 'user-1',
                    points: 100,
                    weeklyPoints: 0,
                    monthlyPoints: 0,
                    inventory: [],
                    currentCosmetics: new Map(),
                    achievements: [],
                    isBlacklisted: false,
                    isPremium: false,
                    premiumSource: null,
                    agreedTermsVersion: '2026-04',
                    agreedPrivacyVersion: '2026-04',
                    save: async () => {},
                });
                const defaultDb = {
                    getUser: async (g, u) => baseUser(g, u),
                    updateUser: async () => {},
                    transferCreditsAtomic: async () => ({ ok: true, transferred: 0, senderBalance: 100 }),
                    joinFactionAtomic: async () => ({ ok: true, factionName: 'Dragons' }),
                    claimDailyAtomic: async (_guildId, _userId, reward, now) => ({
                        ok: true,
                        reward,
                        lastDailyClaim: now,
                    }),
                    addScore: async () => {},
                    addManualPointAdjustment: async () => {},
                    getSystemConfig: async () => ({ shopItems: [], roleRewards: new Map() }),
                    updateSystemConfig: async (_guildId, updater) => {
                        const cfg = {};
                        updater(cfg);
                        return cfg;
                    },
                    refreshLeaderboard: async () => {},
                    resolveLeaderboardSort: () => 'points',
                    leaderboardCache: new Map(),
                    createActiveGame: async () => {},
                    updateActiveGame: async () => {},
                    endActiveGame: async () => {},
                };
                const custom = overrides.db;
                if (!custom) return defaultDb;
                return {
                    ...defaultDb,
                    ...custom,
                    getUser:
                        custom.getUser != null
                            ? async (g, u) => {
                                  const doc = await custom.getUser(g, u);
                                  const t = doc.agreedTermsVersion;
                                  const p = doc.agreedPrivacyVersion;
                                  if (t == null || String(t).trim() === '') {
                                      doc.agreedTermsVersion = '2026-04';
                                  }
                                  if (p == null || String(p).trim() === '') {
                                      doc.agreedPrivacyVersion = '2026-04';
                                  }
                                  return doc;
                              }
                            : defaultDb.getUser,
                };
            })(),
            [announcementsPath]:
                overrides.announcements || {
                    sendGlobalAnnouncement: async () => null,
                    announceScheduledGame: noop,
                    announceWinner: noop,
                    announceFactionChallengeToGuild: noop,
                    shouldPingEveryone: () => false,
                },
            [automatedPostsPath]:
                overrides.automatedPosts || {
                    automatedServerPostsEnabled: () => true,
                },
            [achievementsPath]:
                overrides.achievements || {
                    ACHIEVEMENTS: {},
                    CUSTOM_ACHIEVEMENT_KEY: /^CUSTOM_/,
                    normalizeAchievementEmoji: (emoji) => emoji,
                    resolveAchievementMeta: () => null,
                    formatAchievementLabel: (meta) => meta?.name || '',
                    awardAchievement: async () => {},
                    revokeAchievement: async () => {},
                },
            [utilsPath]:
                overrides.utils || {
                    decodeHTMLEntities: (v) => v,
                    scramblePhrase: (v) => v,
                    parsePointValues: () => ({ first: 5, second: 3, third: 1 }),
                    MAX_POINTS_PER_PLACEMENT: 100,
                    isFuzzyMatch: () => false,
                    normalizeText: (v) => v,
                    disableComponentsInThread: async () => {},
                    defaultGameThreadName: (name) => `${name} Thread`,
                },
            [premiumPerksPath]:
                overrides.premiumPerks || {
                    clampHostGameInt: (value) => value,
                },
            [pointBrandingPath]:
                overrides.pointBranding || {
                    CREDITS: 'Credits',
                    ARENA_SCORE: 'Arena Score',
                    creditsVsArenaBlurb: () => 'Credits are server activity. Arena score is competitive.',
                },
            [auraBoostRegistryPath]:
                overrides.auraBoostRegistry || {
                    registerAuraBoostTarget: noop,
                    runAuraBoost: async () => {},
                },
            [gameAuraButtonPath]:
                overrides.gameAuraButton || {
                    auraBoostRow: () => ({ components: [] }),
                },
            [duelFlairPath]:
                overrides.duelFlair || {
                    pickDuelChallengeFlair: () => ({ color: '#00f', quote: 'Fight!', imageUrl: 'https://example.com/duel.png' }),
                    pickDuelFightLine: () => 'Fight!',
                },
            [gameFlairPath]:
                overrides.gameFlair || {
                    makeGameFlairEmbed: () => null,
                },
            [isBotDeveloperPath]:
                overrides.isBotDeveloper || {
                    isBotDeveloper: () => false,
                },
            [guildFactionPermissionsPath]:
                overrides.guildFactionPermissions || {
                    canManageFactionChallenges: () => false,
                },
            [playboundDebugPath]:
                overrides.playboundDebug || {
                    playboundDebugLog: noop,
                },
            [supportPanelsPath]:
                overrides.supportPanels || {
                    postSupportPanels: async () => {},
                },
            [factionGuildPath]:
                overrides.factionGuild || {
                    syncFactionMemberRoles: async () => {},
                    getFactionDisplayName: (name) => name,
                    getFactionDisplayEmoji: () => '',
                    formatFactionDualLabel: (name) => name,
                },
            [factionRoleLinkPath]:
                overrides.factionRoleLink || {
                    executeFactionRoleLink: async () => {},
                },
            [factionRenamePath]:
                overrides.factionRename || {
                    executeFactionRename: async () => {},
                },
            [factionEmojiPath]:
                overrides.factionEmoji || {
                    executeFactionEmoji: async () => {},
                },
            [factionWarAnnouncePath]:
                overrides.factionWarAnnounce || {
                    formatFactionWarMatchupLine: () => '',
                },
            [factionChallengeHostWarningPath]:
                overrides.factionChallengeHostWarning || {
                    getFactionChallengeStaffOverlapSuffix: async () => '',
                },
            [factionChallengeDefaultsPath]:
                overrides.factionChallengeDefaults || {
                    resolveFactionChallengeCreateOptions: () => ({}),
                    resolveGameTypesArrayForChallenge: () => [],
                    assertValidGameType: () => {},
                    assertValidScoringMode: () => {},
                    BUILTIN_DEFAULT_GAME: 'all',
                    BUILTIN_DEFAULT_SCORING: 'top_n_avg',
                    BUILTIN_DEFAULT_TOPN: 5,
                },
            [configStorePath]:
                overrides.configStore || {
                    getSettings: async () => ({}),
                },
            [gameClassificationPath]:
                overrides.gameClassification || {
                    validateRankedChallengeGameSelection: () => {},
                },
            [factionChallengeDailyLimitsPath]:
                overrides.factionChallengeDailyLimits || {
                    countFactionChallengesOfTypeToday: async () => 0,
                },
            [factionDuelRotationPath]:
                overrides.factionDuelRotation || {
                    duelPairForDailySlot: () => ['Dragons', 'Wolves'],
                },
            [factionBalancePath]:
                overrides.factionBalance || {
                    executeFactionBalance: async () => {},
                },
            [factionSeasonsPath]:
                overrides.factionSeasons || {
                    getCurrentSeasonOverview: async () => ({
                        seasonKey: '2026-Q2',
                        daysRemainingApprox: 20,
                        topFactions: [],
                        lastQuarterWinnerFaction: null,
                        lastQuarterKey: null,
                        lastQuarterWinnerGuildId: null,
                    }),
                    getHallOfChampions: async () => ({ quarters: [], years: [] }),
                },
            [premiumUpsellPath]:
                overrides.premiumUpsell || {
                    shouldShowPremiumPrompt: () => false,
                    markPremiumPromptShown: async () => {},
                    tryHostPremiumNudge: async () => {},
                    sendPremiumBoostSessionHint: async () => {},
                },
            [premiumAnalyticsPath]:
                overrides.premiumAnalytics || {
                    trackPremiumPromptShown: async () => {},
                    trackPremiumConversion: async () => {},
                },
            [premiumAnalyticsCommandPath]:
                overrides.premiumAnalyticsCommand || {
                    executePremiumAnalytics: async () => {},
                },
            [referralsPath]:
                overrides.referrals || {
                    handleInviteCommand: async () => {},
                    handleInvitesCommand: async () => {},
                    handleClaimReferralCommand: async () => {},
                    handleFactionRecruitCommand: async () => {},
                    handleFactionRedeemCommand: async () => {},
                    handleInviteLeaderboardCommand: async () => {},
                },
            [officialFactionJoinPath]:
                overrides.officialFactionJoin || {
                    joinOfficialFactionInGuild: async () => ({ ok: true }),
                    resolveFactionDocForJoin: async () => null,
                },
            [onboardingDiscordPath]:
                overrides.onboardingDiscord || {
                    handleOnboardingCommand: async () => {},
                    handleOnboardingButton: async () => false,
                },
            [triviaPath]:
                overrides.trivia || {
                    handleInteraction: async () => false,
                },
            [serverdlePath]:
                overrides.serverdle || {
                    handleInteraction: async () => false,
                },
            [guessNumberPath]:
                overrides.guessthenumber || {
                    handleInteraction: async () => false,
                },
            [platformPlayPath]:
                overrides.platformPlay || {
                    handleSlashPlaygame: async () => {},
                    handlePlatformButton: async () => false,
                },
            [spellingBeePath]:
                overrides.spellingbee || {
                    handleInteraction: async () => false,
                },
            [tournamentPath]:
                overrides.tournament || {
                    handleInteraction: async () => false,
                },
            [unscramblePath]:
                overrides.unscramble || {
                    buildUnscramblePhrasesForGame: async () => [],
                },
            [supportServerAdminCommandsPath]:
                overrides.supportServerAdminCommands || {
                    handleSupportServerAdminCommands: async () => false,
                },
            [mongoRouterPath]:
                overrides.mongoRouter || {
                    runWithGuild: async (_gid, fn) => fn(),
                    updateUserByDiscordIdEverywhere: async () => 2,
                    forEachUserDocumentByDiscordId: async () => {},
                },
            [discordGameHostPath]:
                overrides.discordGameHost || {
                    resolveGameHostChannel: async () => null,
                    resolveUserVoiceChannel: async () => null,
                },
            [openTriviaFetchPath]:
                overrides.openTriviaFetch || {
                    fetchOpenTdbMultipleChoice: async (n) => {
                        const out = [];
                        for (let i = 0; i < n; i++) {
                            out.push({ question: `Q${i + 1}?`, correct: 'A', answers: ['A', 'B', 'C', 'D'] });
                        }
                        return out;
                    },
                },
        },
        () => require(interactionCreatePath),
    );
}

function makeInteraction(commandName, optionValues = {}) {
    const calls = {};
    const kind = optionValues.kind || 'command';
    const channel = optionValues.channel || {
        id: 'channel-1',
        type: 0,
        archived: false,
        isThread: () => false,
    };
    const interaction = {
        commandName,
        customId: optionValues.customId,
        guildId: optionValues.guildId || 'guild-1',
        channelId: channel.id,
        channel,
        guild: optionValues.guild || { id: 'guild-1', members: { fetch: async () => ({ roles: { add: async () => {} } }) } },
        member:
            optionValues.member || {
                permissions: { has: () => false },
                roles: { cache: new Map() },
            },
        user: optionValues.actorUser || { id: 'user-1', bot: false, username: 'Tester' },
        entitlements: { cache: { some: () => false } },
        replied: false,
        deferred: false,
        options: {
            getBoolean(name) {
                return Object.hasOwn(optionValues, name) ? optionValues[name] : null;
            },
            getChannel(name) {
                return Object.hasOwn(optionValues, name) ? optionValues[name] : null;
            },
            getString(name) {
                return Object.hasOwn(optionValues, name) ? optionValues[name] : null;
            },
            getInteger(name) {
                return Object.hasOwn(optionValues, name) ? optionValues[name] : null;
            },
            getUser(name) {
                return Object.hasOwn(optionValues, name) ? optionValues[name] : null;
            },
            getRole(name) {
                return Object.hasOwn(optionValues, name) ? optionValues[name] : null;
            },
            getSubcommand() {
                return Object.hasOwn(optionValues, 'subcommand') ? optionValues.subcommand : null;
            },
        },
        values: optionValues.values || [],
        message: optionValues.message || {
            id: 'message-1',
            components: optionValues.messageComponents || [],
            edit: async (payload) => {
                calls.messageEdit = payload;
                return payload;
            },
        },
        fields: optionValues.fields || {
            getTextInputValue(name) {
                return optionValues.textInputs?.[name] || '';
            },
        },
        isRepliable: () => true,
        isAutocomplete: () => false,
        isButton: () => kind === 'button',
        isStringSelectMenu: () => kind === 'select',
        isModalSubmit: () => kind === 'modal',
        isChatInputCommand: () => kind === 'command',
        async reply(payload) {
            calls.reply = payload;
            interaction.replied = true;
            return optionValues.fetchReply ? { id: 'msg-1', edit: async () => {} } : payload;
        },
        async deferReply(payload) {
            calls.deferReply = payload;
            interaction.deferred = true;
        },
        async editReply(payload) {
            calls.editReply = payload;
            return payload;
        },
        async followUp(payload) {
            calls.followUp = payload;
            return payload;
        },
        async update(payload) {
            calls.update = payload;
            return payload;
        },
        async deferUpdate() {
            calls.deferUpdate = true;
        },
        async showModal(payload) {
            calls.showModal = payload;
            return payload;
        },
        async deleteReply() {
            calls.deleteReply = true;
        },
        calls,
    };
    return interaction;
}

async function dispatchCommand(commandName, optionValues = {}, overrides = {}) {
    const { registerInteractionCreate } = loadInteractionCreate(overrides);
    const handlers = {};
    const client = {
        on(event, handler) {
            handlers[event] = handler;
        },
        channels: {
            cache: new Map(),
            fetch: async () => null,
        },
        users: {
            fetch: async () => null,
        },
        guilds: {
            cache: new Map(),
            fetch: async () => null,
        },
        ...(overrides.client || {}),
    };
    const deps = {
        state: {
            activeSprints: new Map(),
            activeCaptions: new Map(),
            activeTunes: new Map(),
            activeUnscrambles: new Map(),
            activeGiveaways: new Map(),
            activeMovieGames: new Map(),
            activeDuels: new Map(),
            storyLastUserId: new Map(),
            scheduledGames: overrides.scheduledGames || new Map(),
            WORDS: [],
            PHRASES: [],
        },
        triggers: {
            triggerTriviaSprintEnd: noop,
            triggerCaptionEnd: noop,
            triggerTuneEnd: noop,
            triggerMovieEnd: noop,
            nextMovieQuote: noop,
            triggerUnscrambleEnd: noop,
            endGiveaway: noop,
        },
        scheduleGame: async () => 'sch-1',
        CURRENT_TERMS_VERSION: '2026-04',
        CURRENT_PRIVACY_VERSION: '2026-04',
    };
    registerInteractionCreate(client, deps);
    const interaction = makeInteraction(commandName, optionValues);
    await handlers.interactionCreate(interaction);
    return interaction;
}

async function dispatchCommandWithContext(commandName, optionValues = {}, overrides = {}) {
    const { registerInteractionCreate } = loadInteractionCreate(overrides);
    const handlers = {};
    const client = {
        on(event, handler) {
            handlers[event] = handler;
        },
        channels: {
            cache: new Map(),
            fetch: async () => null,
        },
        users: {
            fetch: async () => null,
        },
        guilds: {
            cache: new Map(),
            fetch: async () => null,
        },
        ...(overrides.client || {}),
    };
    const deps = {
        state: {
            activeSprints: new Map(),
            activeCaptions: new Map(),
            activeTunes: new Map(),
            activeUnscrambles: new Map(),
            activeGiveaways: new Map(),
            activeMovieGames: new Map(),
            activeDuels: new Map(),
            storyLastUserId: new Map(),
            scheduledGames: overrides.scheduledGames || new Map(),
            WORDS: [],
            PHRASES: [],
        },
        triggers: {
            triggerTriviaSprintEnd: noop,
            triggerCaptionEnd: noop,
            triggerTuneEnd: noop,
            triggerMovieEnd: noop,
            nextMovieQuote: noop,
            triggerUnscrambleEnd: noop,
            endGiveaway: noop,
        },
        scheduleGame: overrides.scheduleGame || (async () => 'sch-1'),
        CURRENT_TERMS_VERSION: '2026-04',
        CURRENT_PRIVACY_VERSION: '2026-04',
    };
    registerInteractionCreate(client, deps);
    const interaction = makeInteraction(commandName, optionValues);
    await handlers.interactionCreate(interaction);
    return { interaction, deps, client };
}

async function dispatchInteractionWithContext(optionValues = {}, overrides = {}, depOverrides = {}) {
    const { registerInteractionCreate } = loadInteractionCreate(overrides);
    const handlers = {};
    const client = {
        on(event, handler) {
            handlers[event] = handler;
        },
        channels: {
            cache: new Map(),
            fetch: async () => null,
        },
        users: {
            fetch: async () => null,
        },
        guilds: {
            cache: new Map(),
            fetch: async () => null,
        },
        ...(overrides.client || {}),
    };
    const deps = {
        state: {
            activeSprints: new Map(),
            activeCaptions: new Map(),
            activeTunes: new Map(),
            activeUnscrambles: new Map(),
            activeGiveaways: new Map(),
            activeMovieGames: new Map(),
            activeDuels: new Map(),
            storyLastUserId: new Map(),
            scheduledGames: new Map(),
            WORDS: [],
            PHRASES: [],
            ...(depOverrides.state || {}),
        },
        triggers: {
            triggerTriviaSprintEnd: noop,
            triggerCaptionEnd: noop,
            triggerTuneEnd: noop,
            triggerMovieEnd: noop,
            nextMovieQuote: noop,
            triggerUnscrambleEnd: noop,
            endGiveaway: noop,
            ...(depOverrides.triggers || {}),
        },
        scheduleGame: depOverrides.scheduleGame || overrides.scheduleGame || (async () => 'sch-1'),
        CURRENT_TERMS_VERSION: depOverrides.CURRENT_TERMS_VERSION || '2026-04',
        CURRENT_PRIVACY_VERSION: depOverrides.CURRENT_PRIVACY_VERSION || '2026-04',
    };
    registerInteractionCreate(client, deps);
    const interaction = makeInteraction(optionValues.commandName, optionValues);
    await handlers.interactionCreate(interaction);
    return { interaction, deps, client };
}

test('premium command tracks the prompt and replies with premium CTA buttons', async () => {
    process.env.STRIPE_PAYMENT_LINK_MONTHLY = 'https://buy.stripe.com/monthly';
    process.env.STRIPE_PAYMENT_LINK_YEARLY = 'https://buy.stripe.com/yearly';
    process.env.STRIPE_CUSTOMER_PORTAL_URL = 'https://billing.example.com/manage';
    process.env.SUPPORT_SERVER_INVITE = 'https://discord.gg/playbound';

    const tracked = [];
    const interaction = await dispatchCommand(
        'premium',
        {},
        {
            premiumAnalytics: {
                trackPremiumPromptShown: async (payload) => {
                    tracked.push(payload);
                },
                trackPremiumConversion: async () => {},
            },
        },
    );

    assert.equal(tracked.length, 1);
    assert.equal(tracked[0].trigger, 'premium_command');
    assert.equal(interaction.calls.reply.ephemeral, true);
    assert.match(interaction.calls.reply.embeds[0].data.title, /PlayBound Premium/);
    assert.equal(interaction.calls.reply.components.length, 2);
});

test('support command replies with the configured support invite', async () => {
    process.env.SUPPORT_SERVER_INVITE = 'https://discord.gg/help-hub';

    const interaction = await dispatchCommand('support');

    assert.match(interaction.calls.reply.content, /https:\/\/discord\.gg\/help-hub/);
    assert.equal(interaction.calls.reply.ephemeral, true);
});

test('referral-related commands delegate to the referral handlers', async () => {
    const calls = [];
    const overrides = {
        referrals: {
            handleInviteCommand: async (interaction) => {
                calls.push(['invite', interaction.commandName]);
            },
            handleInvitesCommand: async (interaction) => {
                calls.push(['invites', interaction.commandName]);
            },
            handleClaimReferralCommand: async (interaction) => {
                calls.push(['claim_referral', interaction.commandName]);
            },
            handleFactionRecruitCommand: async (interaction) => {
                calls.push(['faction_recruit', interaction.commandName]);
            },
            handleFactionRedeemCommand: async (interaction, client) => {
                calls.push(['faction_redeem', interaction.commandName, !!client]);
            },
            handleInviteLeaderboardCommand: async (interaction, client) => {
                calls.push(['invite_leaderboard', interaction.commandName, !!client]);
            },
        },
    };

    await dispatchCommand('invite', {}, overrides);
    await dispatchCommand('invites', {}, overrides);
    await dispatchCommand('claim_referral', {}, overrides);
    await dispatchCommand('faction_recruit', {}, overrides);
    await dispatchCommand('faction_redeem', {}, overrides);
    await dispatchCommand('invite_leaderboard', {}, overrides);

    assert.deepEqual(calls, [
        ['invite', 'invite'],
        ['invites', 'invites'],
        ['claim_referral', 'claim_referral'],
        ['faction_recruit', 'faction_recruit'],
        ['faction_redeem', 'faction_redeem', true],
        ['invite_leaderboard', 'invite_leaderboard', true],
    ]);
});

test('help command replies with the PlayBound guide embed', async () => {
    process.env.SUPPORT_SERVER_INVITE = 'https://discord.gg/playbound-help';

    const interaction = await dispatchCommand('help');

    assert.equal(interaction.calls.reply.ephemeral, true);
    const embed = interaction.calls.reply.embeds[0];
    assert.match(embed.data.title, /PlayBound Guide/);
    assert.ok(embed.data.fields.length > 0, 'help embed should have fields');
    assert.match(embed.data.fields[0].value, /Credits/i);
});

test('listgames reports active and scheduled games for the guild', async () => {
    const scheduledGames = new Map([
        [
            'sched-1',
            {
                id: 'sched-1',
                guildId: 'guild-1',
                type: 'Trivia',
                channelId: 'channel-2',
                startTime: new Date('2026-04-09T18:00:00Z'),
            },
        ],
    ]);
    const interaction = await dispatchCommand(
        'listgames',
        {},
        {
            scheduledGames,
            models: {
                User: {
                    findOne: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        isBlacklisted: false,
                        isPremium: false,
                        premiumSource: null,
                        agreedTermsVersion: '2026-04',
                        agreedPrivacyVersion: '2026-04',
                        save: async () => {},
                    }),
                    create: async () => ({}),
                },
                ReferralProfile: {},
                SystemConfig: {},
                Game: {
                    find: async () => [
                        {
                            type: 'Giveaway',
                            channelId: 'channel-1',
                            threadId: 'thread-1',
                            startTime: new Date('2026-04-09T17:00:00Z'),
                        },
                    ],
                },
                Word: {},
                Phrase: {},
                MovieQuote: {},
                Achievement: {},
                ShopItem: { find: async () => [], findOne: async () => null },
                RecurringGame: {},
                Faction: {},
                FactionChallenge: {},
                LeaderboardPeriodSnapshot: {},
                ReferralFirstGamePayout: {},
            },
        },
    );

    assert.match(interaction.calls.reply.content, /Active Games/i);
    assert.match(interaction.calls.reply.content, /Giveaway/);
    assert.match(interaction.calls.reply.content, /Scheduled Games/i);
    assert.match(interaction.calls.reply.content, /Trivia/);
});

test('set_announcement_channel saves the channel and explains ping state', async () => {
    const savedConfigs = [];
    const targetChannel = { id: 'announce-1', type: 0, archived: false, isThread: () => false };
    const interaction = await dispatchCommand(
        'set_announcement_channel',
        {
            channel: targetChannel,
            member: { permissions: { has: () => true }, roles: { cache: new Map() } },
        },
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    points: 100,
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({}),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    savedConfigs.push(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            announcements: {
                sendGlobalAnnouncement: async () => null,
                announceScheduledGame: noop,
                announceWinner: noop,
                announceFactionChallengeToGuild: noop,
                shouldPingEveryone: () => false,
            },
        },
    );

    assert.equal(savedConfigs[0].announceChannel, 'announce-1');
    assert.match(interaction.calls.reply.content, /Announcements will post in <#announce-1>/);
    assert.match(interaction.calls.reply.content, /@everyone.*off/i);
});

test('set_automated_posts toggles quiet mode in config', async () => {
    const savedConfigs = [];
    const interaction = await dispatchCommand(
        'set_automated_posts',
        {
            enabled: false,
            member: { permissions: { has: () => true }, roles: { cache: new Map() } },
        },
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    points: 100,
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({}),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    savedConfigs.push(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            duelFlair: {
                pickDuelChallengeFlair: () => ({
                    color: 0x3366ff,
                    quote: 'Fight!',
                    imageUrl: 'https://example.com/duel.png',
                }),
                pickDuelFightLine: () => 'Fight!',
            },
        },
    );

    assert.equal(savedConfigs[0].automatedServerPostsEnabled, false);
    assert.match(interaction.calls.reply.content, /quiet mode/i);
    assert.equal(interaction.calls.reply.ephemeral, true);
});

test('set_birthday rejects invalid dates and allows a first-time set', async () => {
    const updateCalls = [];
    const invalid = await dispatchCommand('set_birthday', { date: '2026-04-09' });

    assert.match(invalid.calls.reply.content, /Invalid format/i);
    assert.equal(invalid.calls.reply.ephemeral, true);

    const valid = await dispatchCommand(
        'set_birthday',
        { date: '05-24', force: false },
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    birthday: null,
                    isPremium: false,
                    save: async () => {},
                }),
                updateUser: async (_guildId, userId, updater) => {
                    const user = { birthday: null };
                    updater(user);
                    updateCalls.push([userId, user.birthday]);
                },
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({}),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
        },
    );

    assert.deepEqual(updateCalls, [['user-1', '05-24']]);
    assert.match(valid.calls.reply.content, /birthday has been set to 05-24/i);
});

test('shop command returns an ephemeral catalog through editReply', async () => {
    const interaction = await dispatchCommand(
        'shop',
        {},
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    points: 250,
                    inventory: ['badge_star'],
                    currentCosmetics: new Map(),
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ shopItems: [] }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            models: {
                User: {
                    findOne: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        isBlacklisted: false,
                        isPremium: false,
                        premiumSource: null,
                        agreedTermsVersion: '2026-04',
                        agreedPrivacyVersion: '2026-04',
                        save: async () => {},
                    }),
                    create: async () => ({}),
                },
                ReferralProfile: {},
                SystemConfig: {},
                Game: { find: async () => [] },
                Word: {},
                Phrase: {},
                MovieQuote: {},
                Achievement: {},
                ShopItem: {
                    find: async () => [
                        { id: 'badge_star', name: 'Star Badge', price: 40, type: 'badge', premiumOnly: false },
                    ],
                    findOne: async () => null,
                },
                RecurringGame: {},
                Faction: {},
                FactionChallenge: {},
                LeaderboardPeriodSnapshot: {},
                ReferralFirstGamePayout: {},
            },
        },
    );

    assert.ok(interaction.calls.deferReply);
    assert.ok(interaction.calls.editReply);
    assert.equal(interaction.calls.editReply.embeds[0].data.title.includes('Point Shop'), true);
    const desc = interaction.calls.editReply.embeds[0].data.description || '';
    assert.match(desc, /No items yet|empty/i, 'owned-only catalog should not list the owned badge');
    assert.doesNotMatch(desc, /Star Badge/i);
});

test('buy command opens the catalog when no item is specified and buys a valid item when present', async () => {
    const savedUsers = [];
    const buyCatalog = await dispatchCommand(
        'buy',
        {},
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    points: 500,
                    inventory: [],
                    currentCosmetics: new Map(),
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ shopItems: [] }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            models: {
                User: {
                    findOne: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        isBlacklisted: false,
                        isPremium: false,
                        premiumSource: null,
                        agreedTermsVersion: '2026-04',
                        agreedPrivacyVersion: '2026-04',
                        save: async () => {},
                    }),
                    create: async () => ({}),
                },
                ReferralProfile: {},
                SystemConfig: {},
                Game: { find: async () => [] },
                Word: {},
                Phrase: {},
                MovieQuote: {},
                Achievement: {},
                ShopItem: {
                    find: async () => [{ id: 'color_teal', name: 'Teal Glow', price: 80, type: 'color', premiumOnly: false }],
                    findOne: async () => null,
                },
                RecurringGame: {},
                Faction: {},
                FactionChallenge: {},
                LeaderboardPeriodSnapshot: {},
                ReferralFirstGamePayout: {},
            },
        },
    );

    assert.ok(buyCatalog.calls.deferReply);
    assert.ok(buyCatalog.calls.editReply);
    assert.equal(buyCatalog.calls.editReply.embeds[0].data.title.includes('Buy an item'), true);

    const directBuy = await dispatchCommand(
        'buy',
        { item: 'color_teal' },
        {
            db: {
                getUser: async () => {
                    const user = {
                        guildId: 'guild-1',
                        userId: 'user-1',
                        points: 150,
                        inventory: [],
                        currentCosmetics: new Map(),
                        isPremium: false,
                        save: async () => {
                            savedUsers.push({ points: user.points, inventory: [...user.inventory] });
                        },
                    };
                    return user;
                },
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ shopItems: [] }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            models: {
                User: {
                    findOne: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        isBlacklisted: false,
                        isPremium: false,
                        premiumSource: null,
                        agreedTermsVersion: '2026-04',
                        agreedPrivacyVersion: '2026-04',
                        save: async () => {},
                    }),
                    create: async () => ({}),
                },
                ReferralProfile: {},
                SystemConfig: {},
                Game: { find: async () => [] },
                Word: {},
                Phrase: {},
                MovieQuote: {},
                Achievement: {},
                ShopItem: {
                    find: async () => [],
                    findOne: async ({ id }) =>
                        id === 'color_teal'
                            ? { id: 'color_teal', name: 'Teal Glow', price: 80, type: 'color', premiumOnly: false }
                            : null,
                },
                RecurringGame: {},
                Faction: {},
                FactionChallenge: {},
                LeaderboardPeriodSnapshot: {},
                ReferralFirstGamePayout: {},
            },
        },
    );

    assert.deepEqual(savedUsers, [{ points: 70, inventory: ['color_teal'] }]);
    assert.match(directBuy.calls.reply.content, /Successfully bought \*\*Teal Glow\*\*/i);
    assert.equal(directBuy.calls.reply.ephemeral, true);

    const dupSaved = [];
    const duplicateBuy = await dispatchCommand(
        'buy',
        { item: 'color_teal' },
        {
            db: {
                getUser: async () => {
                    const user = {
                        guildId: 'guild-1',
                        userId: 'user-1',
                        points: 150,
                        inventory: ['color_teal'],
                        currentCosmetics: new Map(),
                        isPremium: false,
                        save: async () => {
                            dupSaved.push({ points: user.points, inventory: [...user.inventory] });
                        },
                    };
                    return user;
                },
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ shopItems: [] }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            models: {
                User: {
                    findOne: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        isBlacklisted: false,
                        isPremium: false,
                        premiumSource: null,
                        agreedTermsVersion: '2026-04',
                        agreedPrivacyVersion: '2026-04',
                        save: async () => {},
                    }),
                    create: async () => ({}),
                },
                ReferralProfile: {},
                SystemConfig: {},
                Game: { find: async () => [] },
                Word: {},
                Phrase: {},
                MovieQuote: {},
                Achievement: {},
                ShopItem: {
                    find: async () => [],
                    findOne: async ({ id }) =>
                        id === 'color_teal'
                            ? { id: 'color_teal', name: 'Teal Glow', price: 80, type: 'color', premiumOnly: false }
                            : null,
                },
                RecurringGame: {},
                Faction: {},
                FactionChallenge: {},
                LeaderboardPeriodSnapshot: {},
                ReferralFirstGamePayout: {},
            },
        },
    );
    assert.equal(dupSaved.length, 0);
    assert.match(duplicateBuy.calls.reply.content, /already own/i);
    assert.equal(duplicateBuy.calls.reply.ephemeral, true);
});

test('inventory and equip commands show owned items and equip valid cosmetics', async () => {
    const savedCosmetics = [];
    const inventoryInteraction = await dispatchCommand(
        'inventory',
        {},
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    inventory: ['badge_star', 'badge_star', 'color_teal'],
                    currentCosmetics: new Map([['badge', 'badge_star']]),
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ shopItems: [] }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            models: {
                User: {
                    findOne: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        isBlacklisted: false,
                        isPremium: false,
                        premiumSource: null,
                        agreedTermsVersion: '2026-04',
                        agreedPrivacyVersion: '2026-04',
                        save: async () => {},
                    }),
                    create: async () => ({}),
                },
                ReferralProfile: {},
                SystemConfig: {},
                Game: { find: async () => [] },
                Word: {},
                Phrase: {},
                MovieQuote: {},
                Achievement: {},
                ShopItem: {
                    find: async () => [
                        { id: 'badge_star', name: 'Star Badge', type: 'badge' },
                        { id: 'color_teal', name: 'Teal Glow', type: 'color' },
                    ],
                    findOne: async () => null,
                },
                RecurringGame: {},
                Faction: {},
                FactionChallenge: {},
                LeaderboardPeriodSnapshot: {},
                ReferralFirstGamePayout: {},
            },
        },
    );

    assert.ok(inventoryInteraction.calls.deferReply);
    assert.match(inventoryInteraction.calls.editReply.embeds[0].data.description, /Star Badge/);
    assert.ok(inventoryInteraction.calls.editReply.components.length > 0);

    const equipInteraction = await dispatchCommand(
        'equip',
        { item: 'color_teal' },
        {
            db: {
                getUser: async () => {
                    const user = {
                        guildId: 'guild-1',
                        userId: 'user-1',
                        inventory: ['badge_star', 'color_teal'],
                        currentCosmetics: new Map(),
                        save: async () => {
                            savedCosmetics.push([...user.currentCosmetics.entries()]);
                        },
                    };
                    return user;
                },
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ shopItems: [] }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            models: {
                User: {
                    findOne: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        isBlacklisted: false,
                        isPremium: false,
                        premiumSource: null,
                        agreedTermsVersion: '2026-04',
                        agreedPrivacyVersion: '2026-04',
                        save: async () => {},
                    }),
                    create: async () => ({}),
                },
                ReferralProfile: {},
                SystemConfig: {},
                Game: { find: async () => [] },
                Word: {},
                Phrase: {},
                MovieQuote: {},
                Achievement: {},
                ShopItem: {
                    find: async () => [],
                    findOne: async ({ id }) =>
                        id === 'color_teal'
                            ? { id: 'color_teal', name: 'Teal Glow', type: 'color' }
                            : null,
                },
                RecurringGame: {},
                Faction: {},
                FactionChallenge: {},
                LeaderboardPeriodSnapshot: {},
                ReferralFirstGamePayout: {},
            },
        },
    );

    assert.deepEqual(savedCosmetics, [[['color', 'color_teal']]]);
    assert.match(equipInteraction.calls.reply.content, /equipped/i);
    assert.equal(equipInteraction.calls.reply.ephemeral, true);
});

test('daily enforces cooldowns and awards credits when available', async () => {
    const cooldownNow = 2_000_000_000_000;
    const originalNow = Date.now;
    const originalRandom = Math.random;
    Date.now = () => cooldownNow;
    Math.random = () => 0;
    try {
        const blocked = await dispatchCommand(
            'daily',
            {},
            {
                db: {
                    getUser: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        isPremium: false,
                        lastDailyClaim: cooldownNow - 60_000,
                        points: 100,
                        weeklyPoints: 0,
                        monthlyPoints: 0,
                        currentStreak: 2,
                        save: async () => {},
                    }),
                    updateUser: async () => {},
                    transferCreditsAtomic: async () => ({ ok: true, transferred: 0, senderBalance: 100 }),
                    joinFactionAtomic: async () => ({ ok: true, factionName: 'Dragons' }),
                    claimDailyAtomic: async () => ({ ok: false, reason: 'cooldown', remainingMs: 86_340_000 }),
                    addScore: async () => {},
                    addManualPointAdjustment: async () => {},
                    getSystemConfig: async () => ({}),
                    updateSystemConfig: async (_guildId, updater) => {
                        const cfg = {};
                        updater(cfg);
                        return cfg;
                    },
                    refreshLeaderboard: async () => {},
                    resolveLeaderboardSort: () => 'points',
                    leaderboardCache: new Map(),
                    createActiveGame: async () => {},
                    updateActiveGame: async () => {},
                    endActiveGame: async () => {},
                },
            },
        );

        assert.match(blocked.calls.reply.content, /already claimed your daily/i);
        assert.equal(blocked.calls.reply.ephemeral, true);

        const saved = [];
        const promptCalls = [];
        const success = await dispatchCommand(
            'daily',
            {},
            {
                db: {
                    getUser: async () => {
                        const user = {
                            guildId: 'guild-1',
                            userId: 'user-1',
                            isPremium: false,
                            lastDailyClaim: null,
                            points: 100,
                            weeklyPoints: 5,
                            monthlyPoints: 10,
                            currentStreak: 4,
                            save: async () => {
                                saved.push({
                                    points: user.points,
                                    weeklyPoints: user.weeklyPoints,
                                    monthlyPoints: user.monthlyPoints,
                                    lastDailyClaim: user.lastDailyClaim,
                                });
                            },
                        };
                        return user;
                    },
                    updateUser: async () => {},
                    transferCreditsAtomic: async () => ({ ok: true, transferred: 0, senderBalance: 100 }),
                    joinFactionAtomic: async () => ({ ok: true, factionName: 'Dragons' }),
                    claimDailyAtomic: async (_guildId, _userId, reward, now) => {
                        saved.push({
                            points: 150,
                            weeklyPoints: 55,
                            monthlyPoints: 60,
                            lastDailyClaim: now,
                        });
                        return { ok: true, reward, lastDailyClaim: now };
                    },
                    addScore: async () => {},
                    addManualPointAdjustment: async () => {},
                    getSystemConfig: async () => ({}),
                    updateSystemConfig: async (_guildId, updater) => {
                        const cfg = {};
                        updater(cfg);
                        return cfg;
                    },
                    refreshLeaderboard: async () => {},
                    resolveLeaderboardSort: () => 'points',
                    leaderboardCache: new Map(),
                    createActiveGame: async () => {},
                    updateActiveGame: async () => {},
                    endActiveGame: async () => {},
                },
                premiumUpsell: {
                    shouldShowPremiumPrompt: () => true,
                    markPremiumPromptShown: async () => {
                        promptCalls.push('marked');
                    },
                    tryHostPremiumNudge: async () => {},
                    sendPremiumBoostSessionHint: async () => {},
                },
                premiumAnalytics: {
                    trackPremiumPromptShown: async (payload) => {
                        promptCalls.push(payload.trigger);
                    },
                    trackPremiumConversion: async () => {},
                },
            },
        );

        assert.equal(saved.length, 1);
        assert.equal(saved[0].points, 150);
        assert.equal(saved[0].weeklyPoints, 55);
        assert.equal(saved[0].monthlyPoints, 60);
        assert.equal(saved[0].lastDailyClaim, cooldownNow);
        assert.match(success.calls.reply.content, /claimed \*\*50 Credits\*\*/i);
        assert.match(success.calls.reply.content, /Premium users/i);
        assert.deepEqual(promptCalls, ['daily', 'marked']);
    } finally {
        Date.now = originalNow;
        Math.random = originalRandom;
    }
});

test('pay blocks self-pay and completes valid transfers', async () => {
    const self = await dispatchCommand('pay', {
        actorUser: { id: 'user-1', bot: false, username: 'Tester' },
        user: { id: 'user-1', bot: false, username: 'Tester' },
        amount: 25,
    });

    assert.match(self.calls.reply.content, /cannot pay yourself/i);
    assert.equal(self.calls.reply.ephemeral, true);

    const paid = await dispatchCommand(
        'pay',
        {
            actorUser: { id: 'user-1', bot: false, username: 'Tester' },
            user: { id: 'user-2', bot: false, username: 'Friend' },
            amount: 40,
        },
        {
            db: {
                getUser: async () => ({ guildId: 'guild-1', userId: 'user-1', points: 120, save: async () => {} }),
                updateUser: async () => {},
                transferCreditsAtomic: async (_guildId, fromUserId, toUserId, amount) => {
                    assert.equal(fromUserId, 'user-1');
                    assert.equal(toUserId, 'user-2');
                    assert.equal(amount, 40);
                    return { ok: true, transferred: 40, senderBalance: 80 };
                },
                joinFactionAtomic: async () => ({ ok: true, factionName: 'Dragons' }),
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({}),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
        },
    );

    assert.match(paid.calls.reply.content, /Transfer complete/i);
});

test('duel creates a pending challenge for a valid opponent', async () => {
    const originalSetTimeout = global.setTimeout;
    const timeouts = [];
    global.setTimeout = (fn, delay) => {
        timeouts.push({ fn, delay });
        return { delay };
    };
    try {
        const interaction = await dispatchCommand(
        'duel',
        {
            actorUser: { id: 'user-1', bot: false, username: 'Tester' },
            user: { id: 'user-2', bot: false, username: 'Opponent' },
            bet: 30,
            fetchReply: true,
            },
            {
                db: {
                    getUser: async (_guildId, userId) => ({
                        guildId: 'guild-1',
                        userId,
                        points: userId === 'user-1' ? 150 : 90,
                        save: async () => {},
                    }),
                    updateUser: async () => {},
                    addScore: async () => {},
                    addManualPointAdjustment: async () => {},
                    getSystemConfig: async () => ({}),
                    updateSystemConfig: async (_guildId, updater) => {
                        const cfg = {};
                        updater(cfg);
                        return cfg;
                    },
                    refreshLeaderboard: async () => {},
                    resolveLeaderboardSort: () => 'points',
                    leaderboardCache: new Map(),
                    createActiveGame: async () => {},
                    updateActiveGame: async () => {},
                    endActiveGame: async () => {},
                },
                duelFlair: {
                    pickDuelChallengeFlair: () => ({
                        color: 0x3366ff,
                        quote: 'Fight!',
                        imageUrl: 'https://example.com/duel.png',
                    }),
                    pickDuelFightLine: () => 'Fight!',
                },
            },
        );

        assert.match(interaction.calls.reply.content, /you've been challenged/i);
        assert.equal(interaction.calls.reply.embeds[0].data.title.includes('Trivia duel challenge'), true);
        assert.equal(interaction.calls.reply.components.length, 1);
        assert.equal(timeouts[0].delay, 60000);
    } finally {
        global.setTimeout = originalSetTimeout;
    }
});

test('achievement create, list, grant, and revoke route correctly', async () => {
    const updateSnapshots = [];
    const grantCalls = [];
    const revokeCalls = [];

    const created = await dispatchCommand(
        'achievement',
        {
            actorUser: { id: 'user-1', bot: false, username: 'Tester' },
            member: { permissions: { has: () => true }, roles: { cache: new Map() } },
            subcommand: 'create',
            key: 'custom_mvp',
            name: 'MVP',
            description: 'Most valuable player',
            emoji: '🏆',
        },
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    points: 100,
                    achievements: [],
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ customAchievements: [], roleRewards: new Map() }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = { customAchievements: [], roleRewards: new Map() };
                    updater(cfg);
                    updateSnapshots.push({
                        customAchievements: cfg.customAchievements.map((a) => ({ ...a })),
                    });
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            achievements: {
                ACHIEVEMENTS: {},
                CUSTOM_ACHIEVEMENT_KEY: /^CUSTOM_/,
                normalizeAchievementEmoji: (emoji) => emoji,
                resolveAchievementMeta: (key, cfg) => cfg.customAchievements.find((a) => a.key === key) || null,
                formatAchievementLabel: (meta) => meta?.name || '',
                awardAchievement: async (_client, _guildId, _channel, userId, key) => {
                    grantCalls.push([userId, key]);
                },
                revokeAchievement: async (_client, _guildId, userId, key) => {
                    revokeCalls.push([userId, key]);
                },
            },
        },
    );

    assert.match(created.calls.reply.content, /Created \*\*CUSTOM_MVP\*\*/i);
    assert.equal(updateSnapshots[0].customAchievements[0].key, 'CUSTOM_MVP');

    const listed = await dispatchCommand(
        'achievement',
        {
            actorUser: { id: 'user-1', bot: false, username: 'Tester' },
            member: { permissions: { has: () => true }, roles: { cache: new Map() } },
            subcommand: 'list',
        },
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    points: 100,
                    achievements: [],
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({
                    customAchievements: [{ key: 'CUSTOM_MVP', name: 'MVP', desc: 'Most valuable player', emoji: '🏆' }],
                    roleRewards: new Map(),
                }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            achievements: {
                ACHIEVEMENTS: {},
                CUSTOM_ACHIEVEMENT_KEY: /^CUSTOM_/,
                normalizeAchievementEmoji: (emoji) => emoji,
                resolveAchievementMeta: (key, cfg) => cfg.customAchievements.find((a) => a.key === key) || null,
                formatAchievementLabel: (meta) => meta?.name || '',
                awardAchievement: async () => {},
                revokeAchievement: async () => {},
            },
        },
    );

    assert.match(listed.calls.reply.content, /Custom achievements/i);
    assert.match(listed.calls.reply.content, /CUSTOM_MVP/);

    const granted = await dispatchCommand(
        'achievement',
        {
            actorUser: { id: 'user-1', bot: false, username: 'Tester' },
            member: { permissions: { has: () => true }, roles: { cache: new Map() } },
            subcommand: 'grant',
            user: { id: 'user-2', bot: false, username: 'Friend' },
            key: 'CUSTOM_MVP',
        },
        {
            db: {
                getUser: async (_guildId, userId) => ({
                    guildId: 'guild-1',
                    userId,
                    points: 100,
                    achievements: [],
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({
                    customAchievements: [{ key: 'CUSTOM_MVP', name: 'MVP', desc: 'Most valuable player', emoji: '🏆' }],
                    roleRewards: new Map(),
                }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            achievements: {
                ACHIEVEMENTS: {},
                CUSTOM_ACHIEVEMENT_KEY: /^CUSTOM_/,
                normalizeAchievementEmoji: (emoji) => emoji,
                resolveAchievementMeta: (key, cfg) => cfg.customAchievements.find((a) => a.key === key) || null,
                formatAchievementLabel: (meta) => meta?.name || '',
                awardAchievement: async (_client, _guildId, _channel, userId, key) => {
                    grantCalls.push([userId, key]);
                },
                revokeAchievement: async (_client, _guildId, userId, key) => {
                    revokeCalls.push([userId, key]);
                },
            },
        },
    );

    assert.deepEqual(grantCalls, [['user-2', 'CUSTOM_MVP']]);
    assert.match(granted.calls.reply.content, /Granted .*MVP/i);

    const revoked = await dispatchCommand(
        'achievement',
        {
            actorUser: { id: 'user-1', bot: false, username: 'Tester' },
            member: { permissions: { has: () => true }, roles: { cache: new Map() } },
            subcommand: 'revoke',
            user: { id: 'user-2', bot: false, username: 'Friend' },
            key: 'CUSTOM_MVP',
        },
        {
            db: {
                getUser: async (_guildId, userId) => ({
                    guildId: 'guild-1',
                    userId,
                    points: 100,
                    achievements: ['CUSTOM_MVP'],
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ customAchievements: [], roleRewards: new Map() }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            achievements: {
                ACHIEVEMENTS: {},
                CUSTOM_ACHIEVEMENT_KEY: /^CUSTOM_/,
                normalizeAchievementEmoji: (emoji) => emoji,
                resolveAchievementMeta: () => null,
                formatAchievementLabel: (meta) => meta?.name || '',
                awardAchievement: async () => {},
                revokeAchievement: async (_client, _guildId, userId, key) => {
                    revokeCalls.push([userId, key]);
                },
            },
        },
    );

    assert.deepEqual(revokeCalls, [['user-2', 'CUSTOM_MVP']]);
    assert.match(revoked.calls.reply.content, /Removed `CUSTOM_MVP`/i);
});

test('leaderboard and leaderboard_history render server rankings and saved periods', async () => {
    const leaderboard = await dispatchCommand(
        'leaderboard',
        { member: { permissions: { has: () => true }, roles: { cache: new Map() } } },
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    points: 100,
                    currentCosmetics: new Map(),
                    achievements: [],
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ shopItems: [] }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => ({
                    sort: { points: -1 },
                    scoreKey: 'points',
                    title: 'All-time',
                }),
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            models: {
                User: {
                    findOne: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        isBlacklisted: false,
                        isPremium: false,
                        premiumSource: null,
                        agreedTermsVersion: '2026-04',
                        agreedPrivacyVersion: '2026-04',
                        save: async () => {},
                    }),
                    create: async () => ({}),
                    find: () => ({
                        sort: () => ({
                            limit: async () => [
                                { userId: 'user-1', points: 120, currentCosmetics: new Map(), isPremium: false },
                                { userId: 'user-2', points: 75, currentCosmetics: new Map(), isPremium: true },
                            ],
                        }),
                    }),
                },
                ReferralProfile: {},
                SystemConfig: {},
                Game: { find: async () => [] },
                Word: {},
                Phrase: {},
                MovieQuote: {},
                Achievement: {},
                ShopItem: {
                    find: async () => [],
                    findOne: async () => null,
                },
                RecurringGame: {},
                Faction: {},
                FactionChallenge: {},
                LeaderboardPeriodSnapshot: {
                    find: () => ({
                        sort: () => ({
                            limit: () => ({
                                lean: async () => [
                                    {
                                        endedAt: '2026-04-06T20:00:00Z',
                                        entries: [
                                            { rank: 1, userId: 'user-1', score: 80 },
                                            { rank: 2, userId: 'user-2', score: 60 },
                                        ],
                                    },
                                ],
                            }),
                        }),
                    }),
                },
                ReferralFirstGamePayout: {},
            },
        },
    );

    assert.match(leaderboard.calls.reply.content, /Server activity rankings/i);
    assert.match(leaderboard.calls.reply.content, /user-1/i);

    const history = await dispatchCommand(
        'leaderboard_history',
        { period: 'weekly', periods: 2, member: { permissions: { has: () => true }, roles: { cache: new Map() } } },
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    points: 100,
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({}),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            models: {
                User: {
                    findOne: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        isBlacklisted: false,
                        isPremium: false,
                        premiumSource: null,
                        agreedTermsVersion: '2026-04',
                        agreedPrivacyVersion: '2026-04',
                        save: async () => {},
                    }),
                    create: async () => ({}),
                },
                ReferralProfile: {},
                SystemConfig: {},
                Game: { find: async () => [] },
                Word: {},
                Phrase: {},
                MovieQuote: {},
                Achievement: {},
                ShopItem: { find: async () => [], findOne: async () => null },
                RecurringGame: {},
                Faction: {},
                FactionChallenge: {},
                LeaderboardPeriodSnapshot: {
                    find: () => ({
                        sort: () => ({
                            limit: () => ({
                                lean: async () => [
                                    {
                                        endedAt: '2026-04-06T20:00:00Z',
                                        entries: [{ rank: 1, userId: 'user-1', score: 90 }],
                                    },
                                ],
                            }),
                        }),
                    }),
                },
                ReferralFirstGamePayout: {},
            },
        },
    );

    assert.equal(history.calls.reply.embeds[0].data.title.includes('Weekly Credits history'), true);
});

test('faction join, leave, switch, stats, and server views behave correctly', async () => {
    const joined = [];
    const leftRoleSync = [];
    const join = await dispatchCommand(
        'faction',
        { subcommand: 'join', name: 'Dragons' },
        {
            officialFactionJoin: {
                joinOfficialFactionInGuild: async (_interaction, name) => ({ ok: true, content: `Joined ${name}` }),
                resolveFactionDocForJoin: async () => null,
            },
        },
    );
    assert.match(join.calls.reply.content, /Joined Dragons/i);

    const leave = await dispatchCommand(
        'faction',
        { subcommand: 'leave' },
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    faction: 'Dragons',
                    competitivePoints: 44,
                    save: async function () {
                        joined.push(this.faction);
                    },
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({}),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            factionChallenge: {
                computeScores: () => [],
                pickChallengeWinner: () => null,
                expireStaleChallenges: async () => {},
                getActiveChallenge: async () => null,
                isRoyale: () => false,
                getParticipantIds: () => [],
                isRosterFullForFaction: () => false,
                teamRawPointSum: () => 0,
                getScoreByUser: () => 0,
                getRawScoreByUser: () => 0,
                buildRankedRulesSnapshot: () => ({}),
                isChallengeRanked: () => false,
                ROYALE_FACTIONS: ['Dragons'],
                FACTION_SWITCH_COOLDOWN_MS: 7 * 24 * 3600000,
                reconcileFactionTotalsForLeavingMember: async () => {},
                removeUserFromFactionChallengeEnrollment: async () => {},
                grantFactionVictoryRoleIfConfigured: async () => {},
                isUserEnrolledInActiveFactionChallenge: async () => false,
                formatChallengeGameFilterLabel: () => '',
                applyEndedChallengeToGlobalTotals: async () => {},
            },
            factionGuild: {
                syncFactionMemberRoles: async (_guild, _userId, _cfg, name) => {
                    leftRoleSync.push(name);
                },
                getFactionDisplayName: (name) => name,
                getFactionDisplayEmoji: () => '',
                formatFactionDualLabel: (name) => name,
            },
        },
    );
    assert.match(leave.calls.reply.content, /left your faction/i);
    assert.deepEqual(joined, [null]);
    assert.deepEqual(leftRoleSync, [null]);

    const switched = [];
    const switchResult = await dispatchCommand(
        'faction',
        { subcommand: 'switch', name: 'Wolves' },
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    isPremium: true,
                    faction: 'Dragons',
                    competitivePoints: 10,
                    lastFactionSwitchAt: null,
                    save: async function () {
                        switched.push({ faction: this.faction, lastFactionSwitchAt: this.lastFactionSwitchAt });
                    },
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({}),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            officialFactionJoin: {
                joinOfficialFactionInGuild: async () => ({ ok: true }),
                resolveFactionDocForJoin: async () => ({
                    emoji: '🐺',
                    members: 2,
                    save: async () => {},
                }),
            },
            factionGuild: {
                syncFactionMemberRoles: async () => {},
                getFactionDisplayName: (name) => name,
                getFactionDisplayEmoji: () => '🐺',
                formatFactionDualLabel: (name) => name,
            },
        },
    );
    assert.match(switchResult.calls.reply.content, /Switched to/i);
    assert.equal(switched[0].faction, 'Wolves');

    const stats = await dispatchCommand(
        'faction',
        { subcommand: 'stats' },
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    faction: 'Wolves',
                    points: 150,
                    competitivePoints: 77,
                    isPremium: false,
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({}),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            models: {
                User: {
                    findOne: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        isBlacklisted: false,
                        isPremium: false,
                        premiumSource: null,
                        agreedTermsVersion: '2026-04',
                        agreedPrivacyVersion: '2026-04',
                        save: async () => {},
                    }),
                    create: async () => ({}),
                },
                ReferralProfile: {},
                SystemConfig: {},
                Game: { find: async () => [] },
                Word: {},
                Phrase: {},
                MovieQuote: {},
                Achievement: {},
                ShopItem: { find: async () => [], findOne: async () => null },
                RecurringGame: {},
                Faction: {
                    findOne: async () => ({ name: 'Wolves', desc: 'Pack', emoji: '🐺' }),
                },
                FactionChallenge: {},
                LeaderboardPeriodSnapshot: {},
                ReferralFirstGamePayout: {},
            },
            globalFactionAggregates: {
                getGlobalFactionStandingsFromUsers: async () => [],
                getGlobalFactionTotalsForName: async () => ({
                    matchPoints: 12,
                    rankedWins: 4,
                    rankedLosses: 2,
                    rankedTies: 0,
                    rawWarContributionTotal: 300,
                    legacyChallengePoints: 20,
                    members: 55,
                }),
                getTopGuildsForFactionChallengePoints: async () => [],
            },
            factionGuild: {
                syncFactionMemberRoles: async () => {},
                getFactionDisplayName: (name) => name,
                getFactionDisplayEmoji: () => '🐺',
                formatFactionDualLabel: (name) => name,
            },
        },
    );
    assert.equal(stats.calls.reply.embeds[0].data.title.includes('Wolves'), true);

    const serverView = await dispatchCommand(
        'faction',
        { subcommand: 'server' },
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    faction: 'Wolves',
                    points: 100,
                    competitivePoints: 20,
                    isPremium: false,
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({}),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            models: {
                User: {
                    findOne: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        isBlacklisted: false,
                        isPremium: false,
                        premiumSource: null,
                        agreedTermsVersion: '2026-04',
                        agreedPrivacyVersion: '2026-04',
                        save: async () => {},
                    }),
                    create: async () => ({}),
                    aggregate: async () => [
                        { _id: 'Wolves', members: 3, points: 88 },
                        { _id: 'Dragons', members: 2, points: 42 },
                    ],
                },
                ReferralProfile: {},
                SystemConfig: {},
                Game: { find: async () => [] },
                Word: {},
                Phrase: {},
                MovieQuote: {},
                Achievement: {},
                ShopItem: { find: async () => [], findOne: async () => null },
                RecurringGame: {},
                Faction: {
                    find: async () => [{ name: 'Wolves', emoji: '🐺' }, { name: 'Dragons', emoji: '🐉' }],
                },
                FactionChallenge: {},
                LeaderboardPeriodSnapshot: {},
                ReferralFirstGamePayout: {},
            },
            factionGuild: {
                syncFactionMemberRoles: async () => {},
                getFactionDisplayName: (name) => name,
                getFactionDisplayEmoji: (name) => (name === 'Wolves' ? '🐺' : '🐉'),
                formatFactionDualLabel: (name) => name,
            },
        },
    );
    assert.equal(serverView.calls.reply.embeds[0].data.title.includes('Server activity rankings'), true);
});

test('factions and faction_challenge gates render expected top-level responses', async () => {
    const factions = await dispatchCommand(
        'factions',
        {},
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    faction: 'Dragons',
                    isPremium: false,
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({}),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            globalFactionAggregates: {
                getGlobalFactionStandingsFromUsers: async () => [
                    { name: 'Dragons', matchPoints: 9, rankedWins: 3, rankedLosses: 1, rankedTies: 0, members: 30, emoji: '🐉' },
                    { name: 'Wolves', matchPoints: 6, rankedWins: 2, rankedLosses: 2, rankedTies: 0, members: 25, emoji: '🐺' },
                ],
                getGlobalFactionTotalsForName: async () => ({}),
                getTopGuildsForFactionChallengePoints: async () => [],
            },
        },
    );
    assert.equal(factions.calls.reply.embeds[0].data.title.includes('Official Faction Rankings'), true);

    const fcDenied = await dispatchCommand(
        'faction_challenge',
        { subcommand: 'create' },
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    isPremium: false,
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({}),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
        },
    );
    assert.match(fcDenied.calls.reply.content, /require \*\*PlayBound Premium\*\*/i);
});

test('delegated game module handlers short-circuit the router when they handle an interaction', async () => {
    const seen = [];
    const interaction = await dispatchCommand(
        'startserverdle',
        {},
        {
            serverdle: {
                handleInteraction: async (intr) => {
                    seen.push(['serverdle', intr.commandName]);
                    return true;
                },
            },
            guessthenumber: {
                handleInteraction: async () => {
                    seen.push(['gtn']);
                    return false;
                },
            },
            spellingbee: {
                handleInteraction: async () => {
                    seen.push(['spellingbee']);
                    return false;
                },
            },
        },
    );

    assert.deepEqual(seen, [['serverdle', 'startserverdle']]);
    assert.equal(interaction.calls.reply, undefined);
});

test('hosted game commands use the scheduled path cleanly when a delay is requested', async () => {
    const scheduled = [];
    const commonOverrides = {
        scheduleGame: async (guildId, type, channelId) => {
            scheduled.push({ guildId, type, channelId });
            return 'sched-42';
        },
        db: {
            getUser: async () => ({
                guildId: 'guild-1',
                userId: 'user-1',
                isPremium: false,
                points: 100,
                save: async () => {},
            }),
            updateUser: async () => {},
            addScore: async () => {},
            addManualPointAdjustment: async () => {},
            getSystemConfig: async () => ({}),
            updateSystemConfig: async (_guildId, updater) => {
                const cfg = {};
                updater(cfg);
                return cfg;
            },
            refreshLeaderboard: async () => {},
            resolveLeaderboardSort: () => 'points',
            leaderboardCache: new Map(),
            createActiveGame: async () => {},
            updateActiveGame: async () => {},
            endActiveGame: async () => {},
        },
        announcements: {
            sendGlobalAnnouncement: async () => null,
            announceScheduledGame: () => {},
            announceWinner: noop,
            announceFactionChallengeToGuild: noop,
            shouldPingEveryone: () => false,
        },
        utils: {
            decodeHTMLEntities: (v) => v,
            scramblePhrase: (v) => v,
            parsePointValues: () => ({ first: 5, second: 3, third: 1 }),
            MAX_POINTS_PER_PLACEMENT: 100,
            isFuzzyMatch: () => false,
            normalizeText: (v) => v,
            disableComponentsInThread: async () => {},
            defaultGameThreadName: (name) => `${name} Thread`,
        },
        premiumPerks: {
            clampHostGameInt: (v) => v,
        },
    };

    const { interaction: giveaway } = await dispatchCommandWithContext(
        'giveaway',
        {
            duration: 10,
            winners: 2,
            delay_hrs: 1,
            thread_name: 'Gift Thread',
            member: { permissions: { has: () => true }, roles: { cache: new Map() } },
        },
        commonOverrides,
    );
    assert.ok(giveaway.calls.deferReply);
    assert.match(giveaway.calls.editReply.content, /Scheduled!/i);
    assert.match(giveaway.calls.editReply.content, /sched-42/);

    const { interaction: moviequotes } = await dispatchCommandWithContext(
        'moviequotes',
        {
            rounds: 3,
            round_seconds: 30,
            delay_hrs: 1,
            thread_name: 'Movie Night',
            member: { permissions: { has: () => true }, roles: { cache: new Map() } },
        },
        commonOverrides,
    );
    assert.ok(moviequotes.calls.deferReply);
    assert.match(moviequotes.calls.editReply.content, /Scheduled!/i);
    assert.match(moviequotes.calls.editReply.content, /sched-42/);

    const { interaction: caption } = await dispatchCommandWithContext(
        'caption',
        {
            duration: 5,
            delay_hrs: 1,
            thread_name: 'Caption Time',
            member: { permissions: { has: () => true }, roles: { cache: new Map() } },
        },
        commonOverrides,
    );
    assert.ok(caption.calls.deferReply);
    assert.match(caption.calls.editReply.content, /Scheduled!/i);
    assert.match(caption.calls.editReply.content, /sched-42/);

    const { interaction: sprint } = await dispatchCommandWithContext(
        'triviasprint',
        {
            duration: 10,
            delay_hrs: 1,
            thread_name: 'Sprint Thread',
            member: { permissions: { has: () => true }, roles: { cache: new Map() } },
        },
        commonOverrides,
    );
    assert.ok(sprint.calls.deferReply);
    assert.match(sprint.calls.editReply.content, /Scheduled!/i);
    assert.match(sprint.calls.editReply.content, /sched-42/);

    const { interaction: unscramble } = await dispatchCommandWithContext(
        'unscramble',
        {
            rounds: 4,
            delay_hrs: 1,
            thread_name: 'Unscramble Thread',
            member: { permissions: { has: () => true }, roles: { cache: new Map() } },
        },
        commonOverrides,
    );
    assert.ok(unscramble.calls.deferReply);
    assert.match(unscramble.calls.editReply.content, /Scheduled!/i);
    assert.match(unscramble.calls.editReply.content, /sched-42/);

    const { interaction: tune } = await dispatchCommandWithContext(
        'namethattune',
        {
            rounds: 3,
            delay_hrs: 1,
            thread_name: 'Tune Thread',
            member: { permissions: { has: () => true }, roles: { cache: new Map() } },
        },
        commonOverrides,
    );
    assert.ok(tune.calls.deferReply);
    assert.match(tune.calls.editReply.content, /Scheduled!/i);
    assert.match(tune.calls.editReply.content, /sched-42/);

    assert.deepEqual(
        scheduled.map((row) => row.type),
        ['Giveaway', 'TV & Movie Quotes', 'Caption Contest', 'Trivia Sprint', 'Unscramble', 'Name That Tune'],
    );
});

test('endgame can cancel a scheduled game and can build a selection menu', async () => {
    const scheduledGames = new Map([
        [
            'sched-1',
            {
                id: 'sched-1',
                guildId: 'guild-1',
                type: 'Trivia Sprint',
                channelId: 'channel-9',
                startTime: new Date('2026-04-09T18:00:00Z'),
                timeoutHandle: { id: 1 },
            },
        ],
    ]);
    const originalClearTimeout = global.clearTimeout;
    const cleared = [];
    global.clearTimeout = (handle) => {
        cleared.push(handle);
    };
    try {
        const cancelled = await dispatchCommandWithContext(
            'endgame',
            { thread_id: 'sched-1', member: { permissions: { has: () => true }, roles: { cache: new Map() } } },
            {
                scheduledGames,
                models: {
                    User: {
                        findOne: async () => ({
                            guildId: 'guild-1',
                            userId: 'user-1',
                            isBlacklisted: false,
                            isPremium: false,
                            premiumSource: null,
                            agreedTermsVersion: '2026-04',
                            agreedPrivacyVersion: '2026-04',
                            save: async () => {},
                        }),
                        create: async () => ({}),
                    },
                    ReferralProfile: {},
                    SystemConfig: {},
                    Game: {
                        find: async () => [],
                        findOneAndUpdate: async () => ({}),
                    },
                    Word: {},
                    Phrase: {},
                    MovieQuote: {},
                    Achievement: {},
                    ShopItem: { find: async () => [], findOne: async () => null },
                    RecurringGame: { find: async () => [] },
                    Faction: {},
                    FactionChallenge: {},
                    LeaderboardPeriodSnapshot: {},
                    ReferralFirstGamePayout: {},
                },
                db: {
                    getUser: async () => ({ guildId: 'guild-1', userId: 'user-1', points: 1, save: async () => {} }),
                    updateUser: async () => {},
                    addScore: async () => {},
                    addManualPointAdjustment: async () => {},
                    getSystemConfig: async () => ({}),
                    updateSystemConfig: async (_guildId, updater) => {
                        const cfg = {};
                        updater(cfg);
                        return cfg;
                    },
                    refreshLeaderboard: async () => {},
                    resolveLeaderboardSort: () => 'points',
                    leaderboardCache: new Map(),
                    createActiveGame: async () => {},
                    updateActiveGame: async () => {},
                    endActiveGame: async () => null,
                },
            },
        );

        assert.ok(cancelled.interaction.calls.deferReply);
        assert.match(cancelled.interaction.calls.editReply.content, /Cancelled scheduled/i);
        assert.equal(cleared.length, 1);
        assert.equal(scheduledGames.has('sched-1'), false);

        const menuGames = new Map([
            [
                'sched-2',
                {
                    id: 'sched-2',
                    guildId: 'guild-1',
                    type: 'Giveaway',
                    channelId: 'channel-3',
                    startTime: new Date('2026-04-10T12:00:00Z'),
                    timeoutHandle: { id: 2 },
                },
            ],
        ]);
        const menu = await dispatchCommandWithContext(
            'endgame',
            { member: { permissions: { has: () => true }, roles: { cache: new Map() } } },
            {
                scheduledGames: menuGames,
                models: {
                    User: {
                        findOne: async () => ({
                            guildId: 'guild-1',
                            userId: 'user-1',
                            isBlacklisted: false,
                            isPremium: false,
                            premiumSource: null,
                            agreedTermsVersion: '2026-04',
                            agreedPrivacyVersion: '2026-04',
                            save: async () => {},
                        }),
                        create: async () => ({}),
                    },
                    ReferralProfile: {},
                    SystemConfig: {},
                    Game: {
                        find: async () => [{ type: 'Trivia', threadId: 'thread-1', _id: 'g1' }],
                    },
                    Word: {},
                    Phrase: {},
                    MovieQuote: {},
                    Achievement: {},
                    ShopItem: { find: async () => [], findOne: async () => null },
                    RecurringGame: { find: async () => [{ _id: 'rec-1', type: 'caption', intervalHours: 6 }] },
                    Faction: {},
                    FactionChallenge: {},
                    LeaderboardPeriodSnapshot: {},
                    ReferralFirstGamePayout: {},
                },
                db: {
                    getUser: async () => ({ guildId: 'guild-1', userId: 'user-1', points: 1, save: async () => {} }),
                    updateUser: async () => {},
                    addScore: async () => {},
                    addManualPointAdjustment: async () => {},
                    getSystemConfig: async () => ({}),
                    updateSystemConfig: async (_guildId, updater) => {
                        const cfg = {};
                        updater(cfg);
                        return cfg;
                    },
                    refreshLeaderboard: async () => {},
                    resolveLeaderboardSort: () => 'points',
                    leaderboardCache: new Map(),
                    createActiveGame: async () => {},
                    updateActiveGame: async () => {},
                    endActiveGame: async () => null,
                },
            },
        );

        assert.match(menu.interaction.calls.editReply.content, /Which game would you like to forcefully end/i);
        assert.ok(menu.interaction.calls.editReply.components.length > 0);
    } finally {
        global.clearTimeout = originalClearTimeout;
    }
});

test('hosted game live-start paths create threads and runtime state for giveaway, caption, sprint, and unscramble', async () => {
    const originalSetTimeout = global.setTimeout;
    const timers = [];
    global.setTimeout = (fn, delay) => {
        timers.push({ fn, delay });
        return { delay };
    };
    try {
        const createdGames = [];
        const auraTargets = [];
        const announcements = [];
        const makeThreadChannel = (threadId, messageId = `${threadId}-msg`) => {
            const sent = [];
            const thread = {
                id: threadId,
                sent,
                async send(payload) {
                    sent.push(payload);
                    return {
                        id: messageId,
                        async edit(editPayload) {
                            thread.lastEdit = editPayload;
                            return editPayload;
                        },
                    };
                },
            };
            return thread;
        };

        const commonOverrides = {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    isPremium: false,
                    points: 100,
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({}),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async (...args) => {
                    createdGames.push(args);
                },
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            announcements: {
                sendGlobalAnnouncement: async (_client, _guildId, text, refId) => {
                    announcements.push([text, refId]);
                    return { id: `announce-${refId}` };
                },
                announceScheduledGame: () => {},
                announceWinner: noop,
                announceFactionChallengeToGuild: noop,
                shouldPingEveryone: () => false,
            },
            auraBoostRegistry: {
                registerAuraBoostTarget: (id) => {
                    auraTargets.push(id);
                },
                runAuraBoost: async () => {},
            },
            gameAuraButton: {
                auraBoostRow: (id) => ({ id, components: [] }),
            },
            utils: {
                decodeHTMLEntities: (v) => v,
                scramblePhrase: (v) => v,
                parsePointValues: () => ({ first: 5, second: 3, third: 1 }),
                MAX_POINTS_PER_PLACEMENT: 100,
                isFuzzyMatch: () => false,
                normalizeText: (v) => v,
                disableComponentsInThread: async () => {},
                defaultGameThreadName: (name) => `${name} Thread`,
            },
            premiumPerks: {
                clampHostGameInt: (v) => v,
            },
            factionChallengeHostWarning: {
                getFactionChallengeStaffOverlapSuffix: async () => '',
            },
        };

        const giveawayThread = makeThreadChannel('thread-giveaway', 'msg-giveaway');
        const { interaction: giveaway, deps: giveawayDeps } = await dispatchCommandWithContext(
            'giveaway',
            {
                duration: 10,
                winners: 2,
                thread_name: 'Giveaway Thread',
                member: { permissions: { has: () => true }, roles: { cache: new Map() } },
                channel: {
                    id: 'channel-1',
                    type: 0,
                    archived: false,
                    isThread: () => false,
                    threads: {
                        create: async () => giveawayThread,
                    },
                },
            },
            {
                ...commonOverrides,
                scheduleGame: async () => 'sched-unused',
            },
        );
        assert.match(giveaway.calls.editReply.content, /Starting!/i);
        assert.equal(giveawayDeps.state.activeGiveaways.has('msg-giveaway'), true);

        const captionThread = makeThreadChannel('thread-caption');
        const { interaction: caption, deps: captionDeps } = await dispatchCommandWithContext(
            'caption',
            {
                duration: 5,
                thread_name: 'Caption Thread',
                member: { permissions: { has: () => true }, roles: { cache: new Map() } },
                channel: {
                    id: 'channel-1',
                    type: 0,
                    archived: false,
                    isThread: () => false,
                    threads: {
                        create: async () => captionThread,
                    },
                },
            },
            {
                ...commonOverrides,
                axios: {
                    get: async () => ({ data: [{ url: 'https://example.com/cat.png' }] }),
                },
            },
        );
        assert.match(caption.calls.editReply.content, /Caption contest started!/i);
        assert.equal(captionDeps.state.activeCaptions.has('thread-caption'), true);

        const sprintThread = makeThreadChannel('thread-sprint');
        const { interaction: sprint, deps: sprintDeps } = await dispatchCommandWithContext(
            'triviasprint',
            {
                duration: 10,
                questions: 2,
                thread_name: 'Sprint Thread',
                member: { permissions: { has: () => true }, roles: { cache: new Map() } },
                channel: {
                    id: 'channel-1',
                    type: 0,
                    archived: false,
                    isThread: () => false,
                    threads: {
                        create: async () => sprintThread,
                    },
                },
            },
            {
                ...commonOverrides,
                axios: {
                    get: async (url) => {
                        if (typeof url === 'string' && url.includes('api_token.php')) {
                            return { data: { response_code: 0, token: 'mock-token' } };
                        }
                        return {
                            data: {
                                response_code: 0,
                                results: [
                                    {
                                        question: '2+2?',
                                        correct_answer: '4',
                                        incorrect_answers: ['1', '2', '3'],
                                    },
                                    {
                                        question: '3+3?',
                                        correct_answer: '6',
                                        incorrect_answers: ['4', '5', '7'],
                                    },
                                ],
                            },
                        };
                    },
                },
            },
        );
        assert.match(sprint.calls.editReply.content, /Sprint started!/i);
        assert.equal(sprintDeps.state.activeSprints.has('thread-sprint'), true);

        const unscrambleThread = makeThreadChannel('thread-unscramble');
        const { interaction: unscramble, deps: unscrambleDeps } = await dispatchCommandWithContext(
            'unscramble',
            {
                rounds: 3,
                thread_name: 'Unscramble Thread',
                member: { permissions: { has: () => true }, roles: { cache: new Map() } },
                channel: {
                    id: 'channel-1',
                    type: 0,
                    archived: false,
                    isThread: () => false,
                    threads: {
                        create: async () => unscrambleThread,
                    },
                },
            },
            {
                ...commonOverrides,
                unscramble: {
                    buildUnscramblePhrasesForGame: async () => ['alpha beta', 'gamma delta', 'omega'],
                },
            },
        );
        assert.match(unscramble.calls.editReply.content, /Unscramble Sprint started!/i);
        assert.equal(unscrambleDeps.state.activeUnscrambles.has('thread-unscramble'), true);

        assert.equal(createdGames.length, 4);
        assert.ok(auraTargets.length >= 4);
        assert.ok(announcements.length >= 4);
        assert.ok(timers.length >= 4);
    } finally {
        global.setTimeout = originalSetTimeout;
    }
});

test('moviequotes live-start creates runtime state and namethattune rejects invalid host context', async () => {
    const originalSetTimeout = global.setTimeout;
    const timers = [];
    global.setTimeout = (fn, delay) => {
        timers.push({ fn, delay });
        return { delay };
    };
    try {
        const createdGames = [];
        const auraTargets = [];
        const announcements = [];
        const thread = {
            id: 'thread-moviequotes',
            sent: [],
            async send(payload) {
                this.sent.push(payload);
                return payload;
            },
        };

        const { interaction: moviequotes, deps } = await dispatchCommandWithContext(
            'moviequotes',
            {
                rounds: 2,
                round_seconds: 45,
                thread_name: 'Movie Quotes Thread',
                member: { permissions: { has: () => true }, roles: { cache: new Map() } },
                channel: {
                    id: 'channel-1',
                    type: 0,
                    archived: false,
                    isThread: () => false,
                    threads: {
                        create: async () => thread,
                    },
                },
            },
            {
                models: {
                    User: {
                        findOne: async () => ({
                            guildId: 'guild-1',
                            userId: 'user-1',
                            isBlacklisted: false,
                            isPremium: false,
                            premiumSource: null,
                            agreedTermsVersion: '2026-04',
                            agreedPrivacyVersion: '2026-04',
                            save: async () => {},
                        }),
                        create: async () => ({}),
                    },
                    ReferralProfile: {},
                    SystemConfig: {},
                    Game: { find: async () => [] },
                    Word: {},
                    Phrase: {},
                    MovieQuote: {
                        find: async () => [
                            { quote: 'May the Force be with you', answer: 'Star Wars' },
                            { quote: 'I am Iron Man', answer: 'Iron Man' },
                            { quote: 'Here is looking at you, kid', answer: 'Casablanca' },
                        ],
                    },
                    Achievement: {},
                    ShopItem: { find: async () => [], findOne: async () => null },
                    RecurringGame: {},
                    Faction: {},
                    FactionChallenge: {},
                    LeaderboardPeriodSnapshot: {},
                    ReferralFirstGamePayout: {},
                },
                db: {
                    getUser: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        isPremium: false,
                        points: 100,
                        save: async () => {},
                    }),
                    updateUser: async () => {},
                    addScore: async () => {},
                    addManualPointAdjustment: async () => {},
                    getSystemConfig: async () => ({}),
                    updateSystemConfig: async (_guildId, updater) => {
                        const cfg = {};
                        updater(cfg);
                        return cfg;
                    },
                    refreshLeaderboard: async () => {},
                    resolveLeaderboardSort: () => 'points',
                    leaderboardCache: new Map(),
                    createActiveGame: async (...args) => {
                        createdGames.push(args);
                    },
                    updateActiveGame: async () => {},
                    endActiveGame: async () => {},
                },
                announcements: {
                    sendGlobalAnnouncement: async (_client, _guildId, text, refId) => {
                        announcements.push([text, refId]);
                        return { id: `announce-${refId}` };
                    },
                    announceScheduledGame: () => {},
                    announceWinner: noop,
                    announceFactionChallengeToGuild: noop,
                    shouldPingEveryone: () => false,
                },
                auraBoostRegistry: {
                    registerAuraBoostTarget: (id) => {
                        auraTargets.push(id);
                    },
                    runAuraBoost: async () => {},
                },
                gameAuraButton: {
                    auraBoostRow: () => ({ components: [] }),
                },
                utils: {
                    decodeHTMLEntities: (v) => v,
                    scramblePhrase: (v) => v,
                    parsePointValues: () => ({ first: 5, second: 3, third: 1 }),
                    MAX_POINTS_PER_PLACEMENT: 100,
                    isFuzzyMatch: () => false,
                    normalizeText: (v) => v,
                    disableComponentsInThread: async () => {},
                    defaultGameThreadName: (name) => `${name} Thread`,
                },
                premiumPerks: {
                    clampHostGameInt: (v) => v,
                },
                factionChallengeHostWarning: {
                    getFactionChallengeStaffOverlapSuffix: async () => '',
                },
            },
        );

        assert.match(moviequotes.calls.editReply.content, /Game starting!/i);
        assert.equal(deps.state.activeMovieGames.has('thread-moviequotes'), true);
        assert.equal(createdGames.length, 1);
        assert.deepEqual(auraTargets, ['thread-moviequotes']);
        assert.equal(announcements.length, 1);
        assert.ok(timers.length >= 0);

        const tune = await dispatchCommand(
            'namethattune',
            {
                rounds: 3,
                member: { permissions: { has: () => true }, roles: { cache: new Map() } },
            },
            {
                discordGameHost: {
                    resolveGameHostChannel: () => null,
                    resolveUserVoiceChannel: async () => null,
                },
            },
        );

        assert.match(tune.calls.reply.content, /normal text channel/i);
        assert.equal(tune.calls.reply.ephemeral, true);
    } finally {
        global.setTimeout = originalSetTimeout;
    }
});

test('season replies with quarterly standings and premium faction placement details', async () => {
    const previous = require.cache[factionSeasonsPath];
    require.cache[factionSeasonsPath] = {
        id: factionSeasonsPath,
        filename: factionSeasonsPath,
        loaded: true,
        exports: {
            getCurrentSeasonOverview: async () => ({
                seasonKey: '2026-Q2',
                daysRemainingApprox: 17,
                topFactions: [
                    { factionName: 'Dragons', matchPoints: 21, wins: 7, losses: 1, ties: 0 },
                    { factionName: 'Wolves', matchPoints: 14, wins: 4, losses: 3, ties: 2 },
                ],
                lastQuarterWinnerFaction: 'Eagles',
                lastQuarterKey: '2026-Q1',
                lastQuarterWinnerGuildId: 'guild-777',
            }),
            getHallOfChampions: async () => ({
                quarters: [
                    { seasonKey: '2026-Q1', winningFactionName: 'Eagles', winningGuildId: 'guild-777' },
                    { seasonKey: '2025-Q4', winningFactionName: 'Dragons', winningGuildId: 'guild-333' },
                ],
            }),
        },
    };

    try {
        const interaction = await dispatchCommand(
            'season',
            {},
            {
                db: {
                    getUser: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        isPremium: true,
                        faction: 'Dragons',
                        save: async () => {},
                    }),
                    updateUser: async () => {},
                    addScore: async () => {},
                    addManualPointAdjustment: async () => {},
                    getSystemConfig: async () => ({ shopItems: [], roleRewards: new Map() }),
                    updateSystemConfig: async (_guildId, updater) => {
                        const cfg = {};
                        updater(cfg);
                        return cfg;
                    },
                    refreshLeaderboard: async () => {},
                    resolveLeaderboardSort: () => 'points',
                    leaderboardCache: new Map(),
                    createActiveGame: async () => {},
                    updateActiveGame: async () => {},
                    endActiveGame: async () => {},
                },
                factionPremiumInsights: {
                    formatPremiumGlobalBoardGap: () => '',
                    formatPremiumWarRosterInsight: () => '',
                    formatPremiumSeasonFactionPlacement: async () => 'Dragons are currently in **1st** place this quarter.',
                    formatPremiumServerArenaRank: () => '',
                },
            },
        );

        assert.equal(interaction.calls.reply.ephemeral, true);
        const embed = interaction.calls.reply.embeds[0].data;
        assert.match(embed.title, /2026-Q2/);
        assert.match(embed.fields[0].value, /Dragons/);
        assert.match(embed.fields[1].value, /2026-Q1/);
        assert.match(embed.fields[3].value, /1st/);
    } finally {
        if (previous) require.cache[factionSeasonsPath] = previous;
        else delete require.cache[factionSeasonsPath];
    }
});

test('profile gates non-premium peeks and renders a self profile embed', async () => {
    const locked = await dispatchCommand(
        'profile',
        {
            user: {
                id: 'user-2',
                username: 'Target',
                displayAvatarURL: () => 'https://example.com/target.png',
            },
        },
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    isPremium: false,
                    points: 100,
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ shopItems: [], roleRewards: new Map() }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
        },
    );
    assert.match(locked.calls.reply.content, /Premium.*profile peek/i);
    assert.equal(locked.calls.reply.ephemeral, true);

    const selfInteraction = await dispatchCommand(
        'profile',
        {
            actorUser: {
                id: 'user-1',
                username: 'Tester',
                displayAvatarURL: () => 'https://example.com/self.png',
            },
            guild: {
                id: 'guild-1',
                members: {
                    fetch: async () => ({
                        displayName: 'Captain Tester',
                        user: { username: 'Tester' },
                    }),
                },
            },
        },
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    isPremium: true,
                    points: 1234,
                    competitivePoints: 88,
                    weeklyPoints: 34,
                    monthlyPoints: 89,
                    currentStreak: 6,
                    birthday: '04/09',
                    stats: { messagesSent: 77, giveawaysEntered: 5 },
                    achievements: [],
                    inventory: [],
                    currentCosmetics: new Map(),
                    pointLedger: [],
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ shopItems: [], roleRewards: new Map() }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            models: {
                User: {
                    findOne: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        isBlacklisted: false,
                        isPremium: true,
                        premiumSource: null,
                        agreedTermsVersion: '2026-04',
                        agreedPrivacyVersion: '2026-04',
                        save: async () => {},
                    }),
                    create: async () => ({}),
                },
                ReferralProfile: {
                    findOne: () => ({
                        lean: async () => null,
                    }),
                },
                SystemConfig: {},
                Game: { find: async () => [] },
                Word: {},
                Phrase: {},
                MovieQuote: {},
                Achievement: {},
                ShopItem: { find: async () => [], findOne: async () => null },
                RecurringGame: {},
                Faction: {
                    findOne: () => ({
                        select: () => ({
                            lean: async () => null,
                        }),
                    }),
                },
                FactionChallenge: {},
                LeaderboardPeriodSnapshot: {},
                ReferralFirstGamePayout: {
                    countDocuments: async () => 0,
                },
            },
        },
    );

    const embed = selfInteraction.calls.reply.embeds[0].data;
    assert.match(embed.title, /Captain Tester/);
    assert.match(embed.fields[0].value, /1234/);
    assert.match(embed.fields[1].value, /6/);
    assert.match(embed.fields[2].value, /04\/09/);
});

test('trivia handler can short-circuit the router before hosted-game branches run', async () => {
    const seen = [];
    const interaction = await dispatchCommand(
        'trivia',
        {
            member: { permissions: { has: () => true }, roles: { cache: new Map() } },
        },
        {
            trivia: {
                handleInteraction: async (intr) => {
                    seen.push(['trivia', intr.commandName]);
                    return true;
                },
            },
            models: {
                User: {
                    findOne: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        isBlacklisted: false,
                        isPremium: false,
                        premiumSource: null,
                        agreedTermsVersion: '2026-04',
                        agreedPrivacyVersion: '2026-04',
                        save: async () => {},
                    }),
                    create: async () => ({}),
                },
                ReferralProfile: {},
                SystemConfig: {},
                Game: { find: async () => [] },
                Word: {},
                Phrase: {},
                MovieQuote: {
                    find: async () => {
                        throw new Error('moviequotes branch should not run');
                    },
                },
                Achievement: {},
                ShopItem: { find: async () => [], findOne: async () => null },
                RecurringGame: {},
                Faction: {},
                FactionChallenge: {},
                LeaderboardPeriodSnapshot: {},
                ReferralFirstGamePayout: {},
            },
        },
    );

    assert.deepEqual(seen, [['trivia', 'trivia']]);
    assert.equal(interaction.calls.reply, undefined);
});

test('accept_agreements button updates stored agreement versions', async () => {
    const updates = [];
    const { interaction } = await dispatchInteractionWithContext(
        {
            kind: 'button',
            customId: 'accept_agreements',
        },
        {
            db: {
                getUser: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    save: async () => {},
                }),
                updateUser: async (_guildId, _userId, updater) => {
                    const doc = {};
                    updater(doc);
                    updates.push(doc);
                },
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ shopItems: [], roleRewards: new Map() }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
        },
    );

    assert.equal(updates.length, 1);
    assert.equal(updates[0].agreedTermsVersion, '2026-04');
    assert.equal(updates[0].agreedPrivacyVersion, '2026-04');
    assert.ok(interaction.calls.deferReply);
    assert.match(interaction.calls.editReply.content, /accepted the latest agreements/i);
});

test('shop catalog pager rejects non-owners and inventory select equips owned cosmetics', async () => {
    const denied = await dispatchInteractionWithContext({
        kind: 'button',
        customId: 'shop_cat_s_123_2',
        actorUser: { id: '999', username: 'Other User' },
    });
    assert.match(denied.interaction.calls.reply.content, /open your own catalog/i);
    assert.equal(denied.interaction.calls.reply.ephemeral, true);

    const saved = [];
    const userDoc = {
        inventory: ['badge_star'],
        currentCosmetics: new Map(),
        markModified: (field) => saved.push(['markModified', field]),
        save: async () => {
            saved.push(['save', userDoc.currentCosmetics.get('badge')]);
        },
    };
    const equip = await dispatchInteractionWithContext(
        {
            kind: 'select',
            customId: 'inventory_equip_select',
            values: ['badge_star'],
        },
        {
            db: {
                getUser: async () => userDoc,
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ shopItems: [], roleRewards: new Map() }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            models: {
                User: {
                    findOne: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        isBlacklisted: false,
                        isPremium: false,
                        premiumSource: null,
                        agreedTermsVersion: '2026-04',
                        agreedPrivacyVersion: '2026-04',
                        save: async () => {},
                    }),
                    create: async () => ({}),
                },
                ReferralProfile: {},
                SystemConfig: {},
                Game: { find: async () => [] },
                Word: {},
                Phrase: {},
                MovieQuote: {},
                Achievement: {},
                ShopItem: {
                    find: async () => [],
                    findOne: async () => ({ id: 'badge_star', name: 'Star Badge', type: 'badge' }),
                },
                RecurringGame: {},
                Faction: {},
                FactionChallenge: {},
                LeaderboardPeriodSnapshot: {},
                ReferralFirstGamePayout: {},
            },
        },
    );

    assert.equal(equip.interaction.calls.deferReply.flags[0], 64);
    assert.match(equip.interaction.calls.editReply.content, /Equipped \*\*Star Badge\*\*/i);
    assert.deepEqual(saved, [
        ['markModified', 'currentCosmetics'],
        ['save', 'badge_star'],
    ]);
});

test('unscramble guess button opens a modal and modal submit can finish the run', async () => {
    const guessButton = await dispatchInteractionWithContext({
        kind: 'button',
        customId: 'unscramble_guess_btn',
    });
    assert.equal(guessButton.interaction.calls.showModal.data.custom_id, 'unscramble_modal');

    const player = {
        startTime: Date.now() - 3200,
        score: 0,
        timeTaken: null,
        qIndex: 0,
        currentHint: false,
    };
    const { interaction } = await dispatchInteractionWithContext(
        {
            kind: 'modal',
            customId: 'unscramble_modal',
            channel: {
                id: 'thread-unscramble',
                type: 11,
                archived: false,
                isThread: () => true,
            },
            textInputs: {
                unscramble_input: 'alphabeta',
            },
        },
        {
            utils: {
                decodeHTMLEntities: (v) => v,
                scramblePhrase: (v) => v,
                parsePointValues: () => ({ first: 5, second: 3, third: 1 }),
                MAX_POINTS_PER_PLACEMENT: 100,
                isFuzzyMatch: () => true,
                normalizeText: (v) => v,
                disableComponentsInThread: async () => {},
                defaultGameThreadName: (name) => `${name} Thread`,
            },
        },
        {
            state: {
                activeUnscrambles: new Map([
                    [
                        'thread-unscramble',
                        {
                            totalRounds: 1,
                            phrases: [{ phrase: 'alpha beta', scrambled: 'beta alpha', clue: 'Greek' }],
                            players: { 'user-1': player },
                        },
                    ],
                ]),
            },
        },
    );

    assert.match(interaction.calls.update.content, /FINISHED!/i);
    assert.equal(player.score, 1);
    assert.equal(player.qIndex, 1);
    assert.ok(player.timeTaken >= 0);
});

test('premium aura button upgrades an active session and disables the aura control', async () => {
    const updates = [];
    const auraRuns = [];
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('pb_aura_thread-1').setLabel('Boost Session').setStyle(ButtonStyle.Primary),
    );
    const { interaction } = await dispatchInteractionWithContext(
        {
            kind: 'button',
            customId: 'pb_aura_thread-1',
            message: {
                id: 'msg-1',
                components: [row.toJSON()],
                edit: async () => {},
            },
        },
        {
            db: {
                getUser: async () => ({ isPremium: true }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ shopItems: [], roleRewards: new Map() }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            models: {
                User: {
                    findOne: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        isBlacklisted: false,
                        isPremium: true,
                        premiumSource: 'stripe',
                        agreedTermsVersion: '2026-04',
                        agreedPrivacyVersion: '2026-04',
                        save: async () => {},
                    }),
                    create: async () => ({}),
                },
                ReferralProfile: {},
                SystemConfig: {},
                Game: {
                    find: async () => [],
                    findOne: async () => ({
                        _id: 'game-1',
                        threadId: 'thread-1',
                        hostIsPremium: false,
                        premiumAuraBoost: false,
                    }),
                    updateOne: async (...args) => {
                        updates.push(args);
                    },
                },
                Word: {},
                Phrase: {},
                MovieQuote: {},
                Achievement: {},
                ShopItem: { find: async () => [], findOne: async () => null },
                RecurringGame: {},
                Faction: {},
                FactionChallenge: {},
                LeaderboardPeriodSnapshot: {},
                ReferralFirstGamePayout: {},
            },
            auraBoostRegistry: {
                registerAuraBoostTarget: noop,
                runAuraBoost: async (id) => {
                    auraRuns.push(id);
                },
            },
        },
    );

    assert.equal(updates.length, 1);
    assert.deepEqual(auraRuns, ['thread-1']);
    assert.match(interaction.calls.followUp.content, /activated \*\*Premium session aura\*\*/i);
    assert.equal(interaction.calls.update.components.length, 1);
});

test('giveaway entry respects restrictions and records a valid participant', async () => {
    const denied = await dispatchInteractionWithContext(
        {
            kind: 'button',
            customId: 'enter_giveaway',
            message: { id: 'giveaway-1', components: [], edit: async () => {} },
            member: {
                permissions: { has: () => false },
                roles: { cache: { some: (fn) => [{ id: 'blocked-role' }].some(fn) } },
            },
        },
        {},
        {
            state: {
                activeGiveaways: new Map([
                    [
                        'giveaway-1',
                        {
                            ignoredUsers: [],
                            ignoredRoles: ['blocked-role'],
                            participants: new Set(),
                            cooldownDays: 0,
                        },
                    ],
                ]),
            },
        },
    );
    assert.match(denied.interaction.calls.reply.content, /restricted from entering/i);

    const persisted = [];
    const valid = await dispatchInteractionWithContext(
        {
            kind: 'button',
            customId: 'enter_giveaway',
            message: { id: 'giveaway-2', components: [], edit: async () => {} },
            member: {
                permissions: { has: () => false },
                roles: { cache: { some: () => false } },
            },
        },
        {
            db: {
                getUser: async () => ({ stats: {}, save: async () => {} }),
                updateUser: async (_guildId, _userId, updater) => {
                    const doc = { stats: {} };
                    updater(doc);
                    persisted.push(doc.stats.giveawaysEntered);
                },
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ shopItems: [], roleRewards: new Map() }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async (_id, updater) => {
                    const state = {};
                    updater(state);
                    persisted.push(state.participants?.length || 0);
                },
                endActiveGame: async () => {},
            },
            achievements: {
                ACHIEVEMENTS: {},
                CUSTOM_ACHIEVEMENT_KEY: /^CUSTOM_/,
                normalizeAchievementEmoji: (emoji) => emoji,
                resolveAchievementMeta: () => null,
                formatAchievementLabel: (meta) => meta?.name || '',
                awardAchievement: async () => {
                    persisted.push('achievement-check');
                },
                revokeAchievement: async () => {},
            },
        },
        {
            state: {
                activeGiveaways: new Map([
                    [
                        'giveaway-2',
                        {
                            ignoredUsers: [],
                            ignoredRoles: [],
                            participants: new Set(),
                            cooldownDays: 0,
                        },
                    ],
                ]),
            },
        },
    );
    assert.match(valid.interaction.calls.reply.content, /Entered!/i);
    assert.ok(persisted.includes(1));
});

test('duel accept blocks underfunded targets and schedule announcement enforces premium automation rules', async () => {
    const duelState = new Map([
        [
            'duel-msg',
            {
                state: 'pending',
                targetId: 'user-1',
                challengerId: 'user-2',
                bet: 50,
                timeoutHandle: { id: 'timeout' },
            },
        ],
    ]);
    const duel = await dispatchInteractionWithContext(
        {
            kind: 'button',
            customId: 'duel_accept',
            message: {
                id: 'duel-msg',
                components: [],
                edit: async () => {},
            },
        },
        {
            db: {
                getUser: async (_guildId, userId) => ({
                    points: userId === 'user-1' ? 10 : 100,
                    weeklyPoints: 0,
                    monthlyPoints: 0,
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ shopItems: [], roleRewards: new Map() }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
        },
        {
            state: {
                activeDuels: duelState,
            },
        },
    );
    assert.match(duel.interaction.calls.reply.content, /need \*\*50\*\* Credits/i);

    const premiumDenied = await dispatchCommand(
        'schedule_announcement',
        {
            message: 'Hello world',
            member: {
                permissions: { has: () => true },
                roles: { cache: { has: () => false } },
            },
        },
        {
            db: {
                getUser: async () => ({
                    isPremium: false,
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ automatedServerPostsEnabled: true }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
        },
    );
    assert.match(premiumDenied.calls.reply.content, /Premium feature/i);

    const automationDenied = await dispatchCommand(
        'schedule_announcement',
        {
            message: 'Hello world',
            member: {
                permissions: { has: () => true },
                roles: { cache: { has: () => false } },
            },
        },
        {
            db: {
                getUser: async () => ({
                    isPremium: true,
                    save: async () => {},
                }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ automatedServerPostsEnabled: false }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            automatedPosts: {
                automatedServerPostsEnabled: () => false,
            },
        },
    );
    assert.match(automationDenied.calls.reply.content, /Automated posts.*off/i);
});

test('set_leaderboard_cadence requires manager access and refreshes on valid changes', async () => {
    const denied = await dispatchCommand(
        'set_leaderboard_cadence',
        {
            mode: 'weekly',
            member: {
                permissions: { has: () => false },
                roles: { cache: { has: () => false } },
            },
        },
        {
            db: {
                getUser: async () => ({ save: async () => {} }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ managerRoleId: 'manager-1' }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
        },
    );
    assert.match(denied.calls.reply.content, /You do not have permission to use this command/i);

    const refreshes = [];
    const allowed = await dispatchCommand(
        'set_leaderboard_cadence',
        {
            mode: 'monthly',
            member: {
                permissions: { has: () => true },
                roles: { cache: { has: () => false } },
            },
        },
        {
            db: {
                getUser: async () => ({ save: async () => {} }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ managerRoleId: 'manager-1' }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async (_client, guildId) => {
                    refreshes.push(guildId);
                },
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
        },
    );
    assert.deepEqual(refreshes, ['guild-1']);
    assert.match(allowed.calls.reply.content, /monthly/i);
});

test('admin config commands update manager/member host and auto-role settings', async () => {
    const updates = [];
    const overrides = {
        db: {
            getUser: async () => ({ isPremium: true, save: async () => {} }),
            updateUser: async () => {},
            addScore: async () => {},
            addManualPointAdjustment: async () => {},
            getSystemConfig: async () => ({ managerRoleId: 'manager-1', autoRoleId: 'role-old' }),
            updateSystemConfig: async (_guildId, updater) => {
                const cfg = {};
                updater(cfg);
                updates.push(cfg);
                return cfg;
            },
            refreshLeaderboard: async () => {},
            resolveLeaderboardSort: () => 'points',
            leaderboardCache: new Map(),
            createActiveGame: async () => {},
            updateActiveGame: async () => {},
            endActiveGame: async () => {},
        },
    };

    const manager = await dispatchCommand(
        'set_manager_role',
        {
            role: { id: 'role-manager' },
            member: { permissions: { has: () => true }, roles: { cache: { has: () => false } } },
        },
        overrides,
    );
    assert.match(manager.calls.reply.content, /Bot Manager/i);

    const memberHosts = await dispatchCommand(
        'set_member_game_hosts',
        {
            enabled: true,
            member: { permissions: { has: () => true }, roles: { cache: { has: () => false } } },
        },
        overrides,
    );
    assert.match(memberHosts.calls.reply.content, /Any member/i);

    const autoRole = await dispatchCommand(
        'set_auto_role',
        {
            role: { id: 'role-auto' },
            member: { permissions: { has: () => true }, roles: { cache: { has: () => false } } },
        },
        overrides,
    );
    assert.match(autoRole.calls.reply.content, /automatically assigned/i);

    const removeAuto = await dispatchCommand(
        'remove_auto_role',
        {
            member: { permissions: { has: () => true }, roles: { cache: { has: () => false } } },
        },
        overrides,
    );
    assert.match(removeAuto.calls.reply.content, /Auto-role disabled/i);

    assert.equal(updates[0].managerRoleId, 'role-manager');
    assert.equal(updates[1].allowMemberHostedGames, true);
    assert.equal(updates[2].autoRoleId, 'role-auto');
    assert.equal(updates[3].autoRoleId, null);
});

test('welcome and birthday message commands manage rotation content', async () => {
    const updates = [];
    let config = {
        managerRoleId: 'manager-1',
        welcomeMessages: ['Hello there'],
        birthdayMessages: ['Happy birthday'],
    };
    const overrides = {
        db: {
            getUser: async () => ({ save: async () => {} }),
            updateUser: async () => {},
            addScore: async () => {},
            addManualPointAdjustment: async () => {},
            getSystemConfig: async () => config,
            updateSystemConfig: async (_guildId, updater) => {
                const next = {
                    ...config,
                    welcomeMessages: [...(config.welcomeMessages || [])],
                    birthdayMessages: [...(config.birthdayMessages || [])],
                };
                updater(next);
                config = next;
                updates.push(next);
                return next;
            },
            refreshLeaderboard: async () => {},
            resolveLeaderboardSort: () => 'points',
            leaderboardCache: new Map(),
            createActiveGame: async () => {},
            updateActiveGame: async () => {},
            endActiveGame: async () => {},
        },
    };
    const member = { permissions: { has: () => true }, roles: { cache: { has: () => false } } };

    const addWelcome = await dispatchCommand('add_welcome_message', { message: 'Welcome aboard', member }, overrides);
    assert.match(addWelcome.calls.reply.content, /welcome message rotation/i);

    const listWelcome = await dispatchCommand('list_welcome_messages', { member }, overrides);
    assert.match(listWelcome.calls.reply.content, /Hello there/);
    assert.match(listWelcome.calls.reply.content, /Welcome aboard/);

    const removeWelcome = await dispatchCommand('remove_welcome_message', { index: 1, member }, overrides);
    assert.match(removeWelcome.calls.reply.content, /Removed welcome message/i);

    const addBirthday = await dispatchCommand('add_birthday_message', { message: 'Cake time', member }, overrides);
    assert.match(addBirthday.calls.reply.content, /birthday message rotation/i);

    const listBirthday = await dispatchCommand('list_birthday_messages', { member }, overrides);
    assert.match(listBirthday.calls.reply.content, /Happy birthday/);
    assert.match(listBirthday.calls.reply.content, /Cake time/);

    const removeBirthday = await dispatchCommand('remove_birthday_message', { index: 1, member }, overrides);
    assert.match(removeBirthday.calls.reply.content, /Removed birthday message/i);

    assert.ok(updates.length >= 4);
});

test('channel-setting admin commands store the intended channel or role targets', async () => {
    const updates = [];
    const overrides = {
        db: {
            getUser: async () => ({ save: async () => {} }),
            updateUser: async () => {},
            addScore: async () => {},
            addManualPointAdjustment: async () => {},
            getSystemConfig: async () => ({ managerRoleId: 'manager-1' }),
            updateSystemConfig: async (_guildId, updater) => {
                const cfg = {};
                updater(cfg);
                updates.push(cfg);
                return cfg;
            },
            refreshLeaderboard: async () => {},
            resolveLeaderboardSort: () => 'points',
            leaderboardCache: new Map(),
            createActiveGame: async () => {},
            updateActiveGame: async () => {},
            endActiveGame: async () => {},
        },
    };
    const member = { permissions: { has: () => true }, roles: { cache: { has: () => false } } };

    const mkChannel = (id) => ({ id, type: 0, archived: false, isThread: () => false });
    await dispatchCommand('set_welcome_channel', { channel: mkChannel('chan-welcome'), member }, overrides);
    await dispatchCommand('set_birthday_channel', { channel: mkChannel('chan-bday'), member }, overrides);
    await dispatchCommand('set_achievement_channel', { channel: mkChannel('chan-ach'), member }, overrides);
    await dispatchCommand('set_leaderboard_channel', { channel: mkChannel('chan-lead'), member }, overrides);
    await dispatchCommand('set_story_channel', { channel: mkChannel('chan-story'), member }, overrides);
    await dispatchCommand('set_faction_reminder_channel', { channel: mkChannel('chan-remind'), member }, overrides);
    await dispatchCommand('set_faction_victory_role', { role: { id: 'role-victory' }, member }, overrides);
    await dispatchCommand('set_faction_leader_role', { role: { id: 'role-leader' }, member }, overrides);

    assert.equal(updates[0].welcomeChannel, 'chan-welcome');
    assert.equal(updates[1].birthdayChannel, 'chan-bday');
    assert.equal(updates[2].achievementChannel, 'chan-ach');
    assert.equal(updates[3].leaderboardChannel, 'chan-lead');
    assert.equal(updates[4].storyChannel, 'chan-story');
    assert.equal(updates[5].factionWarReminderChannelId, 'chan-remind');
    assert.equal(updates[6].factionVictoryRoleId, 'role-victory');
    assert.equal(updates[7].factionLeaderRoleId, 'role-leader');
});

test('faction default commands can report, validate, clear, and update ranked/default settings', async () => {
    let config = {
        managerRoleId: 'manager-1',
        factionChallengeDefaultGameType: null,
        factionChallengeDefaultScoringMode: null,
        factionChallengeDefaultTopN: null,
        factionRankedDefaultRosterCap: null,
        factionRankedContributionCapsByTag: null,
    };
    const overrides = {
        db: {
            getUser: async () => ({ save: async () => {} }),
            updateUser: async () => {},
            addScore: async () => {},
            addManualPointAdjustment: async () => {},
            getSystemConfig: async () => config,
            updateSystemConfig: async (_guildId, updater) => {
                const next = { ...config };
                updater(next);
                config = next;
                return next;
            },
            refreshLeaderboard: async () => {},
            resolveLeaderboardSort: () => 'points',
            leaderboardCache: new Map(),
            createActiveGame: async () => {},
            updateActiveGame: async () => {},
            endActiveGame: async () => {},
        },
        factionChallengeDefaults: {
            resolveFactionChallengeCreateOptions: (_cfg, opts) => ({
                gameType: opts.gameType ?? 'all',
                scoringMode: opts.scoringMode ?? 'top_n_avg',
                topN: opts.topN ?? 5,
            }),
            resolveGameTypesArrayForChallenge: () => [],
            assertValidGameType: (value) => value === 'all' || value === 'platform',
            assertValidScoringMode: (value) => value === 'top_n_avg' || value === 'sum',
            BUILTIN_DEFAULT_GAME: 'all',
            BUILTIN_DEFAULT_SCORING: 'top_n_avg',
            BUILTIN_DEFAULT_TOPN: 5,
        },
        rankedFactionWar: {
            validateChallengeCreateParams: () => [],
            rankedDefaultRosterCapFromConfig: (cfg) => cfg?.factionRankedDefaultRosterCap ?? 7,
            rankedContributionCapsFromConfig: (cfg) => cfg?.factionRankedContributionCapsByTag ?? {},
            RANKED_FIXED_SCORING_MODE: 'top_n_avg',
            RANKED_FIXED_TOP_N: 5,
            RANKED_SCORING_DISPLAY_LABEL: 'Top 5 average',
            RANKED_SLASH_CREATE_WAR_VERSION: 2,
            parseContributionCapsCsv: (csv) => ({ trivia: 10, duel: 5, raw: csv }),
        },
    };
    const member = { permissions: { has: () => true }, roles: { cache: { has: () => false } } };

    const reportDefaults = await dispatchCommand('set_faction_challenge_defaults', { member }, overrides);
    assert.match(reportDefaults.calls.reply.content, /Faction challenge defaults/i);

    const invalidDefaults = await dispatchCommand(
        'set_faction_challenge_defaults',
        { member, game_type: 'bad-value' },
        overrides,
    );
    assert.match(invalidDefaults.calls.reply.content, /Invalid \*\*game_type\*\* choice/i);

    const updateDefaults = await dispatchCommand(
        'set_faction_challenge_defaults',
        { member, game_type: 'platform', scoring_mode: 'sum', top_n: 9 },
        overrides,
    );
    assert.match(updateDefaults.calls.reply.content, /Updated defaults/i);

    const clearDefaults = await dispatchCommand(
        'set_faction_challenge_defaults',
        { member, clear: true },
        overrides,
    );
    assert.match(clearDefaults.calls.reply.content, /Cleared server defaults/i);

});

test('server shop commands add and remove custom items', async () => {
    let config = { managerRoleId: 'manager-1', shopItems: [] };
    const overrides = {
        db: {
            getUser: async () => ({ isPremium: true, save: async () => {} }),
            updateUser: async () => {},
            addScore: async () => {},
            addManualPointAdjustment: async () => {},
            getSystemConfig: async () => config,
            updateSystemConfig: async (_guildId, updater) => {
                const next = { ...config, shopItems: [...(config.shopItems || [])] };
                updater(next);
                config = next;
                return next;
            },
            refreshLeaderboard: async () => {},
            resolveLeaderboardSort: () => 'points',
            leaderboardCache: new Map(),
            createActiveGame: async () => {},
            updateActiveGame: async () => {},
            endActiveGame: async () => {},
        },
    };
    const member = { permissions: { has: () => true }, roles: { cache: { has: () => false } } };

    const add = await dispatchCommand(
        'server_shop_add',
        {
            member,
            id: 'vip-badge',
            name: 'VIP Badge',
            price: 250,
            desc: 'Fancy badge',
            type: 'badge',
        },
        overrides,
    );
    assert.match(add.calls.reply.content, /Added \*\*VIP Badge\*\* to the server shop/i);
    assert.equal(config.shopItems.length, 1);

    const remove = await dispatchCommand(
        'server_shop_remove',
        {
            member,
            id: 'vip-badge',
        },
        overrides,
    );
    assert.match(remove.calls.reply.content, /Removed item \*\*vip-badge\*\* from the server shop/i);
    assert.equal(config.shopItems.length, 0);
});

test('bulk role commands enforce premium and process member role changes', async () => {
    const premiumDenied = await dispatchCommand(
        'strip_role',
        {
            role: { id: 'role-x' },
            member: { permissions: { has: () => true }, roles: { cache: { has: () => false } } },
        },
        {
            db: {
                getUser: async () => ({ isPremium: false, save: async () => {} }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ managerRoleId: 'manager-1' }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
        },
    );
    assert.match(premiumDenied.calls.reply.content, /Bulk Role Removal.*Premium feature/i);

    const removed = [];
    const stripAllowed = await dispatchCommand(
        'strip_role',
        {
            role: { id: 'role-x' },
            member: { permissions: { has: () => true }, roles: { cache: { has: () => false } } },
            guild: {
                id: 'guild-1',
                members: {
                    fetch: async () =>
                        new Map([
                            ['1', { user: { bot: false }, roles: { cache: { has: (id) => id === 'role-x' }, remove: async (id) => removed.push(id) } }],
                            ['2', { user: { bot: false }, roles: { cache: { has: () => false }, remove: async () => {} } }],
                            ['3', { user: { bot: true }, roles: { cache: { has: () => true }, remove: async () => {} } }],
                        ]),
                },
                roles: { cache: new Map([['role-x', { id: 'role-x' }]]) },
            },
        },
        {
            db: {
                getUser: async () => ({ isPremium: true, save: async () => {} }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ managerRoleId: 'manager-1' }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
        },
    );
    assert.equal(stripAllowed.calls.deferReply.flags[0], 64);
    assert.match(stripAllowed.calls.editReply.content, /Removed <@&role-x> from \*\*1\*\* members/i);
    assert.deepEqual(removed, ['role-x']);

    const syncDenied = await dispatchCommand(
        'sync_auto_role',
        {
            member: { permissions: { has: () => true }, roles: { cache: { has: () => false } } },
            guild: { id: 'guild-1', roles: { cache: new Map() }, members: { fetch: async () => new Map() } },
        },
        {
            db: {
                getUser: async () => ({ isPremium: false, save: async () => {} }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => {},
                getSystemConfig: async () => ({ managerRoleId: 'manager-1', autoRoleId: 'role-auto' }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
        },
    );
    assert.match(syncDenied.calls.reply.content, /Bulk Role Sync.*Premium feature/i);
});

test('story export and point adjustment commands handle validation and successful paths', async () => {
    const noStory = await dispatchCommand(
        'story_export',
        {
            member: { permissions: { has: () => true }, roles: { cache: { has: () => false } } },
            guild: { id: 'guild-1', members: { me: {} }, channels: { fetch: async () => null } },
        },
        {
            db: {
                getUser: async () => ({ save: async () => {} }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => ({ applied: 0, newTotal: 0 }),
                getSystemConfig: async () => ({ managerRoleId: 'manager-1' }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
        },
    );
    assert.match(noStory.calls.reply.content, /Set a story channel first/i);

    const storyChannel = {
        id: 'story-1',
        isTextBased: () => true,
        permissionsFor: () => ({ has: () => true }),
        messages: {
            fetch: async () => {
                const values = [
                    { id: 'm1', author: { bot: false }, content: 'Once', createdTimestamp: 1 },
                    { id: 'm2', author: { bot: false }, content: 'upon a time', createdTimestamp: 2 },
                ];
                return {
                    size: values.length,
                    values: function* () {
                        yield* values;
                    },
                    last: () => values[values.length - 1],
                };
            },
        },
        bulkDelete: async (batch) => ({ size: batch.size }),
        send: async () => {},
    };
    const storyOk = await dispatchCommand(
        'story_export',
        {
            member: { permissions: { has: () => true }, roles: { cache: { has: () => false } } },
            guild: { id: 'guild-1', members: { me: {} }, channels: { fetch: async () => storyChannel } },
        },
        {
            db: {
                getUser: async () => ({ save: async () => {} }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => ({ applied: 0, newTotal: 0 }),
                getSystemConfig: async () => ({ managerRoleId: 'manager-1', storyChannel: 'story-1' }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
        },
    );
    assert.equal(storyOk.calls.deferReply.ephemeral, true);
    assert.match(storyOk.calls.editReply.content, /Story exported and reset/i);

    const invalidAdjust = await dispatchCommand(
        'adjustpoints',
        {
            user: { id: 'target-1', bot: true },
            points: 10,
            reason: 'valid reason',
            member: { permissions: { has: () => true }, roles: { cache: { has: () => false } } },
        },
        {
            db: {
                getUser: async () => ({ save: async () => {} }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => ({ applied: 0, newTotal: 0 }),
                getSystemConfig: async () => ({ managerRoleId: 'manager-1' }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
        },
    );
    assert.match(invalidAdjust.calls.reply.content, /real users/i);

    const dms = [];
    const adjustOk = await dispatchCommand(
        'adjustpoints',
        {
            user: { id: 'target-2', bot: false, send: async (msg) => dms.push(msg) },
            points: 25,
            reason: 'manual correction',
            member: { permissions: { has: () => true }, roles: { cache: { has: () => false } } },
            guild: { id: 'guild-1', name: 'Guild One', members: { fetch: async () => ({ roles: { add: async () => {} } }) } },
        },
        {
            db: {
                getUser: async () => ({ points: 100, faction: null, save: async () => {} }),
                updateUser: async () => {},
                addScore: async () => {},
                addManualPointAdjustment: async () => ({ applied: 25, newTotal: 125 }),
                getSystemConfig: async () => ({ managerRoleId: 'manager-1' }),
                updateSystemConfig: async (_guildId, updater) => {
                    const cfg = {};
                    updater(cfg);
                    return cfg;
                },
                refreshLeaderboard: async () => {},
                resolveLeaderboardSort: () => 'points',
                leaderboardCache: new Map(),
                createActiveGame: async () => {},
                updateActiveGame: async () => {},
                endActiveGame: async () => {},
            },
            factionChallenge: {
                computeScores: () => [],
                pickChallengeWinner: () => null,
                expireStaleChallenges: async () => {},
                getActiveChallenge: async () => null,
                isRoyale: () => false,
                getParticipantIds: () => [],
                isRosterFullForFaction: () => false,
                teamRawPointSum: () => 0,
                getScoreByUser: () => 0,
                getRawScoreByUser: () => 0,
                buildRankedRulesSnapshot: () => ({}),
                isChallengeRanked: () => false,
                ROYALE_FACTIONS: [...MOCK_ROYALE_FACTIONS],
                FACTION_SWITCH_COOLDOWN_MS: 0,
                reconcileFactionTotalsForLeavingMember: async () => {},
                removeUserFromFactionChallengeEnrollment: async () => {},
                grantFactionVictoryRoleIfConfigured: async () => {},
                isUserEnrolledInActiveFactionChallenge: async () => false,
                formatChallengeGameFilterLabel: () => 'all',
                applyEndedChallengeToGlobalTotals: async () => {},
            },
        },
    );
    assert.match(adjustOk.calls.reply.content, /Adjusted \*\*Credits\*\*.*125/i);
    assert.equal(dms.length, 1);
});

test('redirect commands validate inputs and manage configured redirects', async () => {
    let config = { managerRoleId: 'manager-1', redirects: new Map() };
    const overrides = {
        db: {
            getUser: async () => ({ isPremium: true, save: async () => {} }),
            updateUser: async () => {},
            addScore: async () => {},
            addManualPointAdjustment: async () => ({ applied: 0, newTotal: 0 }),
            getSystemConfig: async () => config,
            updateSystemConfig: async (_guildId, updater) => {
                const next = { ...config, redirects: new Map(config.redirects) };
                updater(next);
                config = next;
                return next;
            },
            refreshLeaderboard: async () => {},
            resolveLeaderboardSort: () => 'points',
            leaderboardCache: new Map(),
            createActiveGame: async () => {},
            updateActiveGame: async () => {},
            endActiveGame: async () => {},
        },
    };
    const member = { permissions: { has: () => true }, roles: { cache: { has: () => false } } };

    const invalid = await dispatchCommand(
        'add_redirect',
        { words: 'foo, bar', member },
        overrides,
    );
    assert.match(invalid.calls.reply.content, /must provide either a \*\*channel\*\* or a \*\*link\*\*/i);

    const added = await dispatchCommand(
        'add_redirect',
        {
            words: 'foo, bar',
            channel: { id: 'chan-target', type: 0, archived: false, isThread: () => false },
            link: 'https://example.com',
            message: 'go here',
            member,
        },
        overrides,
    );
    assert.match(added.calls.reply.content, /Added redirect/i);
    assert.equal(config.redirects.has('bar,foo'), true);

    const removed = await dispatchCommand(
        'remove_redirect',
        { words: 'foo, bar', member },
        overrides,
    );
    assert.match(removed.calls.reply.content, /Removed redirect/i);
    assert.equal(config.redirects.has('bar,foo'), false);
});

test('ticket command creates a support thread and ticket_close archives it', async () => {
    process.env.SUPPORT_SERVER_ID = 'support-guild';
    process.env.SUPPORT_TICKET_CHANNEL_ID = 'tickets-main';
    process.env.SUPPORT_REPORT_CHANNEL_ID = 'tickets-bugs';
    process.env.SUPPORT_SERVER_INVITE = 'https://discord.gg/playbound-support';

    const sentPayloads = [];
    const thread = {
        id: 'thread-42',
        send: async (payload) => {
            sentPayloads.push(payload);
        },
        members: {
            add: async () => {},
        },
    };
    const ticketChan = {
        threads: {
            create: async (payload) => {
                assert.equal(payload.type, 12);
                return thread;
            },
        },
    };
    const supportGuild = {
        channels: {
            fetch: async (id) => {
                assert.equal(id, 'tickets-bugs');
                return ticketChan;
            },
        },
        members: {
            fetch: async () => ({ id: 'user-1' }),
        },
    };

    const { interaction } = await dispatchCommandWithContext(
        'ticket',
        {
            type: 'Bug',
            reason: 'The button explodes.',
            actorUser: { id: 'user-1', username: 'Tester', tag: 'Tester#0001' },
            guild: { id: 'guild-1', name: 'Guild One', members: { fetch: async () => ({}) } },
        },
        {
            client: {
                guilds: {
                    cache: new Map(),
                    fetch: async (id) => {
                        assert.equal(id, 'support-guild');
                        return supportGuild;
                    },
                },
            },
        },
    );

    assert.match(interaction.calls.reply.content, /Bug submitted/i);
    assert.match(interaction.calls.reply.content, /thread-42/);
    assert.equal(sentPayloads.length, 1);
    assert.match(sentPayloads[0].content, /New Bug from <@user-1>/);
    assert.equal(sentPayloads[0].components.length, 1);

    const closed = [];
    const { interaction: closeInteraction } = await dispatchInteractionWithContext({
        kind: 'button',
        customId: 'ticket_close',
        channel: {
            id: 'thread-42',
            isThread: () => true,
            setLocked: async (value) => closed.push(['locked', value]),
            setArchived: async (value) => closed.push(['archived', value]),
        },
    });

    assert.match(closeInteraction.calls.reply.content, /Closing ticket/i);
    assert.deepEqual(closed, [
        ['locked', true],
        ['archived', true],
    ]);
});

test('shop_buy_select buys configured items and handles role misconfiguration', async () => {
    const savedUsers = [];
    const overrides = {
        db: {
            getUser: async () => {
                const user = {
                    points: 150,
                    inventory: [],
                    isPremium: false,
                    save: async () => {
                        savedUsers.push({ points: user.points, inventory: [...user.inventory] });
                    },
                };
                return user;
            },
            updateUser: async () => {},
            addScore: async () => {},
            addManualPointAdjustment: async () => ({ applied: 0, newTotal: 0 }),
            getSystemConfig: async () => ({
                shopItems: [
                    { id: 'badge_star', name: 'Star Badge', price: 40, type: 'badge', premiumOnly: false },
                    { id: 'vip_role', name: 'VIP', price: 60, type: 'role', premiumOnly: false, roleId: null },
                ],
            }),
            updateSystemConfig: async (_guildId, updater) => {
                const cfg = {};
                updater(cfg);
                return cfg;
            },
            refreshLeaderboard: async () => {},
            resolveLeaderboardSort: () => 'points',
            leaderboardCache: new Map(),
            createActiveGame: async () => {},
            updateActiveGame: async () => {},
            endActiveGame: async () => {},
        },
        models: {
            User: {
                findOne: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    isBlacklisted: false,
                    isPremium: false,
                    premiumSource: null,
                    agreedTermsVersion: '2026-04',
                    agreedPrivacyVersion: '2026-04',
                    save: async () => {},
                }),
                create: async () => ({}),
            },
            ReferralProfile: {},
            SystemConfig: {},
            Game: { find: async () => [] },
            Word: {},
            Phrase: {},
            MovieQuote: {},
            Achievement: {},
            ShopItem: { find: async () => [], findOne: async () => null },
            RecurringGame: {},
            Faction: {},
            FactionChallenge: {},
            LeaderboardPeriodSnapshot: {},
            ReferralFirstGamePayout: {},
        },
    };

    const bought = await dispatchInteractionWithContext(
        {
            kind: 'select',
            customId: 'shop_buy_select_0',
            values: ['badge_star'],
        },
        overrides,
    );
    assert.deepEqual(bought.interaction.calls.deferReply.flags, [64]);
    assert.match(bought.interaction.calls.editReply.content, /Successfully bought \*\*Star Badge\*\*/i);
    assert.deepEqual(savedUsers[0], { points: 110, inventory: ['badge_star'] });

    const dupSelect = await dispatchInteractionWithContext(
        {
            kind: 'select',
            customId: 'shop_buy_select_0',
            values: ['badge_star'],
        },
        {
            ...overrides,
            db: {
                ...overrides.db,
                getUser: async () => {
                    const user = {
                        points: 150,
                        inventory: ['badge_star'],
                        isPremium: false,
                        save: async () => {
                            savedUsers.push({ dup: true, inventory: [...user.inventory] });
                        },
                    };
                    return user;
                },
            },
        },
    );
    assert.match(dupSelect.interaction.calls.editReply.content, /already own/i);

    const roleAttempt = await dispatchInteractionWithContext(
        {
            kind: 'select',
            customId: 'shop_buy_select_0',
            values: ['vip_role'],
            guild: { id: 'guild-1', members: { fetch: async () => ({ roles: { add: async () => {} } }) } },
        },
        overrides,
    );
    assert.match(roleAttempt.interaction.calls.editReply.content, /misconfigured/i);
});

test('endgame_select handles scheduled cancellations and active giveaway choices', async () => {
    const scheduledGames = new Map([
        [
            'sched-1',
            {
                guildId: 'guild-1',
                type: 'Trivia',
                timeoutHandle: 'timeout-1',
            },
        ],
    ]);
    const cleared = [];
    const originalClearTimeout = global.clearTimeout;
    global.clearTimeout = (handle) => {
        cleared.push(handle);
    };

    try {
        const scheduled = await dispatchInteractionWithContext(
            {
                kind: 'select',
                customId: 'endgame_select',
                values: ['id_sched_sched-1'],
            },
            {
                models: {
                    User: {
                        findOne: async () => ({
                            guildId: 'guild-1',
                            userId: 'user-1',
                            isBlacklisted: false,
                            isPremium: false,
                            premiumSource: null,
                            agreedTermsVersion: '2026-04',
                            agreedPrivacyVersion: '2026-04',
                            save: async () => {},
                        }),
                        create: async () => ({}),
                    },
                    ReferralProfile: {},
                    SystemConfig: {},
                    Game: {
                        find: async () => [],
                        findOneAndUpdate: async (query, update) => {
                            assert.deepEqual(query, { 'state.sid': 'sched-1' });
                            assert.deepEqual(update, { status: 'ended' });
                        },
                    },
                    Word: {},
                    Phrase: {},
                    MovieQuote: {},
                    Achievement: {},
                    ShopItem: { find: async () => [], findOne: async () => null },
                    RecurringGame: { findByIdAndDelete: async () => {} },
                    Faction: {},
                    FactionChallenge: {},
                    LeaderboardPeriodSnapshot: {},
                    ReferralFirstGamePayout: {},
                },
            },
            { state: { scheduledGames } },
        );

        assert.deepEqual(scheduled.interaction.calls.deferReply.flags, [64]);
        assert.match(scheduled.interaction.calls.editReply.content, /Cancelled scheduled \*\*Trivia\*\*/i);
        assert.deepEqual(cleared, ['timeout-1']);
        assert.equal(scheduled.deps.state.scheduledGames.has('sched-1'), false);

        const giveaway = {
            timeoutHandle: 'timeout-2',
            threadId: 'thread-giveaway',
        };
        const active = await dispatchInteractionWithContext(
            {
                kind: 'select',
                customId: 'endgame_select',
                values: ['id_active_give-1'],
            },
            {},
            { state: { activeGiveaways: new Map([['give-1', giveaway]]) } },
        );

        assert.match(active.interaction.calls.editReply.content, /How would you like to end this giveaway/i);
        assert.equal(active.interaction.calls.editReply.components.length, 1);
        const buttonIds = active.interaction.calls.editReply.components[0].components.map((button) => button.data.custom_id);
        assert.deepEqual(buttonIds, ['cancel_giv_winner_give-1', 'cancel_giv_void_give-1']);
    } finally {
        global.clearTimeout = originalClearTimeout;
    }
});

test('cancel giveaway buttons choose winner or void the giveaway', async () => {
    const cleared = [];
    const originalClearTimeout = global.clearTimeout;
    global.clearTimeout = (handle) => {
        cleared.push(handle);
    };

    try {
        const winnerCalls = [];
        const winner = await dispatchInteractionWithContext(
            {
                kind: 'button',
                customId: 'cancel_giv_winner_give-1',
            },
            {},
            {
                state: {
                    activeGiveaways: new Map([
                        [
                            'give-1',
                            {
                                timeoutHandle: 'timeout-win',
                                threadId: 'thread-1',
                            },
                        ],
                    ]),
                },
                triggers: {
                    endGiveaway: async (id) => {
                        winnerCalls.push(id);
                    },
                },
            },
        );

        assert.match(winner.interaction.calls.reply.content, /Picking winner now/i);
        assert.deepEqual(winnerCalls, ['give-1']);

        const threadMessages = [];
        const archived = [];
        const locked = [];
        const giveawayVoidThread = {
            id: 'thread-2',
            send: async (payload) => threadMessages.push(payload),
            messages: {
                fetch: async () => new Map(),
            },
            setLocked: async (value) => locked.push(value),
            setArchived: async (value) => archived.push(value),
            isThread: () => true,
            deletable: true,
            delete: async () => {},
        };
        const giveawayVoidClient = {
            channels: {
                cache: new Map([['thread-2', giveawayVoidThread]]),
                fetch: async (id) => giveawayVoidClient.channels.cache.get(id) || null,
            },
        };
        giveawayVoidThread.client = giveawayVoidClient;
        const voided = await dispatchInteractionWithContext(
            {
                kind: 'button',
                customId: 'cancel_giv_void_give-2',
            },
            {
                client: giveawayVoidClient,
                db: {
                    getUser: async () => ({
                        guildId: 'guild-1',
                        userId: 'user-1',
                        points: 100,
                        save: async () => {},
                    }),
                    updateUser: async () => {},
                    addScore: async () => {},
                    addManualPointAdjustment: async () => ({ applied: 0, newTotal: 0 }),
                    getSystemConfig: async () => ({ shopItems: [], roleRewards: new Map() }),
                    updateSystemConfig: async (_guildId, updater) => {
                        const cfg = {};
                        updater(cfg);
                        return cfg;
                    },
                    refreshLeaderboard: async () => {},
                    resolveLeaderboardSort: () => 'points',
                    leaderboardCache: new Map(),
                    createActiveGame: async () => {},
                    updateActiveGame: async () => {},
                    endActiveGame: async (id) => {
                        winnerCalls.push(`end:${id}`);
                    },
                },
                utils: {
                    decodeHTMLEntities: (v) => v,
                    scramblePhrase: (v) => v,
                    parsePointValues: () => ({ first: 5, second: 3, third: 1 }),
                    MAX_POINTS_PER_PLACEMENT: 100,
                    isFuzzyMatch: () => false,
                    normalizeText: (v) => v,
                    disableComponentsInThread: async (thread) => {
                        threadMessages.push({ disabled: true, thread });
                    },
                    defaultGameThreadName: (name) => `${name} Thread`,
                },
            },
            {
                state: {
                    activeGiveaways: new Map([
                        [
                            'give-2',
                            {
                                timeoutHandle: 'timeout-void',
                                threadId: 'thread-2',
                            },
                        ],
                    ]),
                },
            },
        );

        assert.match(voided.interaction.calls.reply.content, /cancelled entirely/i);
        assert.ok(winnerCalls.includes('end:give-2'));
        assert.equal(threadMessages[0], '⚠️ This giveaway has been cancelled by an administrator.');
        assert.equal(threadMessages.length, 1);
        assert.deepEqual(locked, [true]);
        assert.deepEqual(archived, [true]);
    } finally {
        global.clearTimeout = originalClearTimeout;
    }
});

test('unscramble start and hint button drive the ephemeral game state', async () => {
    const activeUnscrambles = new Map([
        [
            'thread-1',
            {
                totalRounds: 2,
                phrases: [
                    { scrambled: 'BNUDOYPLA', clue: 'Brand name', phrase: 'PLAYBOUND' },
                    { scrambled: 'EMAG', clue: 'Thing you play', phrase: 'GAME' },
                ],
                players: {},
            },
        ],
    ]);

    const started = await dispatchInteractionWithContext(
        {
            kind: 'button',
            customId: 'unscramble_start',
            channel: { id: 'thread-1', isThread: () => true },
        },
        {},
        { state: { activeUnscrambles } },
    );

    assert.match(started.interaction.calls.reply.content, /Phrase 1\/2/i);
    assert.equal(started.interaction.calls.reply.components[0].components.length, 3);

    const hinted = await dispatchInteractionWithContext(
        {
            kind: 'button',
            customId: 'unscramble_hint_btn',
            channel: { id: 'thread-1', isThread: () => true },
        },
        {},
        { state: { activeUnscrambles } },
    );

    assert.match(hinted.interaction.calls.update.content, /Hint:/i);
    assert.equal(activeUnscrambles.get('thread-1').players['user-1'].currentHint, true);
});

test('sprint start, skip, and answer buttons advance Trivia Sprint state', async () => {
    const playerSaves = [];
    const activeSprints = new Map([
        [
            'thread-9',
            {
                threadId: 'thread-9',
                targetScore: 2,
                questions: [
                    { question: 'Q1?', answers: ['A', 'B'], correct: 'A' },
                    { question: 'Q2?', answers: ['C', 'D'], correct: 'D' },
                ],
                players: {},
            },
        ],
    ]);
    const updatedStates = [];
    const userWithSkip = {
        inventory: ['trivia_skip'],
        save: async () => {
            playerSaves.push([...userWithSkip.inventory]);
        },
    };
    const overrides = {
        db: {
            getUser: async () => userWithSkip,
            updateUser: async () => {},
            addScore: async () => {},
            addManualPointAdjustment: async () => ({ applied: 0, newTotal: 0 }),
            getSystemConfig: async () => ({ shopItems: [], roleRewards: new Map() }),
            updateSystemConfig: async (_guildId, updater) => {
                const cfg = {};
                updater(cfg);
                return cfg;
            },
            refreshLeaderboard: async () => {},
            resolveLeaderboardSort: () => 'points',
            leaderboardCache: new Map(),
            createActiveGame: async () => {},
            updateActiveGame: async (_id, updater) => {
                const state = {};
                updater(state);
                updatedStates.push(state);
            },
            endActiveGame: async () => {},
        },
    };

    const started = await dispatchInteractionWithContext(
        {
            kind: 'button',
            customId: 'sprint_start',
            channel: { id: 'thread-9', isThread: () => true },
        },
        overrides,
        { state: { activeSprints } },
    );
    assert.deepEqual(started.interaction.calls.deferReply.flags, [64]);
    assert.match(started.interaction.calls.editReply.content, /\*\*Q1\*\*/);

    const skipped = await dispatchInteractionWithContext(
        {
            kind: 'button',
            customId: 'sprint_skip',
            channel: { id: 'thread-9', isThread: () => true },
        },
        overrides,
        { state: { activeSprints } },
    );
    assert.equal(skipped.interaction.calls.deferUpdate, true);
    assert.match(skipped.interaction.calls.editReply.content, /Skipped!/i);
    assert.deepEqual(playerSaves, [[]]);

    const answerUser = {
        inventory: [],
        save: async () => {},
    };
    const answered = await dispatchInteractionWithContext(
        {
            kind: 'button',
            customId: 'sprintans_1',
            channel: { id: 'thread-9', isThread: () => true },
        },
        {
            ...overrides,
            db: {
                ...overrides.db,
                getUser: async () => answerUser,
            },
        },
        { state: { activeSprints } },
    );
    assert.equal(answered.interaction.calls.deferUpdate, true);
    assert.match(answered.interaction.calls.editReply.content, /PERFECT SCORE|FINISHED!/i);
    assert.equal(activeSprints.get('thread-9').players['user-1'].score, 1);
    assert.equal(activeSprints.get('thread-9').players['user-1'].timeTaken != null, true);
});

test('developer/admin commands enforce access and perform their actions', async () => {
    process.env.DEVELOPER_ID = 'dev-1';
    const premiumConversions = [];
    const broadcastMessages = [];
    let premiumState = { isPremium: true, premiumSource: 'stripe' };

    const overrides = {
        mongoRouter: {
            runWithGuild: async (_gid, fn) => fn(),
            updateUserByDiscordIdEverywhere: async (_userId, update) => {
                premiumState = { ...premiumState, ...update };
                return 2;
            },
            forEachUserDocumentByDiscordId: async (_userId, fn) => {
                const users = [
                    {
                        currentCosmetics: new Map([
                            ['badge', 'premium_badge_diamond'],
                            ['color', 'premium_color_crystal'],
                        ]),
                        markModified: () => {},
                        save: async () => {},
                    },
                ];
                for (const u of users) {
                    await fn(u);
                }
            },
        },
        client: {
            guilds: {
                cache: new Map([
                    ['guild-a', { id: 'guild-a' }],
                    ['guild-b', { id: 'guild-b' }],
                ]),
                fetch: async () => null,
            },
            channels: {
                cache: new Map(),
                fetch: async (id) => ({
                    send: async (payload) => {
                        broadcastMessages.push([id, payload]);
                    },
                }),
            },
        },
        premiumAnalyticsCommand: {
            executePremiumAnalytics: async (interaction) => {
                await interaction.reply({ content: 'analytics-ok', ephemeral: true });
            },
        },
        premiumAnalytics: {
            trackPremiumPromptShown: async () => {},
            trackPremiumConversion: async (payload) => {
                premiumConversions.push(payload);
            },
        },
        models: {
            User: {
                findOne: async () => ({
                    guildId: 'guild-1',
                    userId: 'user-1',
                    isBlacklisted: false,
                    isPremium: false,
                    premiumSource: null,
                    agreedTermsVersion: '2026-04',
                    agreedPrivacyVersion: '2026-04',
                    save: async () => {},
                }),
                create: async () => ({}),
                updateMany: async (_query, update) => {
                    premiumState = { ...premiumState, ...update };
                    return { modifiedCount: 2 };
                },
                find: async () => [
                    {
                        currentCosmetics: new Map([
                            ['badge', 'premium_badge_diamond'],
                            ['color', 'premium_color_crystal'],
                        ]),
                        markModified: () => {},
                        save: async () => {},
                    },
                ],
            },
            ReferralProfile: {},
            SystemConfig: {},
            Game: { find: async () => [] },
            Word: {},
            Phrase: {},
            MovieQuote: {},
            Achievement: {},
            ShopItem: { find: async () => [], findOne: async () => null },
            RecurringGame: {},
            Faction: {},
            FactionChallenge: {},
            LeaderboardPeriodSnapshot: {},
            ReferralFirstGamePayout: {},
        },
        db: {
            getUser: async (_guildId, userId) => ({
                userId,
                points: 10,
                weeklyPoints: 0,
                monthlyPoints: 0,
                save: async function () {},
            }),
            updateUser: async () => {},
            addScore: async () => {},
            addManualPointAdjustment: async () => ({ applied: 0, newTotal: 0 }),
            getSystemConfig: async (guildId) => ({ announceChannel: `${guildId}-ann`, shopItems: [], roleRewards: new Map() }),
            updateSystemConfig: async (_guildId, updater) => {
                const cfg = {};
                updater(cfg);
                return cfg;
            },
            refreshLeaderboard: async () => {},
            resolveLeaderboardSort: () => 'points',
            leaderboardCache: new Map(),
            createActiveGame: async () => {},
            updateActiveGame: async () => {},
            endActiveGame: async () => {},
        },
    };

    const announceEveryone = await dispatchCommand(
        'set_announce_everyone',
        {
            enabled: true,
            member: { permissions: { has: () => true }, roles: { cache: new Map() } },
        },
        overrides,
    );
    assert.match(announceEveryone.calls.reply.content, /@everyone.*on/i);

    const blockedBroadcast = await dispatchCommand('broadcast', { message: 'Hi' }, overrides);
    assert.match(blockedBroadcast.calls.reply.content, /restricted to the bot developer/i);

    const devBroadcast = await dispatchCommand(
        'broadcast',
        {
            message: 'Launch update',
            actorUser: { id: 'dev-1', username: 'Dev' },
        },
        overrides,
    );
    assert.match(devBroadcast.calls.editReply.content, /Broadcast sent to \*\*2\*\* servers/i);
    assert.equal(broadcastMessages.length, 2);

    const analytics = await dispatchCommand(
        'premium_analytics',
        {
            actorUser: { id: 'dev-1', username: 'Dev' },
        },
        overrides,
    );
    assert.equal(analytics.calls.reply.content, 'analytics-ok');

    const grantPremium = await dispatchCommand(
        'admin_premium',
        {
            action: 'grant',
            source: 'manual',
            user: { id: 'target-1' },
            actorUser: { id: 'dev-1', username: 'Dev' },
        },
        overrides,
    );
    assert.match(grantPremium.calls.reply.content, /Granted Premium/i);
    assert.deepEqual(premiumConversions, [{ userId: 'target-1', source: 'admin' }]);

    const revokePremium = await dispatchCommand(
        'admin_premium',
        {
            action: 'revoke',
            user: { id: 'target-1' },
            actorUser: { id: 'dev-1', username: 'Dev' },
        },
        overrides,
    );
    assert.match(revokePremium.calls.reply.content, /Revoked Premium/i);
    assert.equal(premiumState.isPremium, false);

    const devAdd = await dispatchCommand(
        'dev_points',
        {
            subcommand: 'add',
            amount: 25,
            user: { id: 'target-2' },
            actorUser: { id: 'dev-1', username: 'Dev' },
        },
        overrides,
    );
    assert.match(devAdd.calls.reply.content, /Added \*\*25/i);

    const devSet = await dispatchCommand(
        'dev_points',
        {
            subcommand: 'set',
            amount: 99,
            user: { id: 'target-3' },
            actorUser: { id: 'dev-1', username: 'Dev' },
        },
        overrides,
    );
    assert.match(devSet.calls.reply.content, /Set <@target-3> to \*\*99/i);

    const adminBlacklist = await dispatchCommand(
        'blacklist',
        {
            user: { id: 'target-4' },
            reason: 'testing',
            member: { permissions: { has: () => true }, roles: { cache: new Map() } },
        },
        overrides,
    );
    assert.match(adminBlacklist.calls.reply.content, /has been blacklisted/i);

    const adminUnblacklist = await dispatchCommand(
        'unblacklist',
        {
            user: { id: 'target-4' },
            member: { permissions: { has: () => true }, roles: { cache: new Map() } },
        },
        overrides,
    );
    assert.match(adminUnblacklist.calls.reply.content, /has been unblacklisted/i);
});
