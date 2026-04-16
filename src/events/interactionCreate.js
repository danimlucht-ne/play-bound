'use strict';

const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    MessageFlags,
    StringSelectMenuBuilder,
    PermissionFlagsBits,
} = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    entersState,
    VoiceConnectionStatus,
} = require('@discordjs/voice');
const axios = require('axios');

const {
    User,
    ReferralProfile,
    SystemConfig,
    Game,
    Word,
    Phrase,
    MovieQuote,
    Achievement,
    ShopItem,
    RecurringGame,
    Faction,
    FactionChallenge,
    GamePlatformDay,
    MissionProgress,
    EngagementProfile,
    DuelProfile,
    LeaderboardPeriodSnapshot,
    ReferralFirstGamePayout,
} = require('../../models');
const { filterOwnedShopItems, isDuplicateShopPurchase } = require('../../lib/shopOwnership');

const {
    computeScores,
    pickChallengeWinner,
    expireStaleChallenges,
    getActiveChallenge,
    getWarPhase,
    isRoyale,
    getParticipantIds,
    isRosterFullForFaction,
    teamRawPointSum,
    getScoreByUser,
    getRawScoreByUser,
    buildRankedRulesSnapshot,
    isChallengeRanked,
    ROYALE_FACTIONS,
    FACTION_SWITCH_COOLDOWN_MS,
    FACTION_JOIN_AFTER_LEAVE_COOLDOWN_MS,
    reconcileFactionTotalsForLeavingMember,
    removeUserFromFactionChallengeEnrollment,
    grantFactionVictoryRoleIfConfigured,
    isUserEnrolledInActiveFactionChallenge,
    formatChallengeGameFilterLabel,
    applyEndedChallengeToGlobalTotals,
} = require('../../lib/factionChallenge');
const { grantWarEndPersonalCredits } = require('../../lib/factionWarEconomyPayout');
const {
    validateChallengeCreateParams,
    rankedDefaultRosterCapFromConfig,
    rankedContributionCapsFromConfig,
    RANKED_FIXED_SCORING_MODE,
    RANKED_FIXED_TOP_N,
    RANKED_SCORING_DISPLAY_LABEL,
    RANKED_SLASH_CREATE_WAR_VERSION,
    parseContributionCapsCsv,
} = require('../../lib/rankedFactionWar');
const {
    isGuildExcludedFromGlobalCounts,
    guildIdNotExcludedMatch,
    getExcludedGuildIds,
} = require('../../lib/publicStatsExclude');
const {
    getGlobalFactionStandingsFromUsers,
    getGlobalFactionTotalsForName,
    getTopGuildsForFactionChallengePoints,
} = require('../../lib/globalFactionAggregates');
const {
    formatPremiumGlobalBoardGap,
    formatPremiumWarRosterInsight,
    formatPremiumSeasonFactionPlacement,
    formatPremiumServerArenaRank,
} = require('../../lib/factionPremiumInsights');

const {
    getUser,
    updateUser,
    transferCreditsAtomic,
    claimDailyAtomic,
    addScore,
    addManualPointAdjustment,
    getSystemConfig,
    updateSystemConfig,
    refreshLeaderboard,
    resolveLeaderboardSort,
    leaderboardCache,
    createActiveGame,
    updateActiveGame,
    endActiveGame,
} = require('../../lib/db');
const { recordFactionJoined } = require('../../lib/onboardingService');

const {
    sendGlobalAnnouncement,
    announceScheduledGame,
    announceWinner,
    announceFactionChallengeToGuild,
    shouldPingEveryone,
} = require('../../lib/announcements');
const { automatedServerPostsEnabled } = require('../../lib/automatedPosts');
const { ACHIEVEMENTS, CUSTOM_ACHIEVEMENT_KEY, normalizeAchievementEmoji, resolveAchievementMeta, formatAchievementLabel, awardAchievement, revokeAchievement } = require('../../lib/achievements');
const {
    decodeHTMLEntities,
    scramblePhrase,
    parsePointValues,
    MAX_POINTS_PER_PLACEMENT,
    isFuzzyMatch,
    normalizeText,
    defaultGameThreadName,
} = require('../../lib/utils');
const { fetchOpenTdbMultipleChoice } = require('../../lib/openTriviaFetch');
const {
    createHostedGamePrivateThread,
    createHostedGamePublicThread,
    getSlashScheduleDelayMs,
    finalizeHostedGameThread,
} = require('../../lib/gameThreadLifecycle');
const { clampHostGameInt } = require('../../lib/premiumPerks');
const { CREDITS, ARENA_SCORE, creditsVsArenaBlurb } = require('../../lib/pointBranding');
const {
    DEFAULT_PLACEMENT_POINTS,
    DEFAULT_SINGLE_WINNER_POINTS,
    DEFAULT_GIVEAWAY_PLACEMENT,
} = require('../../lib/gamePointsDefaults');
const { registerAuraBoostTarget, runAuraBoost } = require('../../lib/auraBoostRegistry');
const { auraBoostRow } = require('../../lib/gameAuraButton');
const { pickDuelChallengeFlair, pickDuelFightLine } = require('../../lib/duelFlair');
const { makeGameFlairEmbed } = require('../../lib/gameFlair');
const { isBotDeveloper } = require('../../lib/isBotDeveloper');
const { canManageFactionChallenges } = require('../../lib/guildFactionPermissions');
const { playboundDebugLog } = require('../../lib/playboundDebug');
const { postSupportPanels } = require('../../lib/supportPanels');
const { syncFactionMemberRoles, getFactionDisplayName, getFactionDisplayEmoji, formatFactionDualLabel } = require('../../lib/factionGuild');
const { executeFactionRoleLink } = require('../../lib/faction_role_link');
const { executeFactionRename } = require('../../lib/faction_rename');
const { executeFactionEmoji } = require('../../lib/faction_emoji');
const { formatFactionWarMatchupLine } = require('../../lib/factionWarAnnounce');
const { getFactionChallengeStaffOverlapSuffix } = require('../../lib/factionChallengeHostWarning');
const {
    resolveFactionChallengeCreateOptions,
    resolveGameTypesArrayForChallenge,
    assertValidGameType,
    assertValidScoringMode,
    BUILTIN_DEFAULT_GAME,
    BUILTIN_DEFAULT_SCORING,
    BUILTIN_DEFAULT_TOPN,
} = require('../../lib/factionChallengeDefaults');
const { getSettings } = require('../../lib/gamePlatform/configStore');
const { validateRankedChallengeGameSelection, tagCreditsOfficialRankedWar } = require('../../lib/gameClassification');
const { GAME_REGISTRY } = require('../../lib/gamePlatform/registry');
const { utcDayString, ensureRotationForDate } = require('../../lib/gamePlatform/rotation');
const { getPhaseBounds } = require('../../lib/engagement/warScoring');
const {
    onDuelMissionHook,
    claimCompletedMissions,
    listMissionBoard,
    listMissionDefinitionsLean,
} = require('../../lib/engagement/missions');
const { recordDuelOutcome } = require('../../lib/engagement/duelRating');
const {
    countFactionChallengesOfTypeToday,
    countFactionChallengesToday,
} = require('../../lib/factionChallengeDailyLimits');
const { playgameAutocompleteChoices } = require('../../lib/playgameAutocomplete');
const { GLOBAL_FACTION_KEYS } = require('../../lib/globalFactions');
const { duelPairForDailySlot } = require('../../lib/factionDuelRotation');
const { executeFactionBalance } = require('../../lib/faction_balance');
const {
    shouldShowPremiumPrompt,
    markPremiumPromptShown,
    tryHostPremiumNudge,
    sendPremiumBoostSessionHint,
} = require('../../lib/premiumUpsell');
const { trackPremiumPromptShown, trackPremiumConversion } = require('../../lib/premiumAnalytics');
const { executePremiumAnalytics } = require('../../lib/premium_analytics');
const {
    handleInviteCommand,
    handleInvitesCommand,
    handleClaimReferralCommand,
    handleFactionRecruitCommand,
    handleFactionRedeemCommand,
    handleInviteLeaderboardCommand,
} = require('../../lib/referrals');

/** Profile embed glyphs from code points (avoids mojibake if the file is saved in a legacy encoding). */
const PROFILE_GLYPH = {
    diamond: String.fromCodePoint(0x1f48e),
    person: String.fromCodePoint(0x1f464),
    swords: String.fromCodePoint(0x2694, 0xfe0f),
    coin: String.fromCodePoint(0x1fa99),
    fire: String.fromCodePoint(0x1f525),
    cake: String.fromCodePoint(0x1f382),
    chart: String.fromCodePoint(0x1f4ca),
    trophy: String.fromCodePoint(0x1f3c6),
    megaphone: String.fromCodePoint(0x1f4e3),
    scroll: String.fromCodePoint(0x1f4dc),
    star: String.fromCodePoint(0x2b50),
    dot: '\u00b7',
    mdash: '\u2014',
};

const { joinOfficialFactionInGuild, resolveFactionDocForJoin } = require('../../lib/officialFactionJoin');
const onboardingDiscord = require('../../lib/onboardingDiscord');

const triviaGame = require('../../games/trivia');
const serverdleGame = require('../../games/serverdle');
const guessthenumberGame = require('../../games/guessthenumber');
const platformPlay = require('../../games/platformPlay');
const spellingBeeGame = require('../../games/spellingbee');
const tournamentGame = require('../../games/tournament');
const { buildUnscramblePhrasesForGame } = require('../../games/unscramble');
const { handleSupportServerAdminCommands } = require('../../lib/supportServerAdminCommands');

const SHOP_OPTIONS_PER_MENU = 25;
/** Discord allows 5 component rows; we use 5 select menus when the catalog fits in one “screen” (≤125). */
const SHOP_MAX_ROWS_ALL_SELECTS = 5;
const SHOP_MAX_OPTIONS_SINGLE_VIEW = SHOP_OPTIONS_PER_MENU * SHOP_MAX_ROWS_ALL_SELECTS;
/** Beyond 125 items we paginate: 4 select rows + 1 row for ◀ ▶ (100 items per page). */
const SHOP_PAGE_SELECT_ROWS = 4;
const SHOP_PAGE_SIZE = SHOP_OPTIONS_PER_MENU * SHOP_PAGE_SELECT_ROWS;

/** US storefront + English metadata (iTunes Search API). */
const ITUNES_SEARCH_PARAMS = 'entity=song&media=music&country=us&lang=en_us';

function itunesSearchUrl(term, limit) {
    return `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&limit=${limit}&${ITUNES_SEARCH_PARAMS}`;
}
/** `primaryGenreName` values that usually mean Spanish/Latin/PT vocals (not perfect, but cuts most Spanish previews). */
const ITUNES_SPANISH_FORWARD_GENRE =
    /latin|reggaeton|regional mex|regional mexican|flamenco|salsa|bachata|merengue|cumbia|corrido|spanish|brazilian|portuguese|bossa nova|vallenato|mariachi|norteñ|conjunto|urbano latino/i;

function itunesTracksWithEnglishPreviews(results) {
    return results.filter((t) => {
        if (!t.previewUrl) return false;
        return !ITUNES_SPANISH_FORWARD_GENRE.test(t.primaryGenreName || '');
    });
}

function dedupeItunesByTrackId(tracks) {
    const seen = new Set();
    return tracks.filter((t) => {
        const id = t.trackId;
        if (id == null) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

function trimAutocomplete(items, focused) {
    const q = String(focused || '').toLowerCase().trim();
    const out = [];
    for (const item of items) {
        if (!item) continue;
        const text = String(item);
        if (q && !text.toLowerCase().includes(q)) continue;
        out.push({ name: text.slice(0, 100), value: text.slice(0, 100) });
        if (out.length >= 25) break;
    }
    return out;
}

/**
 * Compact catalog embed + string select menus (25 options each). Up to 125 items in one view; larger catalogs paginate.
 * @param {object} [catalogOpts]
 * @param {number|null} [catalogOpts.userPoints] — if set, shows balance in the embed and affordability hints on options
 * @param {string} [catalogOpts.embedTitle]
 * @param {string} [catalogOpts.introLine] — line after balance (before catalog)
 * @param {number} [catalogOpts.page] — 0-based page when catalog has more than {@link SHOP_MAX_OPTIONS_SINGLE_VIEW} items
 * @param {string|null} [catalogOpts.viewerId] — Discord user id for pagination buttons (required when paginating)
 * @param {boolean} [catalogOpts.developerFreeShop] — `DEVELOPER_ID`: show free-shop hints; affordability treats all items as affordable
 */
const SHOP_INTRO = {
    shop:
        'Select something from a menu (✓ = you can afford it). Or use /buy with the item id.\n\n' +
        '🎨 **Cosmetics:** Equip badges and name colors from `/inventory`. **Badges** show as an emoji on the **leaderboard** (when this server posts one). **Colors** change the side accent on **`/profile`**. Your `/profile` reply is **public** in the channel. **Premium:** `/profile user:@member` peeks at another player’s stats and cosmetics.',
    buy:
        'Select something from a menu (✓ = you can afford it with your current balance). Or use /buy with the item id.\n\n' +
        '🎨 **Cosmetics:** Equip from `/inventory`. **Badges** → leaderboard flair; **colors** → `/profile` embed accent. `/profile` is public in chat. **Premium** unlocks `/profile user:@member` to peek at another player.',
};

function buildShopCatalog(globalItems, serverItems, catalogOpts = {}) {
    const {
        userPoints,
        embedTitle,
        introLine,
        page: pageRaw = 0,
        viewerId = null,
        catalogKind = 'shop',
        developerFreeShop = false,
        user = null,
        member = null,
    } = catalogOpts;
    const toPlain = (d) => (d && typeof d.toObject === 'function' ? d.toObject() : d);
    const globalPlain = (globalItems || []).map(toPlain);
    const serverPlain = (serverItems || []).map(toPlain);
    const items = user ? filterOwnedShopItems(globalPlain, user, member) : globalPlain;
    const serverItemsFiltered = user ? filterOwnedShopItems(serverPlain, user, member) : serverPlain;
    const order = (a, b) => a.price - b.price;
    const consumables = items.filter((i) => i.type === 'consumable').sort(order);
    const badges = items.filter((i) => i.type === 'badge').sort(order);
    const colors = items.filter((i) => i.type === 'color').sort(order);
    const misc = items.filter((i) => !['consumable', 'badge', 'color', 'role'].includes(i.type)).sort(order);

    const lines = [];
    const pushCat = (title, arr) => {
        if (!arr.length) return;
        lines.push(`**${title}**`);
        for (const item of arr) {
            const p = item.premiumOnly ? '💎 ' : '';
            lines.push(`${p}**${item.name}** — ${item.price} ${CREDITS} — \`${item.id}\``);
        }
        lines.push('');
    };
    pushCat('Consumables', consumables);
    pushCat('Badges', badges);
    pushCat('Name colors', colors);
    pushCat('Other', misc);

    if (serverItemsFiltered && serverItemsFiltered.length) {
        lines.push('**🏠 Server exclusives**');
        for (const item of serverItemsFiltered) {
            lines.push(`🏠 **${item.name}** — ${item.price} ${CREDITS} — \`${item.id}\``);
        }
    }

    /** Same order as the text catalog so menu 1 ≈ consumables, then badges, colors, etc. */
    const orderedShopItems = [...consumables, ...badges, ...colors, ...misc];

    const options = [];
    const optDesc = (price) => {
        if (developerFreeShop) {
            return `${price} ${CREDITS} · ✓ dev (no charge)`.substring(0, 100);
        }
        if (userPoints == null || Number.isNaN(Number(userPoints))) {
            return `${price} ${CREDITS}`.substring(0, 100);
        }
        const bal = Number(userPoints);
        const ok = bal >= price;
        return `${price} ${CREDITS} · ${ok ? '✓ can buy' : '✗ need more'}`.substring(0, 100);
    };
    for (const item of orderedShopItems) {
        options.push({
            label: `${item.premiumOnly ? '💎 ' : ''}${item.name}`.substring(0, 100),
            description: optDesc(item.price),
            value: item.id.substring(0, 100),
        });
    }
    if (serverItemsFiltered && serverItemsFiltered.length) {
        for (const item of serverItemsFiltered) {
            options.push({
                label: `🏠 ${item.name}`.substring(0, 100),
                description: optDesc(item.price),
                value: item.id.substring(0, 100),
            });
        }
    }

    const baseCatalogText = lines.join('\n').trim() || 'No items yet.';
    const totalListed = options.length;
    let usePager = totalListed > SHOP_MAX_OPTIONS_SINGLE_VIEW;
    let page = Number(pageRaw);
    if (!Number.isFinite(page) || page < 0) page = 0;
    let totalPages = 1;
    let menuOptions;

    if (usePager) {
        totalPages = Math.ceil(totalListed / SHOP_PAGE_SIZE);
        page = Math.min(page, totalPages - 1);
        menuOptions = options.slice(page * SHOP_PAGE_SIZE, (page + 1) * SHOP_PAGE_SIZE);
    } else {
        menuOptions = options.slice(0, SHOP_MAX_OPTIONS_SINGLE_VIEW);
    }

    const maxRowsThisView = usePager ? SHOP_PAGE_SELECT_ROWS : SHOP_MAX_ROWS_ALL_SELECTS;
    const menuRowCount = Math.min(maxRowsThisView, Math.ceil(menuOptions.length / SHOP_OPTIONS_PER_MENU) || 0);

    let desc = baseCatalogText;
    if (usePager) {
        desc += `\n\n📄 **Menus — page ${page + 1} of ${totalPages}** (${SHOP_PAGE_SIZE} items per page). Use **◀ / ▶** below. Every id is listed above when it fits—otherwise \`/buy item:<id>\`.`;
    }
    if (!usePager && totalListed > SHOP_OPTIONS_PER_MENU) {
        desc += `\n\n📂 **${totalListed} items** in **${menuRowCount}** dropdowns (up to 25 each). Open **each** menu—badges & name colors are usually **not** in the first one.`;
    } else if (!usePager && totalListed > 0) {
        desc += `\n\n📂 Choose an item from the menu below.`;
    } else if (usePager && totalListed > 0) {
        desc += `\n\n📂 **${totalListed} items** total. This page has **${menuRowCount}** menus; badges & colors may be on **another page**—use **Next ▶**.`;
    }

    const balanceBlock =
        userPoints != null
            ? developerFreeShop
                ? `**🪙 Your ${CREDITS}: ${Number(userPoints).toLocaleString()}** (_developer — shop purchases don’t deduct; \`/dev_points\` to change balance_)\n\n`
                : `**🪙 Your ${CREDITS}: ${Number(userPoints).toLocaleString()}**\n\n`
            : '';
    const defaultIntro = SHOP_INTRO[catalogKind] || SHOP_INTRO.shop;
    const titleResolved = embedTitle || (catalogKind === 'buy' ? '🛒 Buy an item' : '🛒 Point Shop');
    const suffixLen = desc.length - baseCatalogText.length;
    let fullDesc = balanceBlock + (introLine || defaultIntro) + '\n\n' + desc;
    if (fullDesc.length > 4096) {
        const reserve = balanceBlock.length + (introLine || defaultIntro).length + suffixLen + 8;
        const maxCatalog = Math.max(400, 4096 - reserve);
        const truncatedCatalog =
            baseCatalogText.length > maxCatalog
                ? `${baseCatalogText.slice(0, maxCatalog - 40)}…\n_(List trimmed — use the dropdowns or \`/buy item:<id>\` for every item.)_`
                : baseCatalogText;
        desc = truncatedCatalog + desc.slice(baseCatalogText.length);
        fullDesc = balanceBlock + (introLine || defaultIntro) + '\n\n' + desc;
        if (fullDesc.length > 4096) {
            fullDesc = `${fullDesc.slice(0, 4093)}…`;
        }
    }

    const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle(titleResolved)
        .setDescription(fullDesc);

    const components = [];
    const maxRows = usePager ? SHOP_PAGE_SELECT_ROWS : SHOP_MAX_ROWS_ALL_SELECTS;
    const cappedMenus = menuOptions.slice(0, maxRows * SHOP_OPTIONS_PER_MENU);
    for (let i = 0; i < cappedMenus.length; i += SHOP_OPTIONS_PER_MENU) {
        const chunk = cappedMenus.slice(i, i + SHOP_OPTIONS_PER_MENU);
        const globalIndex = usePager ? page * SHOP_PAGE_SIZE + i : i;
        components.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(`shop_buy_select_${Math.floor(i / SHOP_OPTIONS_PER_MENU)}`)
                    .setPlaceholder(`Buy: items ${globalIndex + 1}–${globalIndex + chunk.length}`)
                    .addOptions(chunk)
            )
        );
    }

    if (usePager && viewerId) {
        const k = catalogKind === 'buy' ? 'b' : 's';
        const nav = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`shop_cat_${k}_${viewerId}_${page - 1}`)
                .setLabel('◀ Prev')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page <= 0),
            new ButtonBuilder()
                .setCustomId('shop_cat_page_label')
                .setLabel(`${page + 1} / ${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`shop_cat_${k}_${viewerId}_${page + 1}`)
                .setLabel('Next ▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1),
        );
        components.push(nav);
    }

    return { embeds: [embed], components };
}

const { resolveGameHostChannel, resolveUserVoiceChannel } = require('../../lib/discordGameHost');
const mongoRouter = require('../../lib/mongoRouter');
const {
    GameSchedulingBlockedError,
    throwIfImmediateGameStartBlockedByMaintenance,
} = require('../../lib/maintenanceScheduling');
const { getDisabledSlashCommandMessage } = require('../../lib/commandGate');
const { isShuttingDown, getShuttingDownUserMessage } = require('../../lib/botLifecycle');
const { logOpsEvent, shouldLogInteractionReceived } = require('../../lib/opsEventLog');

function interactionLogContext(interaction) {
    let subcommand = null;
    try {
        if (interaction?.isChatInputCommand?.() && interaction.options?.getSubcommand) {
            subcommand = interaction.options.getSubcommand(false) || null;
        }
    } catch (_) {
        subcommand = null;
    }
    return {
        guildId: interaction?.guildId || null,
        userId: interaction?.user?.id || null,
        channelId: interaction?.channelId || null,
        channelType: interaction?.channel?.type ?? null,
        channelArchived: interaction?.channel?.archived ?? null,
        isThread: interaction?.channel?.isThread?.() ?? null,
        commandName: interaction?.commandName || null,
        customId: interaction?.customId || null,
        subcommand,
        interactionType: interaction?.type ?? null,
    };
}

/**
 * @param {{ agreedTermsVersion?: string|null, agreedPrivacyVersion?: string|null }} user
 * @param {string} termsVer
 * @param {string} privacyVer
 */
function userHasCurrentAgreements(user, termsVer, privacyVer) {
    if (!user) return false;
    const t = String(user.agreedTermsVersion ?? '0').trim();
    const p = String(user.agreedPrivacyVersion ?? '0').trim();
    return t === String(termsVer).trim() && p === String(privacyVer).trim();
}

/**
 * @param {object} deps
 * @returns {Promise<{ termsVersion: string, privacyVersion: string, source?: string }>}
 */
async function resolveLegalVersionsForDeps(deps) {
    if (typeof deps.resolveLegalVersions === 'function') {
        return deps.resolveLegalVersions();
    }
    if (deps.CURRENT_TERMS_VERSION != null && deps.CURRENT_PRIVACY_VERSION != null) {
        return {
            termsVersion: deps.CURRENT_TERMS_VERSION,
            privacyVersion: deps.CURRENT_PRIVACY_VERSION,
            source: 'deps',
        };
    }
    const { getEffectiveLegalVersions } = require('../../lib/legalPolicyVersions');
    return getEffectiveLegalVersions();
}

function registerInteractionCreate(client, deps) {
    const {
        state,
        triggers,
        scheduleGame,
    } = deps;

    const {
        activeSprints,
        activeCaptions,
        activeTunes,
        activeUnscrambles,
        activeGiveaways,
        activeMovieGames,
        activeDuels,
        storyLastUserId,
        scheduledGames,
        WORDS,
        PHRASES,
    } = state;

    const {
        triggerTriviaSprintEnd,
        triggerCaptionEnd,
        triggerTuneEnd,
        triggerMovieEnd,
        nextMovieQuote,
        triggerUnscrambleEnd,
        endGiveaway,
    } = triggers;

    async function checkManager(interaction) {
        const guildId = interaction.guildId;
        const config = await getSystemConfig(guildId);
        const isOwner = interaction.member?.permissions?.has('Administrator');
        const hasManagerRole = config.managerRoleId && interaction.member?.roles?.cache?.has(config.managerRoleId);
        if (isOwner || hasManagerRole) return true;
        logOpsEvent('command_denied', { ...interactionLogContext(interaction), reason: 'missing_manager_permission' });
        await interaction.reply({
            content: '❌ You need **Administrator** or the **Bot Manager** role.',
            ephemeral: true,
        });
        return false;
    }

    client.on('interactionCreate', async interaction => {
    await mongoRouter.runWithGuild(interaction.guildId ?? null, async () => {
    try {
        const interactionCtx = interactionLogContext(interaction);
        if (shouldLogInteractionReceived()) {
            logOpsEvent('interaction_received', interactionCtx);
        }
		if (await handleSupportServerAdminCommands(interaction)) return;

        // Pre-emptive check for all interactions in archived threads.
        if (interaction.channel?.isThread?.() && interaction.channel.archived) {
            logOpsEvent('command_denied', { ...interactionCtx, reason: 'archived_thread' });
            try {
                if (!interaction.replied && !interaction.deferred) {
                   await interaction.reply({
                        content: "This thread is archived. Commands and buttons are disabled here.",
                        flags: [MessageFlags.Ephemeral],
                    });
                }
            } catch (e) {
                // If we can't even reply, just log and stop.
                console.error("Could not reply to interaction in archived thread:", e.code);
            }
            return; // Stop all further processing.
        }

        const guildId = interaction.guildId;
        if (!guildId) return;

        if (isShuttingDown() && interaction.isRepliable()) {
            logOpsEvent('command_denied', { ...interactionCtx, reason: 'bot_shutting_down' });
            const shutdownMsg = getShuttingDownUserMessage();
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: shutdownMsg, flags: [MessageFlags.Ephemeral] });
                } else if (interaction.deferred) {
                    await interaction.editReply({ content: shutdownMsg });
                }
            } catch (_) {
                /* ignore */
            }
            return;
        }

        let user = null;
        if (interaction.user && !interaction.user.bot) {
            // lib/db getUser uses mongoRouter (correct prod vs test DB). `User` from models resolves at load and targets prod only.
            user = await getUser(guildId, interaction.user.id);

            if (user && user.isBlacklisted) {
                const reason = user.blacklistReason || 'No reason provided.';
                logOpsEvent('command_denied', { ...interactionCtx, reason: 'blacklisted_user' });
                if (interaction.isRepliable()) {
                    return interaction.reply({ content: `🚫 You are blacklisted from using PlayBound.\nReason: **${reason}**\n\nIf you believe this is a mistake, use \`/ticket\` in our support server.`, ephemeral: true });
                }
                return;
            }

            const hasDiscordEntitlement = interaction.entitlements?.cache?.some(ent => ent.skuId === process.env.DISCORD_PREMIUM_SKU_ID) ?? false;

            // Handle Premium Status
            let shouldBePremium = user.isPremium;
            let newSource = user.premiumSource;

            if (hasDiscordEntitlement) {
                shouldBePremium = true;
                newSource = 'discord';
            } else if (user.premiumSource === 'discord') {
                // They were premium via Discord, but no longer have the entitlement
                shouldBePremium = false;
                newSource = null;
            }
            // If they are premium via 'stripe', we leave it alone (webhook handles it)

            if (user.isPremium !== shouldBePremium || user.premiumSource !== newSource) {
                const lostPremium = user.isPremium && !shouldBePremium;
                const gainedPremium = !user.isPremium && shouldBePremium;
                user.isPremium = shouldBePremium;
                user.premiumSource = newSource;

                // If they lost premium (e.g. refund, expired), unequip premium-only cosmetics
                if (lostPremium && user.currentCosmetics) {
                    let changed = false;
                    const premiumIds = ['premium_badge_diamond', 'premium_color_crystal'];
                    for (const [slot, itemId] of user.currentCosmetics.entries()) {
                        if (premiumIds.includes(itemId)) {
                            user.currentCosmetics.delete(slot);
                            changed = true;
                        }
                    }
                    if (changed) user.markModified('currentCosmetics');
                }

                await user.save();

                if (gainedPremium) {
                    const convSrc =
                        newSource === 'discord' ? 'discord' : newSource === 'stripe' ? 'stripe' : 'unknown';
                    await trackPremiumConversion({ userId: interaction.user.id, source: convSrc }).catch(() => {});
                }
            }
            // If it's a command, check if they agreed to terms
            if (interaction.isChatInputCommand()) {
                const bootstrapOnSupport =
                    interaction.commandName === 'bootstrap_support_server' &&
                    process.env.SUPPORT_SERVER_ID &&
                    interaction.guildId === process.env.SUPPORT_SERVER_ID &&
                    (interaction.member?.permissions?.has('Administrator') || isBotDeveloper(interaction.user.id));
                const legal = await resolveLegalVersionsForDeps(deps);
                if (!bootstrapOnSupport && !userHasCurrentAgreements(user, legal.termsVersion, legal.privacyVersion)) {
                    const embed = new EmbedBuilder()
                        .setColor('#FFA500')
                        .setTitle('📜 Agreements Required')
                        .setDescription(`To use PlayBound, please review and accept our updated **Terms of Service** and **Privacy Policy**.\n\n[View Terms of Service](https://play-bound.com/terms.html)\n[View Privacy Policy](https://play-bound.com/privacy.html)\n\nClick the button below to agree and continue.`)
                        .setFooter({ text: `Terms v${legal.termsVersion} | Privacy v${legal.privacyVersion}` });

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('accept_agreements').setLabel('Accept & Continue').setStyle(ButtonStyle.Success)
                    );

                    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
                }
            }
        }

    if (interaction.isButton() && interaction.customId === 'accept_agreements') {
        if (!interaction.user?.id) {
            return interaction.reply({
                content: '❌ Could not identify your account. Try the command again from this server.',
                flags: [MessageFlags.Ephemeral],
            }).catch(() => {});
        }
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        try {
            const legalAccept = await resolveLegalVersionsForDeps(deps);
            await updateUser(guildId, interaction.user.id, u => {
                u.agreedTermsVersion = legalAccept.termsVersion;
                u.agreedPrivacyVersion = legalAccept.privacyVersion;
                u.agreedTermsAt = new Date();
                u.agreedPrivacyAt = new Date();
            });
            await interaction.editReply({
                content:
                    '✅ Thank you! You have accepted the latest agreements. You can now use slash commands in this server.',
            });
        } catch (e) {
            console.error('[accept_agreements] save failed:', e?.message || e);
            await interaction
                .editReply({
                    content:
                        '❌ Saving your acceptance failed. Please tap **Accept** again in a moment. If this keeps happening, say so in support.',
                })
                .catch(() => {});
        }
        return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('ob_')) {
        const handled = await onboardingDiscord.handleOnboardingButton(interaction, client);
        if (handled) return;
    }

    if (interaction.isChatInputCommand()) {
        const cmdDeny = getDisabledSlashCommandMessage(interaction.commandName, interaction.user?.id, {
            guildId,
        });
        if (cmdDeny) {
            return interaction.reply({ content: cmdDeny, ephemeral: true }).catch(() => {});
        }
    }

    if (await serverdleGame.handleInteraction(interaction, client)) return;
    if (await guessthenumberGame.handleInteraction(interaction, client)) return;
    if (await platformPlay.handlePlatformButton(interaction, client)) return;
    if (await spellingBeeGame.handleInteraction(interaction, client)) return;

    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'unscramble_modal') {
            const activeUnscramble = activeUnscrambles.get(interaction.channelId);
            if (!activeUnscramble) return interaction.reply({ content: 'Game ended!', ephemeral: true });
            const p = activeUnscramble.players[interaction.user.id];
            if (!p || p.timeTaken) return interaction.reply({ content: 'Already finished!', ephemeral: true });

            const guess = interaction.fields.getTextInputValue('unscramble_input');
            const q = activeUnscramble.phrases[p.qIndex];

            if (isFuzzyMatch(guess, q.phrase.replace(/ /g, ''))) {
                p.score += p.currentHint ? 0.5 : 1;
                p.qIndex++;
                p.currentHint = false;

                if (p.qIndex >= activeUnscramble.totalRounds) {
                    p.timeTaken = Date.now() - p.startTime;
                    return interaction.update({ content: `✅ Correct!\n\n🏁 **FINISHED!** Score: ${p.score}/${activeUnscramble.totalRounds}\nTime: ${(p.timeTaken/1000).toFixed(1)}s`, components: [] });
                }

                const nq = activeUnscramble.phrases[p.qIndex];
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('unscramble_guess_btn').setLabel('🤔 Guess').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('unscramble_hint_btn').setLabel('💡 Hint (0.5× round)').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('unscramble_skip_btn').setLabel('⏭️ Skip').setStyle(ButtonStyle.Danger)
                );
                await interaction.update({ content: `✅ Correct!\n\n**Phrase ${p.qIndex + 1}/${activeUnscramble.totalRounds}**\n\n# \`${nq.scrambled}\`\n*Clue: ${nq.clue}*`, components: [row] });
            } else {
                const wordCount = q.phrase.split(' ').length;
                let hintText = p.currentHint ? `\n\n💡 **Hint:** The answer has **${wordCount}** word${wordCount === 1 ? '' : 's'}.` : '';
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('unscramble_guess_btn').setLabel('🤔 Guess').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('unscramble_hint_btn').setLabel('💡 Hint (0.5× round)').setStyle(ButtonStyle.Secondary).setDisabled(p.currentHint),
                    new ButtonBuilder().setCustomId('unscramble_skip_btn').setLabel('⏭️ Skip').setStyle(ButtonStyle.Danger)
                );
                await interaction.update({ content: `❌ **"${guess}"** is incorrect! Try again.\n\n**Phrase ${p.qIndex + 1}/${activeUnscramble.totalRounds}**\n\n# \`${q.scrambled}\`\n*Clue: ${q.clue}*${hintText}`, components: [row] });
            }
            return;
        }
    }
if (interaction.commandName === 'ticket') {
    const type = interaction.options.getString('type');
    const reason = interaction.options.getString('reason');
    const supportServerId = process.env.SUPPORT_SERVER_ID;
    let ticketChannelId;

    if (type === 'Bug') ticketChannelId = process.env.SUPPORT_REPORT_CHANNEL_ID;
    else if (type === 'Suggestion') ticketChannelId = process.env.SUPPORT_SUGGESTION_CHANNEL_ID;
    else ticketChannelId = process.env.SUPPORT_TICKET_CHANNEL_ID;

    // Fallback if specific channels aren't set, just route to the main ticket channel
    if (!ticketChannelId) ticketChannelId = process.env.SUPPORT_TICKET_CHANNEL_ID;

    if (!supportServerId || !ticketChannelId) {
        return interaction.reply({ content: "❌ Support system is not configured yet. Please use `/support` to join our server and ask for help manually.", ephemeral: true });
    }

    try {
        const supportGuild = await client.guilds.fetch(supportServerId).catch(() => null);
        if (!supportGuild) throw new Error("Support server not found.");

        const ticketChan = await supportGuild.channels.fetch(ticketChannelId).catch(() => null);
        if (!ticketChan) throw new Error("Support ticket channel not found.");

        const thread = await ticketChan.threads.create({
            name: `${type}-${interaction.user.username}`,
            autoArchiveDuration: 1440,
            type: ChannelType.PrivateThread,
            reason: `${type} ticket for ${interaction.user.tag}`
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger)
        );

        let icon = type === 'Bug' ? '🚨' : (type === 'Suggestion' ? '💡' : (type === 'Other' ? '❓' : '🛠️'));

        await thread.send({
            content: `${icon} **New ${type} from <@${interaction.user.id}>**\n\n**Origin Server:** ${interaction.guild.name} (${interaction.guild.id})\n**Details:** ${reason}\n\n*A staff member will review this shortly.*`,
            components: [row]
        });

        // If the user is in the support server, add them to the thread
        try {
            const member = await supportGuild.members.fetch(interaction.user.id);
            if (member) await thread.members.add(interaction.user.id);
        } catch (e) {
            // User not in server, that's fine
        }

        await interaction.reply({ content: `✅ ${type} submitted! Please join our support server to view your ticket and speak with staff: ${process.env.SUPPORT_SERVER_INVITE}\n\nYour ticket: <#${thread.id}> (You must be in the server to see it)`, ephemeral: true });
    } catch (err) {
        console.error("Ticket Error:", err);
        await interaction.reply({ content: "❌ Failed to create ticket. Please contact the bot developer directly.", ephemeral: true });
    }
}

if (interaction.isButton()) {
    if (interaction.customId === 'ticket_close') {
        if (!interaction.channel.isThread()) return;
        await interaction.reply({ content: "🔒 Closing ticket..." });
        await interaction.channel.setLocked(true);
        await interaction.channel.setArchived(true);
        return;
    }

    if (interaction.customId !== 'shop_cat_page_label' && /^shop_cat_[sb]_\d+_-?\d+$/.test(interaction.customId)) {
        const m = interaction.customId.match(/^shop_cat_([sb])_(\d+)_(-?\d+)$/);
        if (m) {
            const catalogKind = m[1] === 'b' ? 'buy' : 'shop';
            const ownerId = m[2];
            const page = parseInt(m[3], 10);
            if (interaction.user.id !== ownerId) {
                return interaction.reply({ content: 'Use `/shop` or `/buy` to open your own catalog.', ephemeral: true });
            }
            await interaction.deferUpdate();
            const globalItems = await ShopItem.find();
            const config = await getSystemConfig(guildId);
            const serverItems = config.shopItems || [];
            const user = await getUser(guildId, interaction.user.id);
            const { embeds, components } = buildShopCatalog(globalItems, serverItems, {
                userPoints: user.points ?? 0,
                page,
                viewerId: ownerId,
                catalogKind,
                developerFreeShop: isBotDeveloper(ownerId),
                user,
                member: interaction.member,
            });
            return interaction.editReply({ embeds, components });
        }
    }

    if (interaction.customId === 'shop_cat_page_label') {
        return;
    }
    if (interaction.customId === 'tournament_join') {
        const handled = await tournamentGame.handleInteraction(interaction, client);
        if (handled) return;
    }
    if (interaction.customId === 'duel_accept') {
        const duel = activeDuels.get(interaction.message.id);
        if (!duel || duel.state !== 'pending') return interaction.reply({ content: "This duel is no longer active.", ephemeral: true });
        if (interaction.user.id !== duel.targetId) return interaction.reply({ content: "You are not the challenged player!", ephemeral: true });

        const target = await getUser(guildId, interaction.user.id);
        if (target.points < duel.bet) {
            return interaction.reply({
                content: `❌ You need **${duel.bet.toLocaleString()}** ${CREDITS} to accept this duel.\n🪙 **Your balance:** **${target.points.toLocaleString()}**`,
                ephemeral: true,
            });
        }

        const challenger = await getUser(guildId, duel.challengerId);
        if (challenger.points < duel.bet) return interaction.reply({ content: `❌ The challenger no longer has enough **${CREDITS}**!`, ephemeral: true });

        challenger.points -= duel.bet;
        target.points -= duel.bet;
        await challenger.save();
        await target.save();

        duel.state = 'playing';
        clearTimeout(duel.timeoutHandle);

        await interaction.update({ content: `⚔️ **Duel Accepted!** Fetching a question...`, components: [] });

        try {
            const [triviaRow] = await fetchOpenTdbMultipleChoice(1, {});
            if (!triviaRow) throw new Error('API Error');
            duel.correctAnswer = triviaRow.correct;
            duel.answers = triviaRow.answers;

            const answerRow = new ActionRowBuilder();
            triviaRow.answers.forEach((ans, idx) => {
                answerRow.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`duel_ans_${idx}`)
                        .setLabel(ans.substring(0, 80))
                        .setStyle(ButtonStyle.Primary),
                );
            });

            duel.timeoutHandle = setTimeout(async () => {
                activeDuels.delete(interaction.message.id);
                const c = await getUser(guildId, duel.challengerId);
                const t = await getUser(guildId, duel.targetId);
                c.points += duel.bet; t.points += duel.bet;
                await c.save(); await t.save();
                await interaction.message.edit({ content: `⌛ Time's up! Neither player answered in time. **${CREDITS}** refunded.`, components: [] }).catch(()=>{});
            }, 30000);

            await interaction.message.edit({
                content:
                    `⚔️ **TRIVIA DUEL** ⚔️\n${pickDuelFightLine()}\n<@${duel.challengerId}> **VS** <@${duel.targetId}>\n` +
                    `🪙 Stake **${duel.bet.toLocaleString()}** ${CREDITS} each · Pot **${(duel.bet * 2).toLocaleString()}** · After stake: <@${duel.challengerId}> **${challenger.points.toLocaleString()}** · <@${duel.targetId}> **${target.points.toLocaleString()}**\n\n` +
                    `**Question:** ${triviaRow.question}\n\n` +
                    `*First to answer correctly wins the pot! Wrong answer = instant loss.*`,
                embeds: [],
                components: [answerRow],
            });
        } catch (err) {
            challenger.points += duel.bet;
            target.points += duel.bet;
            await challenger.save();
            await target.save();
            activeDuels.delete(interaction.message.id);
            await interaction.message.edit({ content: `❌ Error fetching question. **${CREDITS}** refunded.`, components: [] });
        }
    }

    if (interaction.customId.startsWith('duel_ans_')) {
        const duel = activeDuels.get(interaction.message.id);
        if (!duel || duel.state !== 'playing') return interaction.reply({ content: "This duel is over.", ephemeral: true });

        if (interaction.user.id !== duel.challengerId && interaction.user.id !== duel.targetId) {
            return interaction.reply({ content: "You are not in this duel!", ephemeral: true });
        }

        const isCorrect = duel.answers[parseInt(interaction.customId.split('_')[2])] === duel.correctAnswer;
        const winnerId = isCorrect ? interaction.user.id : (interaction.user.id === duel.challengerId ? duel.targetId : duel.challengerId);

        clearTimeout(duel.timeoutHandle);
        activeDuels.delete(interaction.message.id);

        const winner = await getUser(guildId, winnerId);
        winner.points += (duel.bet * 2);
        winner.weeklyPoints += (duel.bet * 2);
        winner.monthlyPoints = (winner.monthlyPoints || 0) + (duel.bet * 2);
        await winner.save();

        let resultMsg = isCorrect 
            ? `✅ <@${interaction.user.id}> got it right!` 
            : `❌ <@${interaction.user.id}> answered incorrectly!`;

        await interaction.update({ content: `⚔️ **DUEL OVER** ⚔️\n${resultMsg}\n\nThe correct answer was: **${duel.correctAnswer}**\n\n🏆 <@${winnerId}> wins the pot of **${duel.bet * 2} ${CREDITS}**!`, components: [] });
        try {
            await onDuelMissionHook({ guildId, winnerUserId: winnerId });
            const loserId = winnerId === duel.challengerId ? duel.targetId : duel.challengerId;
            await recordDuelOutcome(guildId, winnerId, loserId);
        } catch (_) {
            /* best-effort */
        }
    }

    if (interaction.customId.startsWith('pb_aura_')) {
        const gameKey = interaction.customId.slice('pb_aura_'.length);
        const booster = await getUser(guildId, interaction.user.id);
        if (!booster.isPremium) {
            return interaction.reply({ content: '❌ **Session aura boost** is for PlayBound Premium members. Use `/premium` to subscribe.', ephemeral: true });
        }
        const activeGameDoc = await Game.findOne({ threadId: gameKey, status: 'active' });
        if (!activeGameDoc) {
            return interaction.reply({ content: 'This game is no longer active.', ephemeral: true });
        }
        if (activeGameDoc.hostIsPremium === true || activeGameDoc.premiumAuraBoost === true) {
            return interaction.reply({ content: `✨ This session already has Premium aura (~1.35× **${ARENA_SCORE.toLowerCase()}** for everyone).`, ephemeral: true });
        }
        await Game.updateOne({ _id: activeGameDoc._id }, { $set: { premiumAuraBoost: true } });
        runAuraBoost(gameKey);
        const rows = interaction.message.components.map((row) => {
            const newRow = new ActionRowBuilder();
            for (const comp of row.components) {
                const btn = ButtonBuilder.from(comp);
                if (comp.customId?.startsWith('pb_aura_')) {
                    btn.setDisabled(true).setLabel('✨ Session aura active');
                }
                newRow.addComponents(btn);
            }
            return newRow;
        });
        await interaction.update({ components: rows });
        await interaction.followUp({ content: `✨ **<@${interaction.user.id}>** activated **Premium session aura** — everyone earns **~1.35×** **${ARENA_SCORE.toLowerCase()}** this game!` });
        return;
    }

        try {
            if (interaction.customId === 'enter_giveaway') {
                const ga = activeGiveaways.get(interaction.message.id);
                if (!ga) return;
                if (ga.ignoredUsers && ga.ignoredUsers.includes(interaction.user.id)) return interaction.reply({ content: 'You are not eligible for this giveaway.', ephemeral: true });

                // --- IGNORED ROLES CHECK ---
                if (ga.ignoredRoles && ga.ignoredRoles.length > 0) {
                    const hasForbiddenRole = interaction.member.roles.cache.some(r => ga.ignoredRoles.includes(r.id));
                    if (hasForbiddenRole) return interaction.reply({ content: '❌ One of your roles is restricted from entering this giveaway.', ephemeral: true });
                }

                if (ga.cooldownDays > 0) {
                    const u = await getUser(guildId, interaction.user.id);
                    if (u.stats.lastGiveawayWin && (Date.now() - u.stats.lastGiveawayWin < ga.cooldownDays * 86400000)) {
                        return interaction.reply({ content: `You've won a giveaway recently and are on cooldown for ${ga.cooldownDays} days!`, ephemeral: true });
                    }
                }
                if (ga.participants.has(interaction.user.id)) return interaction.reply({ content: 'Already in!', ephemeral: true });
                ga.participants.add(interaction.user.id);
                updateActiveGame(interaction.message.id, state => {
                    state.participants = Array.from(ga.participants);
                });
                updateUser(guildId, interaction.user.id, u => { u.stats.giveawaysEntered = (u.stats.giveawaysEntered || 0) + 1; if (u.stats.giveawaysEntered >= 5) awardAchievement(client, guildId, interaction.channel, interaction.user.id, "HOPEFUL"); });
                await interaction.reply({ content: 'Entered!', ephemeral: true }).then(()=>setTimeout(()=>interaction.deleteReply().catch(()=>{}),5000));
                return;
            }

            // --- INTERACTIVE GIVEAWAY END BUTTONS ---
            if (interaction.customId.startsWith('cancel_giv_')) {
                const parts = interaction.customId.split('_');
                const action = parts[2]; // 'winner' or 'void'
                const gid = parts[3];
                const ga = activeGiveaways.get(gid);
                
                if (!ga) return interaction.reply({ content: 'Giveaway no longer active.', ephemeral: true });

                if (action === 'winner') {
                    await interaction.reply({ content: '🏆 Picking winner now...', ephemeral: true });
                    clearTimeout(ga.timeoutHandle);
                    await endGiveaway(gid);
                } else {
                    await interaction.reply({ content: '❌ Giveaway cancelled entirely.', ephemeral: true });
                    clearTimeout(ga.timeoutHandle);
                    activeGiveaways.delete(gid);
                    await endActiveGame(gid, client);
                    const thread = client.channels.cache.get(ga.threadId);
                    if (thread) {
                        await thread.send('⚠️ This giveaway has been cancelled by an administrator.');
                        await finalizeHostedGameThread(thread, { disableComponents: true });
                    }
                }
                return;
            }

            if (interaction.customId === 'unscramble_start') {
                const activeUnscramble = activeUnscrambles.get(interaction.channelId);
                if (!activeUnscramble) return interaction.reply({ content: 'This game has already ended!', ephemeral: true });
                if (activeUnscramble.players[interaction.user.id]) return interaction.reply({ content: 'You have already started!', ephemeral: true });
                activeUnscramble.players[interaction.user.id] = { startTime: Date.now(), score: 0, timeTaken: null, qIndex: 0, currentHint: false };
                
                const q = activeUnscramble.phrases[0];
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('unscramble_guess_btn').setLabel('🤔 Guess').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('unscramble_hint_btn').setLabel('💡 Hint (0.5× round)').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('unscramble_skip_btn').setLabel('⏭️ Skip').setStyle(ButtonStyle.Danger)
                );
                await interaction.reply({ content: `**Phrase 1/${activeUnscramble.totalRounds}**\n\n# \`${q.scrambled}\`\n*Clue: ${q.clue}*`, components: [row], ephemeral: true });
                return;
            }
            if (interaction.customId === 'unscramble_hint_btn') {
                const activeUnscramble = activeUnscrambles.get(interaction.channelId);
                if (!activeUnscramble) return interaction.reply({ content: 'This game has already ended!', ephemeral: true });
                const p = activeUnscramble.players[interaction.user.id];
                if (!p || p.timeTaken) return interaction.reply({ content: 'You have already finished!', ephemeral: true });
                p.currentHint = true;
                const q = activeUnscramble.phrases[p.qIndex];
                const wordCount = q.phrase.split(' ').length;
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('unscramble_guess_btn').setLabel('🤔 Guess').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('unscramble_hint_btn').setLabel('💡 Hint (0.5× round)').setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId('unscramble_skip_btn').setLabel('⏭️ Skip').setStyle(ButtonStyle.Danger)
                );
                await interaction.update({ content: `**Phrase ${p.qIndex + 1}/${activeUnscramble.totalRounds}**\n\n# \`${q.scrambled}\`\n*Clue: ${q.clue}*\n\n💡 **Hint:** The answer has **${wordCount}** word${wordCount === 1 ? '' : 's'}.`, components: [row] });
                return;
            }
            if (interaction.customId === 'unscramble_skip_btn') {
                const activeUnscramble = activeUnscrambles.get(interaction.channelId);
                if (!activeUnscramble) return interaction.reply({ content: 'This game has already ended!', ephemeral: true });
                const p = activeUnscramble.players[interaction.user.id];
                if (!p || p.timeTaken) return interaction.reply({ content: 'You have already finished!', ephemeral: true });
                
                p.qIndex++;
                p.currentHint = false;

                if (p.qIndex >= activeUnscramble.totalRounds) {
                    p.timeTaken = Date.now() - p.startTime;
                    return interaction.update({ content: `🏁 **FINISHED!** Score: ${p.score}/${activeUnscramble.totalRounds}\nTime: ${(p.timeTaken/1000).toFixed(1)}s`, components: [] });
                }

                const nq = activeUnscramble.phrases[p.qIndex];
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('unscramble_guess_btn').setLabel('🤔 Guess').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('unscramble_hint_btn').setLabel('💡 Hint (0.5× round)').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('unscramble_skip_btn').setLabel('⏭️ Skip').setStyle(ButtonStyle.Danger)
                );
                await interaction.update({ content: `❌ Skipped!\n\n**Phrase ${p.qIndex + 1}/${activeUnscramble.totalRounds}**\n\n# \`${nq.scrambled}\`\n*Clue: ${nq.clue}*`, components: [row] });
                return;
            }
            if (interaction.customId === 'unscramble_guess_btn') {
                const m = new ModalBuilder().setCustomId('unscramble_modal').setTitle('Unscramble Guess');
                const i = new TextInputBuilder().setCustomId('unscramble_input').setLabel('Your guess').setStyle(TextInputStyle.Short).setRequired(true);
                m.addComponents(new ActionRowBuilder().addComponents(i)); 
                await interaction.showModal(m);
                return;
            }
            if (interaction.customId === 'sprint_start') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const activeSprint = activeSprints.get(interaction.channelId);
                if (!activeSprint) return interaction.editReply({ content: 'This game has already ended!' });
                if (activeSprint.players[interaction.user.id]) return interaction.editReply({ content: 'You have already started!' });

                const user = await getUser(guildId, interaction.user.id);
                const hasSkip = user.inventory && user.inventory.includes('trivia_skip');

                activeSprint.players[interaction.user.id] = { startTime: Date.now(), score: 0, timeTaken: null, qIndex: 0 };
                const q = activeSprint.questions[0];
                const row = new ActionRowBuilder();
                q.answers.forEach((ans, i) => row.addComponents(new ButtonBuilder().setCustomId(`sprintans_${i}`).setLabel(ans.substring(0,80)).setStyle(ButtonStyle.Primary)));

                if (hasSkip) {
                    row.addComponents(new ButtonBuilder().setCustomId('sprint_skip').setLabel('⏭️ Skip (Uses Item)').setStyle(ButtonStyle.Secondary));
                }

                await interaction.editReply({ content: `**Q1**\n\n**${q.question}**`, components: [row] });
                return;
            }
            if (interaction.customId === 'sprint_skip') {
                await interaction.deferUpdate();
                const activeSprint = activeSprints.get(interaction.channelId);
                if (!activeSprint) return interaction.followUp({ content: 'Game ended!', ephemeral: true });
                const p = activeSprint.players[interaction.user.id];
                if (!p || p.timeTaken) return interaction.followUp({ content: 'Finished!', ephemeral: true });

                const user = await getUser(guildId, interaction.user.id);
                const skipIdx = user.inventory.indexOf('trivia_skip');
                if (skipIdx === -1) return interaction.followUp({ content: 'No Skip items left!', ephemeral: true });

                user.inventory.splice(skipIdx, 1);
                await user.save();

                p.qIndex++;
                if (p.qIndex >= activeSprint.questions.length) {
                    p.timeTaken = Date.now() - p.startTime;
                    return interaction.editReply({ content: `⏭️ Skipped to the end!\n\n🏁 **FINISHED!** Score: ${p.score}/${activeSprint.targetScore}\nTime: ${(p.timeTaken/1000).toFixed(1)}s`, components: [] });
                }

                const nq = activeSprint.questions[p.qIndex];
                const row = new ActionRowBuilder();
                nq.answers.forEach((ans, i) => row.addComponents(new ButtonBuilder().setCustomId(`sprintans_${i}`).setLabel(ans.substring(0,80)).setStyle(ButtonStyle.Primary)));

                const hasMoreSkips = user.inventory.includes('trivia_skip');
                if (hasMoreSkips) {
                    row.addComponents(new ButtonBuilder().setCustomId('sprint_skip').setLabel('⏭️ Skip (Uses Item)').setStyle(ButtonStyle.Secondary));
                }

                await interaction.editReply({ content: `⏭️ Skipped!\n\n**Q${p.qIndex+1}**\n\n**${nq.question}**`, components: [row] });
                return;
            }
            if (interaction.customId.startsWith('sprintans_')) {
                await interaction.deferUpdate();
                const activeSprint = activeSprints.get(interaction.channelId);
                if (!activeSprint) return interaction.followUp({ content: 'This game has already ended!', ephemeral: true });
                const p = activeSprint.players[interaction.user.id];
                if (!p || p.timeTaken) return interaction.followUp({ content: 'You have already finished!', ephemeral: true });
                const q = activeSprint.questions[p.qIndex]; const pk = parseInt(interaction.customId.split('_')[1]);
                let f = q.answers[pk] === q.correct ? (p.score++, `✅`) : `❌ (${q.correct})`;
                
                if (p.score >= activeSprint.targetScore || p.qIndex === activeSprint.questions.length - 1) {
                    p.timeTaken = Date.now() - p.startTime;
                    const scoreText = p.score >= activeSprint.targetScore ? "🎉 **PERFECT SCORE!**" : `🏁 **FINISHED!** Score: ${p.score}/${activeSprint.targetScore}`;
                    return interaction.editReply({ content: `${f}\n\n${scoreText}\nTime: ${(p.timeTaken/1000).toFixed(1)}s`, components: [] });
                }

                p.qIndex++; 
                const nq = activeSprint.questions[p.qIndex]; 
                const row = new ActionRowBuilder();
                nq.answers.forEach((ans, i) => row.addComponents(new ButtonBuilder().setCustomId(`sprintans_${i}`).setLabel(ans.substring(0,80)).setStyle(ButtonStyle.Primary)));
                
                const user = await getUser(guildId, interaction.user.id);
                if (user.inventory && user.inventory.includes('trivia_skip')) {
                    row.addComponents(new ButtonBuilder().setCustomId('sprint_skip').setLabel('⏭️ Skip (Uses Item)').setStyle(ButtonStyle.Secondary));
                }
                
                await interaction.editReply({ content: `${f}\n\n**Q${p.qIndex+1}**\n\n**${nq.question}**`, components: [row] });
                updateActiveGame(activeSprint.threadId, state => {
                    state.players[interaction.user.id] = p;
                });
                return;
            }
        } catch (e) {
            console.error('Button Interaction Error:', e);
        }
    }

    // String select menus are NOT buttons — must not live under isButton() or Discord times out (~3s) with "interaction failed"
    if (interaction.isStringSelectMenu()) {
        try {
            if (interaction.customId.startsWith('pach:')) {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const parts = interaction.customId.split(':');
                const viewerId = parts[1];
                const gid = parts[2];
                const targetId = parts[3];
                const page = parseInt(parts[4] || '0', 10) || 0;
                if (interaction.user.id !== viewerId) {
                    return interaction.editReply({
                        content: 'That achievement menu belongs to whoever ran `/profile` here.',
                    });
                }
                if (gid !== guildId) {
                    return interaction.editReply({ content: 'Wrong server.' });
                }
                const rel = parseInt(interaction.values[0], 10);
                const idx = page * 25 + rel;
                const pu = await User.findOne({ guildId: gid, userId: targetId });
                const keys = pu?.achievements || [];
                const achKey = keys[idx];
                if (!achKey) {
                    return interaction.editReply({ content: 'That achievement entry is no longer available.' });
                }
                const cfgPach = await getSystemConfig(guildId);
                const m = resolveAchievementMeta(achKey, cfgPach);
                const body = m
                    ? `**${formatAchievementLabel(m)}**\n${m.desc}`
                    : `**${achKey}**\n_No readable definition (custom removed or unknown key)._`;
                return interaction.editReply({ content: body.slice(0, 2000) });
            }

            if (interaction.customId.startsWith('shop_buy_select')) {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const itemId = interaction.values[0];

                let item = await ShopItem.findOne({ id: itemId });
                const config = await getSystemConfig(guildId);

                if (!item && config.shopItems) {
                    item = config.shopItems.find(i => i.id === itemId);
                }

                if (!item) {
                    return interaction.editReply({ content: 'Invalid item ID!' });
                }

                const user = await getUser(guildId, interaction.user.id);

                if (isDuplicateShopPurchase(user, interaction.member, item)) {
                    const dupMsg =
                        item.type === 'role'
                            ? '❌ You already have this Discord role.'
                            : '❌ You already own this item (in your inventory or equipped).';
                    return interaction.editReply({ content: dupMsg });
                }

                if (item.premiumOnly && !user.isPremium) {
                    return interaction.editReply({ content: 'This item is exclusive to Premium subscribers!' });
                }

                const devShopFree = isBotDeveloper(interaction.user.id);
                if (!devShopFree && user.points < item.price) {
                    return interaction.editReply({ content: `Not enough **${CREDITS}**! (Need **${item.price}**, have **${user.points}**)` });
                }

                if (item.type === 'role') {
                    try {
                        const member = await interaction.guild.members.fetch(interaction.user.id);
                        if (!item.roleId) {
                            return interaction.editReply({ content: '❌ This role item is misconfigured (missing role). Ask an admin.' });
                        }
                        await member.roles.add(item.roleId);
                        if (!devShopFree) user.points -= item.price;
                        await user.save();
                        return interaction.editReply({ content: `✅ Successfully bought and equipped role **${item.name}**!` });
                    } catch (err) {
                        console.error('shop_buy_select role grant:', err);
                        return interaction.editReply({ content: '❌ Could not assign that role. Check bot role hierarchy and permissions.' });
                    }
                }

                if (!user.inventory) user.inventory = [];
                if (!devShopFree) user.points -= item.price;
                user.inventory.push(item.id);
                await user.save();

                return interaction.editReply({ content: `✅ Successfully bought **${item.name}**! Check your \`/inventory\`.` });
            }

            if (interaction.customId === 'inventory_equip_select') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const itemId = interaction.values[0];
                const user = await getUser(guildId, interaction.user.id);

                if (!user.inventory || !user.inventory.includes(itemId)) {
                    return interaction.editReply({ content: `You don't have this item in your inventory!` });
                }

                let item = await ShopItem.findOne({ id: itemId });
                const config = await getSystemConfig(guildId);
                if (!item && config.shopItems) {
                    item = config.shopItems.find(i => i.id === itemId);
                }

                if (!item) return interaction.editReply({ content: 'Invalid item ID!' });
                if (item.type !== 'badge' && item.type !== 'color') {
                    return interaction.editReply({ content: `You can only equip cosmetics (badges and colors).` });
                }

                if (!user.currentCosmetics) user.currentCosmetics = new Map();
                user.currentCosmetics.set(item.type, item.id);
                user.markModified('currentCosmetics');
                await user.save();

                return interaction.editReply({ content: `✅ Equipped **${item.name}**!` });
            }

            if (interaction.customId === 'endgame_select') {
                await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                const selected = interaction.values[0];
                const parts = selected.split('_');
                const type = parts[1]; // sched, recur, or active
                const id = parts.slice(2).join('_');

                if (type === 'sched') {
                    if (scheduledGames.has(id)) {
                        const sched = scheduledGames.get(id);
                        if (sched.guildId === guildId) {
                            clearTimeout(sched.timeoutHandle);
                            scheduledGames.delete(id);
                            await Game.findOneAndUpdate({ 'state.sid': id }, { status: 'ended' });
                            return interaction.editReply({ content: `✅ Cancelled scheduled **${sched.type}** (ID: \`${id}\`).` });
                        }
                    }
                } else if (type === 'recur') {
                    await RecurringGame.findByIdAndDelete(id);
                    return interaction.editReply({ content: `✅ Deleted recurring game.` });
                } else if (type === 'active') {
                    const giveaway = activeGiveaways.get(id);
                    if (giveaway) {
                        const row = new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`cancel_giv_winner_${id}`).setLabel('🏆 Pick Winner Now').setStyle(ButtonStyle.Success),
                            new ButtonBuilder().setCustomId(`cancel_giv_void_${id}`).setLabel('❌ Cancel Entirely').setStyle(ButtonStyle.Danger)
                        );
                        return interaction.editReply({ content: '❓ How would you like to end this giveaway?', components: [row] });
                    }

                    const dbGame = await endActiveGame(id, client);
                    if (dbGame) {
                        guessthenumberGame.forceEnd(client, id);
                        spellingBeeGame.forceEnd(client, id);
                        serverdleGame.forceEnd(client, id);
                        triviaGame.forceEnd(client, id);
                        if (activeSprints.has(id)) { triggerTriviaSprintEnd(id); }
                        if (activeCaptions.has(id)) { triggerCaptionEnd(id); }
                        if (activeTunes.has(id)) { triggerTuneEnd(id); }
                        if (activeMovieGames.has(id)) { triggerMovieEnd(id); }
                        if (activeUnscrambles.has(id)) { triggerUnscrambleEnd(id); }

                        return interaction.editReply({ content: `✅ Ended active game (Thread: ${id}).` });
                    }
                }

                return interaction.editReply({ content: `❌ Could not end that game. It may have already ended.` });
            }
        } catch (e) {
            console.error('StringSelectMenu interaction error:', e);
            const msg = `❌ Something went wrong. ${e.message || 'Try again.'}`;
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: msg });
                } else {
                    await interaction.reply({ content: msg, ephemeral: true });
                }
            } catch (replyErr) {
                console.error(replyErr);
            }
        }
        return;
    }

    if (interaction.isAutocomplete()) {
        const focused = interaction.options.getFocused(true);
        try {
            if (interaction.commandName === 'buy' && focused.name === 'item') {
                const config = await getSystemConfig(guildId);
                const globalItems = await ShopItem.find({}, { id: 1 }).lean();
                const serverItems = (config.shopItems || []).map((i) => i.id).filter(Boolean);
                const ids = [...new Set([...globalItems.map((i) => i.id), ...serverItems])];
                return interaction.respond(trimAutocomplete(ids, focused.value));
            }
            if (interaction.commandName === 'equip' && focused.name === 'item') {
                const u = await getUser(guildId, interaction.user.id);
                const ids = [...new Set((u.inventory || []).map(String))];
                return interaction.respond(trimAutocomplete(ids, focused.value));
            }
            if (interaction.commandName === 'remove_redirect' && focused.name === 'words') {
                const config = await getSystemConfig(guildId);
                const keys = config.redirects?.keys ? [...config.redirects.keys()] : Object.keys(config.redirects || {});
                return interaction.respond(trimAutocomplete(keys, focused.value));
            }
            if (interaction.commandName === 'server_shop_remove' && focused.name === 'id') {
                const config = await getSystemConfig(guildId);
                const ids = (config.shopItems || []).map((i) => i.id).filter(Boolean);
                return interaction.respond(trimAutocomplete(ids, focused.value));
            }
            if (interaction.commandName === 'faction' && focused.name === 'name') {
                return interaction.respond(trimAutocomplete(GLOBAL_FACTION_KEYS, focused.value));
            }
            if (interaction.commandName === 'playgame' && focused.name === 'game') {
                const choices = await playgameAutocompleteChoices(focused.value, interaction.user.id);
                return interaction.respond(choices);
            }
            if (interaction.commandName === 'endgame' && focused.name === 'thread_id') {
                const ids = [];
                const active = await Game.find({ guildId, status: 'active' }, { threadId: 1, state: 1 }).lean();
                for (const g of active) {
                    if (g.threadId) ids.push(String(g.threadId));
                    if (g.state?.sid) ids.push(String(g.state.sid));
                }
                const rec = await RecurringGame.find({ guildId }, { _id: 1 }).lean();
                for (const r of rec) ids.push(String(r._id));
                return interaction.respond(trimAutocomplete([...new Set(ids)], focused.value));
            }
            if (
                (interaction.commandName === 'set_role_reward' && focused.name === 'achievement') ||
                (interaction.commandName === 'achievement' && focused.name === 'key')
            ) {
                const config = await getSystemConfig(guildId);
                const builtIn = Object.keys(ACHIEVEMENTS);
                const custom = (config.customAchievements || []).map((a) => a.key);
                return interaction.respond(trimAutocomplete([...new Set([...builtIn, ...custom])], focused.value));
            }
            return interaction.respond([]);
        } catch {
            return interaction.respond([]);
        }
    }

    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'setup_panels') {
        const supportGuildId = process.env.SUPPORT_SERVER_ID;
        if (!supportGuildId) {
            return interaction.reply({
                content: '❌ `SUPPORT_SERVER_ID` is not set in the bot environment.',
                ephemeral: true,
            });
        }
        if (interaction.guildId !== supportGuildId) {
            return interaction.reply({
                content:
                    '❌ Run `/setup_panels` **only in your PlayBound support server** (the guild id must match `SUPPORT_SERVER_ID`).',
                ephemeral: true,
            });
        }
        const adminOk = interaction.member?.permissions?.has('Administrator');
        if (!adminOk && !isBotDeveloper(interaction.user.id)) {
            return interaction.reply({
                content: '❌ You need **Administrator** in this server (or be the bot developer).',
                ephemeral: true,
            });
        }
        await interaction.deferReply({ ephemeral: true });
        try {
            await postSupportPanels(interaction.guild);
            await interaction.editReply({ content: '✅ PlayBound navigation panels posted in the configured channels.' });
        } catch (err) {
            console.error('setup_panels:', err);
            await interaction.editReply({
                content: `❌ ${err.message || 'Failed to post panels. Check bot permissions and SUPPORT_PANEL_* channel IDs in .env.'}`,
            });
        }
        return;
    }

    if (interaction.commandName === 'bootstrap_support_server') {
        const supportGuildId = process.env.SUPPORT_SERVER_ID;
        if (!supportGuildId) {
            return interaction.reply({
                content: '❌ `SUPPORT_SERVER_ID` is not set in the bot environment.',
                ephemeral: true,
            });
        }
        if (interaction.guildId !== supportGuildId) {
            return interaction.reply({
                content:
                    '❌ Run `/bootstrap_support_server` **only in the PlayBound support server** (guild id must match `SUPPORT_SERVER_ID`).',
                ephemeral: true,
            });
        }
        const adminOk = interaction.member?.permissions?.has('Administrator');
        if (!adminOk && !isBotDeveloper(interaction.user.id)) {
            return interaction.reply({
                content: '❌ You need **Administrator** in this server (or be the bot developer).',
                ephemeral: true,
            });
        }
        const wipeAllReq = interaction.options.getBoolean('wipe_all_managed_channels') === true;
        if (wipeAllReq && !interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content:
                    '❌ **wipe_all_managed_channels** is restricted to members with **Administrator**.',
                ephemeral: true,
            });
        }
        await interaction.deferReply({ ephemeral: true });
        try {
            const guild = interaction.guild;
            const me = guild.members.me ?? (await guild.members.fetchMe());
            const { runBootstrapSupportServer, formatBootstrapSummary } = require('../../lib/bootstrapSupportServer');
            const summary = await runBootstrapSupportServer(guild, me, client, {
                dryRun: interaction.options.getBoolean('dry_run') === true,
                forceRepin: interaction.options.getBoolean('force_repin') === true,
                createMissingOnly: interaction.options.getBoolean('create_missing_only') ?? true,
                wipeBootstrapMessages: interaction.options.getBoolean('wipe_bootstrap_messages') === true,
                wipeAllMessagesInBootstrapChannels: wipeAllReq,
                wipeAllMessagesAuthorized: wipeAllReq && adminOk,
                adminRoleName: interaction.options.getString('admin_role_name') || undefined,
                modRoleName: interaction.options.getString('mod_role_name') || undefined,
            });
            await interaction.editReply({ content: formatBootstrapSummary(summary) });
        } catch (err) {
            if (err.code === 'MISSING_BOT_PERMS') {
                await interaction.editReply({ content: `❌ ${err.message}` });
            } else {
                console.error('bootstrap_support_server:', err);
                await interaction.editReply({ content: `❌ ${err.message || 'Bootstrap failed.'}` });
            }
        }
        return;
    }

    const adminCommands = ['set_announcement_channel', 'set_announce_everyone', 'set_automated_posts', 'set_welcome_channel', 'add_welcome_message', 'remove_welcome_message', 'list_welcome_messages', 'set_birthday_channel', 'add_birthday_message', 'remove_birthday_message', 'list_birthday_messages', 'set_achievement_channel', 'set_leaderboard_channel', 'set_leaderboard_cadence', 'set_faction_reminder_channel', 'set_faction_victory_role', 'set_faction_challenge_defaults', 'set_faction_ranked_rules', 'set_story_channel', 'set_member_log_channel', 'story_export', 'set_manager_role', 'set_member_game_hosts', 'set_auto_role', 'remove_auto_role', 'sync_auto_role', 'strip_role', 'schedule_announcement', 'adjustpoints', 'add_redirect', 'remove_redirect', 'endgame', 'wipe_leaderboard', 'giveaway', 'guessthenumber', 'playgame', 'startserverdle', 'trivia', 'triviasprint', 'namethattune', 'spellingbee', 'moviequotes', 'caption', 'unscramble', 'leaderboard', 'set_role_reward', 'achievement', 'tournament', 'faction_role_link', 'faction_rename', 'faction_emoji'];
    /** When `allowMemberHostedGames` is on, regular members may start these (spam/abuse risk — use with channel slowmode). */
    const MEMBER_HOSTABLE_GAME_COMMANDS = [
        'giveaway',
        'guessthenumber',
        'playgame',
        'startserverdle',
        'trivia',
        'triviasprint',
        'namethattune',
        'spellingbee',
        'moviequotes',
        'caption',
        'unscramble',
    ];
    if (adminCommands.includes(interaction.commandName)) {
        const config = await getSystemConfig(guildId);
        const isOwner = interaction.member && interaction.member.permissions.has('Administrator');
        const hasManagerRole = config.managerRoleId && interaction.member && interaction.member.roles.cache.has(config.managerRoleId);
        const memberHostOk =
            config.allowMemberHostedGames === true &&
            MEMBER_HOSTABLE_GAME_COMMANDS.includes(interaction.commandName);

        if (!isOwner && !hasManagerRole && !memberHostOk) {
            return interaction.reply({
                content:
                    'You do not have permission to use this command. You need **Administrator**, the **Bot Manager** role, or ask an admin to run `/set_member_game_hosts` so members can host games.',
                ephemeral: true,
            });
        }
    }

    if (interaction.commandName === 'set_faction_leader_role') {
        const cfgFl = await getSystemConfig(guildId);
        const isAdmFl = interaction.member?.permissions?.has('Administrator');
        const hasMgrFl = cfgFl.managerRoleId && interaction.member?.roles?.cache?.has(cfgFl.managerRoleId);
        if (!isAdmFl && !hasMgrFl && !isBotDeveloper(interaction.user.id)) {
            return interaction.reply({
                content: '❌ You need **Administrator** or the **Bot Manager** role.',
                ephemeral: true,
            });
        }
        const roleFl = interaction.options.getRole('role');
        await updateSystemConfig(guildId, (c) => {
            c.factionLeaderRoleId = roleFl ? roleFl.id : null;
        });
        return interaction.reply({
            content: roleFl
                ? `✅ **Faction Leader** role set to <@&${roleFl.id}>. They can manage **faction challenges** only (create / end), not other admin tools — same daily limits and rules as everyone else.`
                : '✅ **Faction Leader** role cleared.',
            ephemeral: true,
        });
    }

    // Admin Config
    if (interaction.commandName === 'set_manager_role') {
        const role = interaction.options.getRole('role');
        await updateSystemConfig(guildId, c => c.managerRoleId = role.id);
        await interaction.reply({ content: `✅ <@&${role.id}> has been set as the **Bot Manager** role! Members with this role can now use game and admin commands.`, ephemeral: true });
    }
    if (interaction.commandName === 'set_member_game_hosts') {
        const enabled = interaction.options.getBoolean('enabled');
        await updateSystemConfig(guildId, (c) => {
            c.allowMemberHostedGames = enabled;
        });
        const list =
            '`/guessthenumber` `/playgame` `/trivia` `/triviasprint` `/unscramble` `/caption` `/giveaway` `/startserverdle` `/namethattune` `/spellingbee` `/moviequotes`';
        await interaction.reply({
            content: enabled
                ? `✅ **Any member** can start: ${list}\nOther admin commands still need **Administrator** or **Bot Manager**.`
                : '✅ **Only** Administrator and Bot Manager can start those games again.',
            ephemeral: true,
        });
    }
    if (interaction.commandName === 'set_auto_role') {
        const role = interaction.options.getRole('role');
        await updateSystemConfig(guildId, c => c.autoRoleId = role.id);
        await interaction.reply({ content: `✅ <@&${role.id}> will now be automatically assigned to all new members!`, ephemeral: true });
    }
    if (interaction.commandName === 'remove_auto_role') {
        const config = await getSystemConfig(guildId);
        if (!config.autoRoleId) {
            return interaction.reply({ content: 'No auto-role is currently configured.', ephemeral: true });
        }
        const oldRole = config.autoRoleId;
        await updateSystemConfig(guildId, c => c.autoRoleId = null);
        await interaction.reply({ content: `✅ Auto-role disabled. <@&${oldRole}> will no longer be assigned to new members.`, ephemeral: true });
    }
    if (interaction.commandName === 'strip_role') {
        const user = await getUser(guildId, interaction.user.id);
        if (!user.isPremium) return interaction.reply({ content: "❌ **Bulk Role Removal** is a Premium feature! Use `/premium` to unlock mass role management.", ephemeral: true });
        const role = interaction.options.getRole('role');
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        let removed = 0;
        const members = await interaction.guild.members.fetch();
        for (const [, member] of members) {
            if (member.user.bot) continue;
            if (member.roles.cache.has(role.id)) {
                try {
                    await member.roles.remove(role.id);
                    removed++;
                } catch (e) { /* skip members we can't modify */ }
            }
        }
        await interaction.editReply({ content: `✅ Removed <@&${role.id}> from **${removed}** members.` });
    }
    if (interaction.commandName === 'sync_auto_role') {
        const user = await getUser(guildId, interaction.user.id);
        if (!user.isPremium) return interaction.reply({ content: "❌ **Bulk Role Sync** is a Premium feature! Use `/premium` to unlock mass role management.", ephemeral: true });
        const config = await getSystemConfig(guildId);
        if (!config.autoRoleId) {
            return interaction.reply({ content: '❌ No auto-role configured. Use `/set_auto_role` first.', ephemeral: true });
        }
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const role = interaction.guild.roles.cache.get(config.autoRoleId);
        if (!role) {
            return interaction.editReply({ content: '❌ The configured role no longer exists. Please set a new one with `/set_auto_role`.' });
        }
        let added = 0;
        const members = await interaction.guild.members.fetch();
        for (const [, member] of members) {
            if (member.user.bot) continue;
            if (!member.roles.cache.has(config.autoRoleId)) {
                try {
                    await member.roles.add(config.autoRoleId);
                    added++;
                } catch (e) { /* skip members we can't modify */ }
            }
        }
        await interaction.editReply({ content: `✅ Synced! Added <@&${config.autoRoleId}> to **${added}** existing members.` });
    }
    if (interaction.commandName === 'schedule_announcement') {
        const user = await getUser(guildId, interaction.user.id);
        if (!user.isPremium) return interaction.reply({ content: "❌ **Scheduled Announcements** are a Premium feature! Use `/premium` to unlock automation tools.", ephemeral: true });
        const message = interaction.options.getString('message');
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const delay = getSlashScheduleDelayMs(interaction);

        const cfgSched = await getSystemConfig(guildId);
        if (!automatedServerPostsEnabled(cfgSched)) {
            return interaction.reply({
                content:
                    '❌ **Automated posts** are **off** for this server (`/set_automated_posts`). Turn them **on** to send or schedule channel announcements.',
                ephemeral: true,
            });
        }

        if (delay <= 0) {
            await channel.send(message);
            return interaction.reply({ content: 'Sent!', ephemeral: true });
        }

        const startFn = async () => {
            const cfg = await getSystemConfig(guildId);
            if (!automatedServerPostsEnabled(cfg)) return;
            const chan = await client.channels.fetch(channel.id).catch(() => null);
            if (chan) await chan.send(message);
        };

        const sid = await scheduleGame(guildId, 'Announcement', channel.id, delay, startFn, { message });
        await interaction.reply({ content: `✅ Announcement scheduled for <#${channel.id}> (ID: \`${sid}\`).`, ephemeral: true });
    }
    if (interaction.commandName === 'set_announcement_channel') {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const saved = await updateSystemConfig(guildId, (c) => (c.announceChannel = channel.id));
        const pingLine = shouldPingEveryone(saved)
            ? '**@everyone** for those posts is **on** (legacy default). Turn off with `/set_announce_everyone`.'
            : '**@everyone** for those posts is **off**. Turn on with `/set_announce_everyone enabled:True` if you want pings.';
        await interaction.reply({
            content: `Announcements will post in <#${channel.id}>.\n${pingLine}`,
            ephemeral: true,
        });
    }
    if (interaction.commandName === 'set_announce_everyone') {
        const enabled = interaction.options.getBoolean('enabled');
        await updateSystemConfig(guildId, (c) => {
            c.announcePingEveryone = enabled;
        });
        await interaction.reply({
            content: enabled
                ? '✅ **@everyone** is **on** for game starts and winner lines in your **announcement channel**.'
                : '✅ **@everyone** is **off** for those posts — they still send there, just without a server-wide ping.',
            ephemeral: true,
        });
    }
    if (interaction.commandName === 'set_automated_posts') {
        const enabled = interaction.options.getBoolean('enabled');
        await updateSystemConfig(guildId, (c) => {
            c.automatedServerPostsEnabled = enabled;
        });
        await interaction.reply({
            content: enabled
                ? '✅ **Automated posts** are **on** (recaps, leaderboard channel updates, game/winner broadcasts, welcome & birthday messages, achievement channel, faction reminder — wherever you configured channels).'
                : '✅ **Automated posts** are **off** (quiet mode). Games and **`/leaderboard`** still work; channel hooks stay saved for when you turn this back on.',
            ephemeral: true,
        });
    }
    if (interaction.commandName === 'set_welcome_channel') {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        await updateSystemConfig(guildId, c => c.welcomeChannel = channel.id);
        await interaction.reply({ content: `Welcome messages enabled in <#${channel.id}>!`, ephemeral: true });
    }
        if (interaction.commandName === 'add_welcome_message') {
        const msg = interaction.options.getString('message');
        await updateSystemConfig(guildId, c => {
            if (!c.welcomeMessages) c.welcomeMessages = [];
            c.welcomeMessages.push(msg);
            if (c.welcomeMessage) {
                if (!c.welcomeMessages.includes(c.welcomeMessage)) {
                    c.welcomeMessages.push(c.welcomeMessage);
                }
                c.welcomeMessage = null;
            }
        });
        await interaction.reply({ content: "✅ Added to welcome message rotation!", ephemeral: true });
    }
    if (interaction.commandName === 'remove_welcome_message') {
        const idx = interaction.options.getInteger('index') - 1;
        const config = await getSystemConfig(guildId);
        if (!config.welcomeMessages || config.welcomeMessages.length === 0) {
            return interaction.reply({ content: "No custom welcome messages in rotation.", ephemeral: true });
        }
        if (idx < 0 || idx >= config.welcomeMessages.length) {
            return interaction.reply({ content: "Invalid index.", ephemeral: true });
        }
        const removed = config.welcomeMessages[idx];
        await updateSystemConfig(guildId, c => c.welcomeMessages.splice(idx, 1));
        await interaction.reply({ content: "🗑️ Removed welcome message: \"" + removed + "\"", ephemeral: true });
    }
    if (interaction.commandName === 'list_welcome_messages') {
        const config = await getSystemConfig(guildId);
        if (!config.welcomeMessages || config.welcomeMessages.length === 0) {
            let msg = config.welcomeMessage ? "1. " + config.welcomeMessage : "None";
            return interaction.reply({ content: "**Welcome Messages:**\n" + msg, ephemeral: true });
        }
        const list = config.welcomeMessages.map((m, i) => (i + 1) + ". " + m).join('\n');
        await interaction.reply({ content: "**Welcome Messages:**\n" + list, ephemeral: true });
    }

    if (interaction.commandName === 'set_birthday_channel') {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        await updateSystemConfig(guildId, c => c.birthdayChannel = channel.id);
        await interaction.reply({ content: `Birthday shoutouts enabled in <#${channel.id}>!`, ephemeral: true });
    }
        if (interaction.commandName === 'add_birthday_message') {
        const msg = interaction.options.getString('message');
        await updateSystemConfig(guildId, c => {
            if (!c.birthdayMessages) c.birthdayMessages = [];
            c.birthdayMessages.push(msg);
            if (c.birthdayMessage) {
                if (!c.birthdayMessages.includes(c.birthdayMessage)) {
                    c.birthdayMessages.push(c.birthdayMessage);
                }
                c.birthdayMessage = null;
            }
        });
        await interaction.reply({ content: "✅ Added to birthday message rotation!", ephemeral: true });
    }
    if (interaction.commandName === 'remove_birthday_message') {
        const idx = interaction.options.getInteger('index') - 1;
        const config = await getSystemConfig(guildId);
        if (!config.birthdayMessages || config.birthdayMessages.length === 0) {
            return interaction.reply({ content: "No custom birthday messages in rotation.", ephemeral: true });
        }
        if (idx < 0 || idx >= config.birthdayMessages.length) {
            return interaction.reply({ content: "Invalid index.", ephemeral: true });
        }
        const removed = config.birthdayMessages[idx];
        await updateSystemConfig(guildId, c => c.birthdayMessages.splice(idx, 1));
        await interaction.reply({ content: "🗑️ Removed birthday message: \"" + removed + "\"", ephemeral: true });
    }
    if (interaction.commandName === 'list_birthday_messages') {
        const config = await getSystemConfig(guildId);
        if (!config.birthdayMessages || config.birthdayMessages.length === 0) {
            let msg = config.birthdayMessage ? "1. " + config.birthdayMessage : "None";
            return interaction.reply({ content: "**Birthday Messages:**\n" + msg, ephemeral: true });
        }
        const list = config.birthdayMessages.map((m, i) => (i + 1) + ". " + m).join('\n');
        await interaction.reply({ content: "**Birthday Messages:**\n" + list, ephemeral: true });
    }

    if (interaction.commandName === 'set_achievement_channel') {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        await updateSystemConfig(guildId, c => c.achievementChannel = channel.id);
        await interaction.reply({ content: `Achievement announcements will now be sent to <#${channel.id}>!`, ephemeral: true });
    }
    if (interaction.commandName === 'set_leaderboard_channel') {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        await updateSystemConfig(guildId, c => c.leaderboardChannel = channel.id);
        await interaction.reply({
            content: `**Server activity rankings** will post to <#${channel.id}> (follows \`/set_leaderboard_cadence\`). _Not the same as **Official Faction Rankings** (\`/factions\`)._`,
            ephemeral: true,
        });
    }

    if (interaction.commandName === 'set_leaderboard_cadence') {
        const cfgCadence = await getSystemConfig(guildId);
        const isOwnerCadence = interaction.member?.permissions?.has('Administrator');
        const hasManagerCadence = cfgCadence.managerRoleId && interaction.member?.roles?.cache?.has(cfgCadence.managerRoleId);
        if (!isOwnerCadence && !hasManagerCadence) {
            return interaction.reply({ content: '❌ You need **Administrator** or the **Bot Manager** role.', ephemeral: true });
        }
        const mode = interaction.options.getString('mode', true);
        await updateSystemConfig(guildId, (c) => {
            c.leaderboardCadence = mode;
        });
        await refreshLeaderboard(client, guildId);
        const explain = {
            all_time: '**all-time** totals (never auto-reset). Weekly/monthly recaps still run separately.',
            weekly: '**this week** — same pool as the Sunday recap (resets **Sundays 8:00 PM** bot time).',
            monthly: '**this month** — resets on the **1st** at **8:00 PM** bot time (after the monthly recap).',
        };
        await interaction.reply({
            content: `✅ Leaderboard rankings now use ${explain[mode]}\n\n_Past **weekly** and **monthly** point standings (after each reset) are in \`/leaderboard_history\`._`,
            ephemeral: true,
        });
    }
    if (interaction.commandName === 'set_story_channel') {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        await updateSystemConfig(guildId, c => c.storyChannel = channel.id);
        await interaction.reply({ content: `One-Word Story mode enabled in <#${channel.id}>!`, ephemeral: true });
    }

    if (interaction.commandName === 'set_member_log_channel') {
        const chLog = interaction.options.getChannel('channel');
        await updateSystemConfig(guildId, (c) => {
            c.memberLogChannel = chLog ? chLog.id : null;
        });
        await interaction.reply({
            content: chLog
                ? `✅ Member join/leave lines will post in <#${chLog.id}> when **automated posts** are on.`
                : '✅ Member log channel cleared.',
            ephemeral: true,
        });
    }

    if (interaction.commandName === 'story_export') {
        const config = await getSystemConfig(guildId);
        if (!config.storyChannel) {
            return interaction.reply({ content: '❌ Set a story channel first with `/set_story_channel`.', ephemeral: true });
        }
        const storyChannel = await interaction.guild.channels.fetch(config.storyChannel).catch(() => null);
        if (!storyChannel || !storyChannel.isTextBased?.()) {
            return interaction.reply({ content: '❌ Story channel is missing or not text-based. Re-run `/set_story_channel`.', ephemeral: true });
        }
        const canManage = storyChannel.permissionsFor(interaction.guild.members.me)?.has('ManageMessages');
        if (!canManage) {
            return interaction.reply({
                content: '❌ I need **Manage Messages** in the story channel to export + reset.',
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });
        let deleted = 0;
        const words = [];
        let before = null;

        for (;;) {
            const batch = await storyChannel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
            if (!batch || batch.size === 0) break;
            before = batch.last().id;
            const sorted = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            for (const msg of sorted) {
                if (msg.author?.bot) continue;
                const toks = String(msg.content || '').trim().split(/\s+/).filter(Boolean);
                if (toks.length) words.push(...toks);
            }
            await storyChannel.bulkDelete(batch, true).then((n) => {
                deleted += n.size;
            }).catch(() => {});
            if (batch.size < 100) break;
        }

        const paragraph = words.join(' ').replace(/\s+([,.;!?])/g, '$1').trim();
        const summary = paragraph
            ? `📜 **Story Export**\n\n${paragraph}`
            : '📜 **Story Export**\n\n_No words were found to export._';
        await storyChannel.send({ content: summary.slice(0, 1900), allowedMentions: { parse: [] } });
        storyLastUserId.delete(storyChannel.id);

        return interaction.editReply({
            content: `✅ Story exported and reset in <#${storyChannel.id}>. Cleared **${deleted}** recent messages.`,
        });
    }

    if (interaction.commandName === 'set_faction_reminder_channel') {
        const chRem = interaction.options.getChannel('channel');
        await updateSystemConfig(guildId, (c) => {
            c.factionWarReminderChannelId = chRem ? chRem.id : null;
        });
        await interaction.reply({
            content: chRem
                ? `✅ Weekly faction-war nudge will post in <#${chRem.id}> (Sundays after the weekly recap).`
                : '✅ Faction reminder channel cleared.',
            ephemeral: true,
        });
    }

    if (interaction.commandName === 'set_faction_victory_role') {
        const roleV = interaction.options.getRole('role');
        await updateSystemConfig(guildId, (c) => {
            c.factionVictoryRoleId = roleV ? roleV.id : null;
        });
        await interaction.reply({
            content: roleV
                ? `✅ Winning enrolled players will receive <@&${roleV.id}> when a faction challenge ends.`
                : '✅ Faction victory role cleared.',
            ephemeral: true,
        });
    }

    if (interaction.commandName === 'set_faction_challenge_defaults') {
        const cfgDef = await getSystemConfig(guildId);
        const isOwnerDef = interaction.member && interaction.member.permissions.has('Administrator');
        const hasManagerDef = cfgDef.managerRoleId && interaction.member && interaction.member.roles.cache.has(cfgDef.managerRoleId);
        if (!isOwnerDef && !hasManagerDef) {
            return interaction.reply({
                content: '❌ You need **Administrator** or the **Bot Manager** role.',
                ephemeral: true,
            });
        }
        const clearDef = interaction.options.getBoolean('clear') === true;
        const gtOpt = interaction.options.getString('game_type');
        const smOpt = interaction.options.getString('scoring_mode');
        const tnOpt = interaction.options.getInteger('top_n');

        if (clearDef) {
            await updateSystemConfig(guildId, (c) => {
                c.factionChallengeDefaultGameType = null;
                c.factionChallengeDefaultScoringMode = null;
                c.factionChallengeDefaultTopN = null;
            });
            return interaction.reply({
                content:
                    `✅ Cleared server defaults. Omitted \`/faction_challenge create\` options will use built-in: **game_type** \`${BUILTIN_DEFAULT_GAME}\`, **scoring** \`${BUILTIN_DEFAULT_SCORING}\`, **top_n** **${BUILTIN_DEFAULT_TOPN}**.`,
                ephemeral: true,
            });
        }

        if (gtOpt == null && smOpt == null && tnOpt == null) {
            const g = cfgDef.factionChallengeDefaultGameType ?? `_(built-in: ${BUILTIN_DEFAULT_GAME})_`;
            const s = cfgDef.factionChallengeDefaultScoringMode ?? `_(built-in: ${BUILTIN_DEFAULT_SCORING})_`;
            const t =
                cfgDef.factionChallengeDefaultTopN != null
                    ? String(cfgDef.factionChallengeDefaultTopN)
                    : `_(built-in: ${BUILTIN_DEFAULT_TOPN})_`;
            return interaction.reply({
                content:
                    `**Faction challenge defaults** (used when create options are omitted):\n` +
                    `• **game_type:** ${g}\n` +
                    `• **scoring_mode:** ${s}\n` +
                    `• **top_n:** ${t}\n\n` +
                    `Set any option to override, or **clear:true** to reset.`,
                ephemeral: true,
            });
        }

        if (gtOpt != null && !assertValidGameType(gtOpt)) {
            return interaction.reply({ content: '❌ Invalid **game_type** choice.', ephemeral: true });
        }
        if (smOpt != null && !assertValidScoringMode(smOpt)) {
            return interaction.reply({ content: '❌ Invalid **scoring_mode** choice.', ephemeral: true });
        }
        if (tnOpt != null && (tnOpt < 1 || tnOpt > 50)) {
            return interaction.reply({ content: '❌ **top_n** must be between **1** and **50**.', ephemeral: true });
        }

        await updateSystemConfig(guildId, (c) => {
            if (gtOpt != null) c.factionChallengeDefaultGameType = gtOpt;
            if (smOpt != null) c.factionChallengeDefaultScoringMode = smOpt;
            if (tnOpt != null) c.factionChallengeDefaultTopN = tnOpt;
        });
        const cfg2 = await getSystemConfig(guildId);
        const r = resolveFactionChallengeCreateOptions(cfg2, { gameType: null, scoringMode: null, topN: null });
        return interaction.reply({
            content:
                `✅ Updated defaults. If managers omit options on create, the war will use:\n` +
                `• **game_type** \`${r.gameType}\`\n` +
                `• **scoring_mode** \`${r.scoringMode}\`\n` +
                `• **top_n** **${r.topN}**`,
            ephemeral: true,
        });
    }

    if (interaction.commandName === 'set_faction_ranked_rules') {
        const cfgRank = await getSystemConfig(guildId);
        const isOwnerRank = interaction.member && interaction.member.permissions.has('Administrator');
        const hasManagerRank = cfgRank.managerRoleId && interaction.member && interaction.member.roles.cache.has(cfgRank.managerRoleId);
        if (!isOwnerRank && !hasManagerRank) {
            return interaction.reply({
                content: '❌ You need **Administrator** or the **Bot Manager** role.',
                ephemeral: true,
            });
        }
        const clearRank = interaction.options.getBoolean('clear') === true;
        const rosterOpt = interaction.options.getInteger('default_roster_cap');
        const capsStr = interaction.options.getString('contribution_caps');

        if (clearRank) {
            await updateSystemConfig(guildId, (c) => {
                c.factionRankedDefaultRosterCap = null;
                c.factionRankedContributionCapsByTag = null;
            });
            return interaction.reply({
                content:
                    '✅ Cleared **ranked** defaults (contribution caps and any saved roster hint). New wars have **no** roster cap unless you set **max_per_team** on each `/faction_challenge` create.',
                ephemeral: true,
            });
        }

        if (rosterOpt == null && (capsStr == null || !String(capsStr).trim())) {
            const rc = cfgRank.factionRankedDefaultRosterCap;
            const caps = cfgRank.factionRankedContributionCapsByTag;
            const rosterShow =
                rc != null && Number.isFinite(Number(rc))
                    ? `**${String(rc)}** _(stored only; use \`max_per_team\` on each war to enforce a cap)_`
                    : '_not set_';
            const capsShow =
                caps && typeof caps === 'object' && Object.keys(caps).length
                    ? Object.entries(caps)
                          .map(([k, v]) => `${k}:${v}`)
                          .join(', ')
                    : '_none_';
            return interaction.reply({
                content:
                    `**Official ranked war defaults** (this server):\n` +
                    `• **contribution_caps** (counted per tag): ${capsShow}\n` +
                    `• **default_roster_cap** (legacy field): ${rosterShow}\n\n` +
                    `_Roster limits are optional — set **max_per_team** on \`/faction_challenge create\` when you want one._\n` +
                    `Set options or **clear:true** to reset.`,
                ephemeral: true,
            });
        }

        if (rosterOpt != null && (rosterOpt < 1 || rosterOpt > 25)) {
            return interaction.reply({ content: '❌ **default_roster_cap** must be between **1** and **25**.', ephemeral: true });
        }

        await updateSystemConfig(guildId, (c) => {
            if (rosterOpt != null) c.factionRankedDefaultRosterCap = rosterOpt;
            if (capsStr != null && String(capsStr).trim()) {
                const parsed = parseContributionCapsCsv(capsStr);
                c.factionRankedContributionCapsByTag = parsed && Object.keys(parsed).length ? parsed : null;
            }
        });

        const cfgAfter = await getSystemConfig(guildId);
        const rosterOut = rankedDefaultRosterCapFromConfig(cfgAfter);
        const capsOut = rankedContributionCapsFromConfig(cfgAfter);
        const capsLine =
            capsOut && Object.keys(capsOut).length
                ? Object.entries(capsOut)
                      .map(([k, v]) => `${k}:${v}`)
                      .join(', ')
                : 'none';
        const rosterAck =
            rosterOpt != null
                ? `• **default_roster_cap**: **${rosterOut}** _(stored; use **max_per_team** on each \`/faction_challenge create\` to enforce it)_\n`
                : '';
        return interaction.reply({
            content:
                `✅ **Ranked war defaults** updated.\n` +
                rosterAck +
                `• Contribution caps (counted score per tag): ${capsLine}\n` +
                `_Contribution caps apply to **official ranked** wars._`,
            ephemeral: true,
        });
    }

    if (interaction.commandName === 'wipe_leaderboard') {
        await User.updateMany({
            guildId,
        }, {
            $set: {
                points: 0,
                weeklyPoints: 0,
                monthlyPoints: 0,
                competitivePoints: 0,
                warPlaygamePersonalPoints: 0,
                warPlaygamePersonalDay: null,
            },
        });
        await interaction.reply({
            content: `✅ Wiped: **${CREDITS}**, weekly/monthly counters, **${ARENA_SCORE}**, and war **daily** personal-cap trackers set to **0** for this server.`,
            ephemeral: true,
        });
        await refreshLeaderboard(client, guildId);
    }

    if (interaction.commandName === 'adjustpoints') {
        const targetDiscord = interaction.options.getUser('user');
        const points = interaction.options.getInteger('points');
        const reason = (interaction.options.getString('reason') || '').trim();

        if (!targetDiscord || targetDiscord.bot || targetDiscord.id === 'SYSTEM') {
            return interaction.reply({ content: `❌ You can only adjust **${CREDITS}** for real users.`, ephemeral: true });
        }
        if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 5000) {
            return interaction.reply({ content: '❌ Invalid amount. Use a non-zero integer between **-5000** and **5000**.', ephemeral: true });
        }
        if (reason.length < 5) {
            return interaction.reply({ content: '❌ Please provide a clear reason (at least 5 characters).', ephemeral: true });
        }

        const targetUser = await getUser(guildId, targetDiscord.id);
        if (points < 0 && (targetUser.points || 0) <= 0) {
            return interaction.reply({ content: `❌ <@${targetDiscord.id}> already has **0** ${CREDITS}.`, ephemeral: true, allowedMentions: { users: [] } });
        }

        const enrolledInWar =
            targetUser.faction &&
            (await isUserEnrolledInActiveFactionChallenge(guildId, targetDiscord.id, targetUser.faction));
        if (points > 0 && enrolledInWar) {
            return interaction.reply({
                content:
                    '❌ Positive manual adjustments are disabled for players **enrolled** in the active faction war. ' +
                    'End the war, adjust someone not on the roster, or use a negative correction.',
                ephemeral: true,
            });
        }

        const label = `admin_adjust:${interaction.user.id}`;
        const { applied, newTotal } = await addManualPointAdjustment(
            client,
            guildId,
            targetDiscord.id,
            points,
            label,
            reason,
        );
        if (applied === 0) {
            return interaction.reply({ content: `❌ No **${CREDITS}** changed for <@${targetDiscord.id}>.`, ephemeral: true, allowedMentions: { users: [] } });
        }

        console.log(
            `[AdminAdjust] guild=${guildId} actor=${interaction.user.id} target=${targetDiscord.id} ` +
            `requested=${points} applied=${applied} reason="${reason.replace(/"/g, "'").slice(0, 180)}"`,
        );

        let replyContent =
            `✅ Adjusted **${CREDITS}** for <@${targetDiscord.id}> by **${applied}**. New balance: **${newTotal}**.\n` +
            `_**${ARENA_SCORE}** and global faction **challenge** standings are unchanged._\n` +
            `Reason: ${reason}`;
        try {
            await targetDiscord.send(
                `Your **${CREDITS}** were adjusted by ${applied} in **${interaction.guild?.name || guildId}** (**${ARENA_SCORE}** unchanged).\nReason: ${reason}`,
            );
        } catch (e) {
            replyContent += `\n(Could not DM the user.)`;
        }
        await interaction.reply({ content: replyContent, ephemeral: true, allowedMentions: { users: [targetDiscord.id] } });
    }

    if (interaction.commandName === 'add_redirect') {
        const user = await getUser(guildId, interaction.user.id);
        if (!user.isPremium) return interaction.reply({ content: "❌ **Custom Redirects** are a Premium feature! Use `/premium` to unlock automated channel management.", ephemeral: true });

        const wordsString = interaction.options.getString('words');
        const channel = interaction.options.getChannel('channel');
        const link = interaction.options.getString('link');
        const customMessage = interaction.options.getString('message');
        
        if (!channel && !link) {
            return interaction.reply({ content: '❌ You must provide either a **channel** or a **link** (or both) for the redirect!', ephemeral: true });
        }

        const words = wordsString.split(',').map(w => w.trim().toLowerCase()).sort();
        const key = words.join(',');

        await updateSystemConfig(guildId, c => {
            if (!c.redirects) c.redirects = new Map();
            c.redirects.set(key, { 
                channelId: channel?.id || null, 
                link: link || null,
                message: customMessage 
            });
        });

        const targetDesc = link ? (channel ? `<#${channel.id}> or ${link}` : link) : `<#${channel.id}>`;
        await interaction.reply({ content: `✅ Added redirect: anyone saying **${words.join(', ')}** will be prompted to go to ${targetDesc}.`, ephemeral: true });
    }

    if (interaction.commandName === 'remove_redirect') {
        const wordsString = interaction.options.getString('words');
        const words = wordsString.split(',').map(w => w.trim().toLowerCase()).sort();
        const key = words.join(',');

        let removed = false;
        await updateSystemConfig(guildId, c => {
            if (c.redirects && (c.redirects.has(key) || c.redirects[key])) {
                if (c.redirects.delete) c.redirects.delete(key);
                else delete c.redirects[key];
                removed = true;
            }
        });

        if (removed) {
            await interaction.reply({ content: `Removed redirect for **${words.join(', ')}**.`, ephemeral: true });
        } else {
            await interaction.reply({ content: `No redirect found for **${words.join(', ')}**.`, ephemeral: true });
        }
    }

    if (interaction.commandName === 'broadcast') {
        if (interaction.user.id !== process.env.DEVELOPER_ID) {
            return interaction.reply({ content: '❌ This command is restricted to the bot developer.', ephemeral: true });
        }
        
        const message = interaction.options.getString('message');
        const guilds = client.guilds.cache;
        let successCount = 0;

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        for (const [id, guild] of guilds) {
            try {
                const config = await getSystemConfig(id);
                const targetChannelId = config.announceChannel;
                if (targetChannelId) {
                    const chan = await client.channels.fetch(targetChannelId);
                    if (chan) {
                        const embed = new EmbedBuilder()
                            .setColor('#0099ff')
                            .setTitle('📢 Global Announcement')
                            .setDescription(message)
                            .setTimestamp()
                            .setFooter({ text: 'Message from PlayBound Developers' });
                        await chan.send({ embeds: [embed] });
                        successCount++;
                    }
                }
            } catch(e) { console.error(`Broadcast failed for guild ${id}:`, e); }
        }

        await interaction.editReply({ content: `✅ Broadcast sent to **${successCount}** servers!` });
    }

    if (interaction.commandName === 'premium_analytics') {
        if (interaction.user.id !== process.env.DEVELOPER_ID) {
            return interaction.reply({ content: '❌ This command is restricted to the bot developer.', ephemeral: true });
        }
        return executePremiumAnalytics(interaction);
    }

    if (interaction.commandName === 'admin_premium') {
        if (interaction.user.id !== process.env.DEVELOPER_ID) {
            return interaction.reply({ content: '❌ This command is restricted to the bot developer.', ephemeral: true });
        }

        const target = interaction.options.getUser('user');
        const action = interaction.options.getString('action');
        const source = interaction.options.getString('source') || 'stripe';

        if (action === 'grant') {
            const modifiedTotal = await mongoRouter.updateUserByDiscordIdEverywhere(target.id, {
                isPremium: true,
                premiumSource: source,
            });
            if (modifiedTotal > 0) {
                await trackPremiumConversion({ userId: target.id, source: 'admin' }).catch(() => {});
            }
            await interaction.reply({ content: `✅ Granted Premium to <@${target.id}> (Source: ${source})`, ephemeral: true });
        } else {
            await mongoRouter.updateUserByDiscordIdEverywhere(target.id, { isPremium: false, premiumSource: null });

            await mongoRouter.forEachUserDocumentByDiscordId(target.id, async (u) => {
                if (u.currentCosmetics) {
                    let changed = false;
                    const premiumIds = ['premium_badge_diamond', 'premium_color_crystal'];
                    for (const [slot, itemId] of u.currentCosmetics.entries()) {
                        if (premiumIds.includes(itemId)) {
                            u.currentCosmetics.delete(slot);
                            changed = true;
                        }
                    }
                    if (changed) {
                        u.markModified('currentCosmetics');
                        await u.save();
                    }
                }
            });
            await interaction.reply({ content: `🛑 Revoked Premium from <@${target.id}>`, ephemeral: true });
        }
    }

    if (interaction.commandName === 'dev_points') {
        if (interaction.user.id !== process.env.DEVELOPER_ID) {
            return interaction.reply({ content: '❌ This command is restricted to the bot developer.', ephemeral: true });
        }
        const sub = interaction.options.getSubcommand();
        const target = interaction.options.getUser('user') || interaction.user;
        const u = await getUser(guildId, target.id);
        if (sub === 'add') {
            const amount = interaction.options.getInteger('amount');
            u.points = (u.points || 0) + amount;
            u.weeklyPoints = (u.weeklyPoints || 0) + amount;
            u.monthlyPoints = (u.monthlyPoints || 0) + amount;
            await u.save();
            return interaction.reply({
                content: `✅ Added **${amount.toLocaleString()}** **${CREDITS}** to <@${target.id}> in this server. New balance: **${u.points.toLocaleString()}**.`,
                ephemeral: true,
            });
        }
        if (sub === 'set') {
            const amount = interaction.options.getInteger('amount');
            u.points = amount;
            await u.save();
            return interaction.reply({
                content: `✅ Set <@${target.id}> to **${u.points.toLocaleString()}** **${CREDITS}** (this server).`,
                ephemeral: true,
            });
        }
    }

    if (interaction.commandName === 'blacklist') {
        if (!interaction.member.permissions.has('Administrator') && interaction.user.id !== process.env.DEVELOPER_ID) {
            return interaction.reply({ content: '❌ You need Administrator permissions to use this command.', ephemeral: true });
        }
        const target = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason');
        const result = await User.updateMany({ userId: target.id }, { isBlacklisted: true, blacklistReason: reason });
        if (result.modifiedCount === 0) {
            return interaction.reply({ content: `⚠️ No records found for <@${target.id}>. They may not have interacted with the bot yet.`, ephemeral: true });
        }
        console.log(`[Blacklist] User ${target.id} blacklisted by ${interaction.user.id}. Reason: ${reason}`);
        await interaction.reply({ content: `🚫 <@${target.id}> has been blacklisted.\nReason: **${reason}**\n(${result.modifiedCount} server records updated)`, ephemeral: true });
    }

    if (interaction.commandName === 'unblacklist') {
        if (!interaction.member.permissions.has('Administrator') && interaction.user.id !== process.env.DEVELOPER_ID) {
            return interaction.reply({ content: '❌ You need Administrator permissions to use this command.', ephemeral: true });
        }
        const target = interaction.options.getUser('user');
        const result = await User.updateMany({ userId: target.id }, { isBlacklisted: false, blacklistReason: null });
        if (result.modifiedCount === 0) {
            return interaction.reply({ content: `⚠️ No records found for <@${target.id}>.`, ephemeral: true });
        }
        console.log(`[Blacklist] User ${target.id} unblacklisted by ${interaction.user.id}.`);
        await interaction.reply({ content: `✅ <@${target.id}> has been unblacklisted. (${result.modifiedCount} server records updated)`, ephemeral: true });
    }

    if (interaction.commandName === 'daily') {
        const user = await getUser(guildId, interaction.user.id);
        const now = Date.now();
        
        // Cooldown: 24h for normal users, 12h for premium
        const cooldown = user.isPremium ? 43200000 : 86400000;
        
        if (user.lastDailyClaim && (now - user.lastDailyClaim) < cooldown) {
            const remaining = cooldown - (now - user.lastDailyClaim);
            const hrs = Math.floor(remaining / 3600000);
            const mins = Math.floor((remaining % 3600000) / 60000);
            return interaction.reply({ content: `⏳ You have already claimed your daily **${CREDITS}**. Come back in **${hrs}h ${mins}m**!`, ephemeral: true });
        }

        // Base reward 50-100, Premium gets an extra 50
        const reward = Math.floor(Math.random() * 51) + 50 + (user.isPremium ? 50 : 0);

        const claim = await claimDailyAtomic(guildId, interaction.user.id, reward, now);
        if (!claim.ok) {
            const remaining = claim.remainingMs || cooldown;
            const hrs = Math.floor(remaining / 3600000);
            const mins = Math.floor((remaining % 3600000) / 60000);
            return interaction.reply({ content: `⏳ You have already claimed your daily **${CREDITS}**. Come back in **${hrs}h ${mins}m**!`, ephemeral: true });
        }

        const prefix = user.isPremium ? '💎 Premium Daily!' : '📅 Daily Reward!';
        let dailyBody = `${prefix} You claimed **${reward} ${CREDITS}**! Come back tomorrow for more.`;
        if (!user.isPremium) {
            const uCheck = await getUser(guildId, interaction.user.id);
            if (shouldShowPremiumPrompt(uCheck)) {
                dailyBody +=
                    '\n\n💡 **Premium users:**\n• Claim every **12 hours**\n• **Bonus** rewards on the roll\n\nUse `/premium`';
                await trackPremiumPromptShown({
                    userId: interaction.user.id,
                    guildId,
                    trigger: 'daily',
                    metadata: {
                        rewardAmount: reward,
                        streak: user.currentStreak,
                        cooldownHoursShown: 12,
                    },
                }).catch(() => {});
                await markPremiumPromptShown(guildId, interaction.user.id);
            }
        }
        await interaction.reply({ content: dailyBody, ephemeral: true });
    }

    if (interaction.commandName === 'pay') {
        const targetUser = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');

        if (targetUser.id === interaction.user.id) {
            return interaction.reply({ content: "❌ You cannot pay yourself!", ephemeral: true });
        }
        if (targetUser.bot) {
            return interaction.reply({ content: "❌ You cannot pay bots!", ephemeral: true });
        }
        if (amount <= 0) {
            return interaction.reply({ content: "❌ Amount must be greater than zero.", ephemeral: true });
        }

        const transfer = await transferCreditsAtomic(guildId, interaction.user.id, targetUser.id, amount);
        if (!transfer.ok) {
            if (transfer.reason === 'insufficient_funds') {
                return interaction.reply({
                    content: `❌ Not enough **${CREDITS}**. (Balance: **${transfer.balance || 0}**)`,
                    ephemeral: true,
                });
            }
            return interaction.reply({ content: '❌ Transfer failed. Please try again.', ephemeral: true });
        }

        await interaction.reply({ content: `💸 **Transfer complete!**\nYou sent **${amount} ${CREDITS}** to <@${targetUser.id}>.` });
    }

    if (interaction.commandName === 'duel_trivia' || interaction.commandName === 'duel') {
        const targetUser = interaction.options.getUser('user');
        const bet = interaction.options.getInteger('bet');

        if (targetUser.id === interaction.user.id) return interaction.reply({ content: "❌ You cannot duel yourself!", ephemeral: true });
        if (targetUser.bot) return interaction.reply({ content: "❌ You cannot duel a bot!", ephemeral: true });
        if (bet <= 0) return interaction.reply({ content: "❌ Bet must be greater than zero.", ephemeral: true });

        const challenger = await getUser(guildId, interaction.user.id);
        if (challenger.points < bet) {
            return interaction.reply({
                content: `❌ You don't have enough **${CREDITS}** to bet **${bet.toLocaleString()}**.\n🪙 **Your balance:** **${challenger.points.toLocaleString()}**`,
                ephemeral: true,
            });
        }

        const opponent = await getUser(guildId, targetUser.id);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('duel_accept').setLabel('⚔️ Accept Duel').setStyle(ButtonStyle.Danger)
        );

        const flair = pickDuelChallengeFlair();
        const challengeEmbed = new EmbedBuilder()
            .setColor(flair.color)
            .setTitle('⚔️ Trivia duel challenge!')
            .setDescription(
                `<@${targetUser.id}> — **<@${interaction.user.id}>** wants a **1v1 trivia duel** (one question, first correct wins the pot; wrong answer loses).\n\n` +
                    `**Stake:** **${bet.toLocaleString()}** ${CREDITS} each · **Pot:** **${(bet * 2).toLocaleString()}** to the winner\n\n` +
                    `🪙 **Balances:** Challenger **${challenger.points.toLocaleString()}** · Opponent **${opponent.points.toLocaleString()}**\n` +
                    `_Opponent needs **${bet.toLocaleString()}**+ **${CREDITS}** to accept._\n\n` +
                    `**Battle cry:** ${flair.quote}\n\n` +
                    `Use **Accept Duel** below to lock in and play.`,
            )
            .setImage(flair.imageUrl)
            .setFooter({ text: 'PlayBound · /duel is trivia-only · Faction wars use /faction_challenge' });

        const msg = await interaction.reply({
            content: `<@${targetUser.id}> — you've been challenged!`,
            embeds: [challengeEmbed],
            components: [row],
            fetchReply: true,
        });

        const timeoutHandle = setTimeout(() => {
            activeDuels.delete(msg.id);
            msg.edit({ content: `⌛ Duel cancelled. <@${targetUser.id}> did not respond in time.`, components: [] }).catch(()=>{});
        }, 60000);

        activeDuels.set(msg.id, {
            challengerId: interaction.user.id,
            targetId: targetUser.id,
            bet: bet,
            state: 'pending',
            timeoutHandle
        });
    }

    if (interaction.commandName === 'tournament') {
        const handled = await tournamentGame.handleInteraction(interaction, client);
        if (handled) return;
    }

    if (interaction.commandName === 'set_role_reward') {
        const achKey = interaction.options.getString('achievement').trim();
        const role = interaction.options.getRole('role');
        const cfg = await getSystemConfig(guildId);
        if (!resolveAchievementMeta(achKey, cfg)) {
            return interaction.reply({
                content: '❌ Unknown achievement key. Use a built-in key (e.g. `FIRST_WIN`, `TRIVIA_KING`) or a `CUSTOM_*` key from `/achievement list`.',
                ephemeral: true,
            });
        }

        await updateSystemConfig(guildId, (c) => {
            if (!c.roleRewards) c.roleRewards = new Map();
            c.roleRewards.set(achKey, role.id);
        });
        await interaction.reply({ content: `✅ Achievement **${achKey}** will now grant the <@&${role.id}> role!`, ephemeral: true });
    }

    if (interaction.commandName === 'achievement') {
        const sub = interaction.options.getSubcommand();
        const MAX_CUSTOM = 40;

        if (sub === 'create') {
            const key = interaction.options.getString('key').trim().toUpperCase().replace(/\s+/g, '_');
            const name = interaction.options.getString('name').trim();
            const desc = interaction.options.getString('description').trim();
            const emojiRaw = interaction.options.getString('emoji');
            const emojiNorm = normalizeAchievementEmoji(emojiRaw);
            if (emojiRaw != null && String(emojiRaw).trim() !== '' && emojiNorm == null) {
                return interaction.reply({
                    content: '❌ Invalid **emoji**. Use a Unicode emoji, or paste a custom emoji from this server (`<:name:id>`).',
                    ephemeral: true,
                });
            }
            if (!CUSTOM_ACHIEVEMENT_KEY.test(key)) {
                return interaction.reply({
                    content: '❌ Key must look like `CUSTOM_SOMETHING` (uppercase `CUSTOM_` + letters, numbers, underscores).',
                    ephemeral: true,
                });
            }
            if (ACHIEVEMENTS[key]) {
                return interaction.reply({ content: '❌ That key is reserved for a built-in achievement.', ephemeral: true });
            }
            try {
                await updateSystemConfig(guildId, (c) => {
                    if (!c.customAchievements) c.customAchievements = [];
                    if (c.customAchievements.length >= MAX_CUSTOM) throw new Error('MAX');
                    if (c.customAchievements.some((x) => x.key === key)) throw new Error('DUP');
                    const row = { key, name, desc };
                    if (emojiNorm) row.emoji = emojiNorm;
                    c.customAchievements.push(row);
                });
            } catch (e) {
                if (e.message === 'MAX') {
                    return interaction.reply({
                        content: `❌ This server already has ${MAX_CUSTOM} custom achievements. Delete one with \`/achievement delete\` first.`,
                        ephemeral: true,
                    });
                }
                if (e.message === 'DUP') {
                    return interaction.reply({ content: '❌ An achievement with that key already exists.', ephemeral: true });
                }
                throw e;
            }
            const showEm = emojiNorm ? `${emojiNorm} ` : '';
            return interaction.reply({ content: `✅ Created **${key}**: ${showEm}**${name}**`, ephemeral: true });
        }

        if (sub === 'delete') {
            const key = interaction.options.getString('key').trim().toUpperCase().replace(/\s+/g, '_');
            if (!CUSTOM_ACHIEVEMENT_KEY.test(key)) {
                return interaction.reply({ content: '❌ Only **CUSTOM_*** keys defined on this server can be deleted.', ephemeral: true });
            }
            let removed = false;
            await updateSystemConfig(guildId, (c) => {
                if (!c.customAchievements) return;
                const next = c.customAchievements.filter((x) => x.key !== key);
                removed = next.length < c.customAchievements.length;
                c.customAchievements = next;
                if (removed && c.roleRewards?.delete) c.roleRewards.delete(key);
            });
            if (!removed) {
                return interaction.reply({ content: '❌ No custom achievement with that key.', ephemeral: true });
            }
            return interaction.reply({
                content: `✅ Removed **${key}**. Users who already earned it still have the key until you \`/achievement revoke\`.`,
                ephemeral: true,
            });
        }

        if (sub === 'list') {
            const cfg = await getSystemConfig(guildId);
            const list = cfg.customAchievements || [];
            if (list.length === 0) {
                return interaction.reply({ content: 'No custom achievements yet. Use `/achievement create`.', ephemeral: true });
            }
            const body = list.map((a) => `**${a.key}** — ${formatAchievementLabel(a)}\n_${a.desc}_`).join('\n\n');
            const text = `📋 **Custom achievements (${list.length})**\n\n${body}`;
            return interaction.reply({ content: text.slice(0, 2000), ephemeral: true });
        }

        if (sub === 'grant') {
            const target = interaction.options.getUser('user');
            const achKey = interaction.options.getString('key').trim();
            if (target.bot) {
                return interaction.reply({ content: '❌ Cannot grant achievements to bots.', ephemeral: true });
            }
            const cfg = await getSystemConfig(guildId);
            const meta = resolveAchievementMeta(achKey, cfg);
            if (!meta) {
                return interaction.reply({
                    content: '❌ Unknown achievement key. Use `/achievement list` or a built-in key like `FIRST_WIN`.',
                    ephemeral: true,
                });
            }
            const u = await getUser(guildId, target.id);
            if (u.achievements.includes(achKey)) {
                return interaction.reply({ content: `**${target.username}** already has **${meta.name}**.`, ephemeral: true });
            }
            await awardAchievement(client, guildId, interaction.channel, target.id, achKey);
            const em = meta.emoji ? `${meta.emoji} ` : '';
            return interaction.reply({
                content: `✅ Granted ${em}**${meta.name}** (\`${achKey}\`) to **${target.username}**.`,
                ephemeral: true,
            });
        }

        if (sub === 'revoke') {
            const target = interaction.options.getUser('user');
            const achKey = interaction.options.getString('key').trim();
            const u = await getUser(guildId, target.id);
            if (!u.achievements.includes(achKey)) {
                return interaction.reply({ content: `**${target.username}** does not have \`${achKey}\`.`, ephemeral: true });
            }
            await revokeAchievement(client, guildId, target.id, achKey);
            return interaction.reply({ content: `✅ Removed \`${achKey}\` from **${target.username}**.`, ephemeral: true });
        }
    }

    if (interaction.commandName === 'shop') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const user = await getUser(guildId, interaction.user.id);
        const globalItems = await ShopItem.find();
        const config = await getSystemConfig(guildId);
        const serverItems = config.shopItems || [];
        const { embeds, components } = buildShopCatalog(globalItems, serverItems, {
            userPoints: user.points ?? 0,
            catalogKind: 'shop',
            viewerId: interaction.user.id,
            developerFreeShop: isBotDeveloper(interaction.user.id),
            user,
            member: interaction.member,
        });
        if (components.length === 0) {
            return interaction.editReply({ embeds });
        }
        return interaction.editReply({ embeds, components });
    }

    if (interaction.commandName === 'buy') {
        const itemId = interaction.options.getString('item');
        const config = await getSystemConfig(guildId);
        
        if (!itemId) {
            await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
            const user = await getUser(guildId, interaction.user.id);
            const globalItems = await ShopItem.find();
            const serverItems = config.shopItems || [];
            const { embeds, components } = buildShopCatalog(globalItems, serverItems, {
                userPoints: user.points ?? 0,
                catalogKind: 'buy',
                viewerId: interaction.user.id,
                developerFreeShop: isBotDeveloper(interaction.user.id),
                user,
                member: interaction.member,
            });
            if (components.length === 0) {
                return interaction.editReply({ embeds });
            }
            return interaction.editReply({ embeds, components });
        }

        let item = await ShopItem.findOne({ id: itemId });

        if (!item && config.shopItems) {
            item = config.shopItems.find(i => i.id === itemId);
        }

        if (!item) return interaction.reply({ content: 'Invalid item ID!', ephemeral: true });

        const user = await getUser(guildId, interaction.user.id);

        if (isDuplicateShopPurchase(user, interaction.member, item)) {
            const dupMsg =
                item.type === 'role'
                    ? '❌ You already have this Discord role.'
                    : '❌ You already own this item (in your inventory or equipped).';
            return interaction.reply({ content: dupMsg, ephemeral: true });
        }

        if (item.premiumOnly && !user.isPremium) {
            return interaction.reply({ content: `This item is exclusive to Premium subscribers!`, ephemeral: true });
        }

        const devShopFreeBuy = isBotDeveloper(interaction.user.id);
        if (!devShopFreeBuy && user.points < item.price) {
            return interaction.reply({ content: `You don't have enough **${CREDITS}**! (Need **${item.price}**, have **${user.points}**)`, ephemeral: true });
        }

        // If it's a role, grant it immediately instead of inventory
        if (item.type === 'role') {
            try {
                const member = await interaction.guild.members.fetch(interaction.user.id);
                await member.roles.add(item.roleId);
                if (!devShopFreeBuy) user.points -= item.price;
                await user.save();
                return interaction.reply({ content: `✅ Successfully bought and equipped role **${item.name}**!`, ephemeral: true });
            } catch (err) {
                return interaction.reply({ content: `❌ Failed to assign role! Ensure the bot has correct permissions.`, ephemeral: true });
            }
        }

        if (!user.inventory) user.inventory = [];
        if (!devShopFreeBuy) user.points -= item.price;
        user.inventory.push(item.id);
        await user.save();

        await interaction.reply({ content: `✅ Successfully bought **${item.name}**! Check your \`/inventory\`.`, ephemeral: true });
    }

    if (interaction.commandName === 'inventory') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const user = await getUser(guildId, interaction.user.id);
        if (!user.inventory || user.inventory.length === 0) return interaction.editReply({ content: 'Your inventory is empty.' });

        const counts = {};
        user.inventory.forEach(id => { counts[id] = (counts[id] || 0) + 1; });

        const globalItems = await ShopItem.find({ id: { $in: Object.keys(counts) } });
        const config = await getSystemConfig(guildId);
        const serverItems = config.shopItems || [];

        const listLines = [];
        const equipOptions = [];

        Object.entries(counts).forEach(([id, count]) => {
            const item = globalItems.find(i => i.id === id) || serverItems.find(i => i.id === id);
            const itemName = item?.name || id;
            listLines.push(`**${itemName}** x${count}`);

            // Only add cosmetics to equip dropdown
            if (item && item.type !== 'consumable' && item.type !== 'role') {
                equipOptions.push({ label: itemName.substring(0, 100), description: `Equip this item`.substring(0, 100), value: item.id.substring(0, 100) });
            }
        });

        // Show equipped items
        let equippedStr = '';
        if (user.currentCosmetics && user.currentCosmetics.size > 0) {
            equippedStr = '\n\n**Equipped:**\n\n';
            user.currentCosmetics.forEach((val, key) => {
                const item = globalItems.find(i => i.id === val) || serverItems.find(i => i.id === val);
                equippedStr += `• ${key}: **${item?.name || val}**\n\n`;
            });
        }

        const list = listLines.join('\n\n');
        const embed = new EmbedBuilder().setColor('#0099ff').setTitle('🎒 Your Inventory').setDescription(list + equippedStr);

        if (equipOptions.length > 0) {
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('inventory_equip_select')
                    .setPlaceholder('Select an item to equip')
                    .addOptions(equipOptions.slice(0, 25))
            );
            await interaction.editReply({ embeds: [embed], components: [row] });
        } else {
            await interaction.editReply({ embeds: [embed] });
        }
    }
    if (interaction.commandName === 'equip') {
        const itemId = interaction.options.getString('item');
        const user = await getUser(guildId, interaction.user.id);

        if (!user.inventory.includes(itemId)) {
            return interaction.reply({ content: `You don't have this item in your inventory!`, ephemeral: true });
        }

        let item = await ShopItem.findOne({ id: itemId });
        const config = await getSystemConfig(guildId);
        if (!item && config.shopItems) {
            item = config.shopItems.find(i => i.id === itemId);
        }

        if (!item || (item.type !== 'cosmetic' && item.type !== 'badge' && item.type !== 'color')) {
            return interaction.reply({ content: `This item cannot be equipped.`, ephemeral: true });
        }

        // Determine type of slot (badge or color)
        let slot = item.type;
        if (item.type === 'cosmetic') {
            if (item.id.includes('color')) slot = 'color';
            else if (item.id.includes('badge')) slot = 'badge';
            else slot = 'misc';
        }

        if (!user.currentCosmetics) user.currentCosmetics = new Map();
        user.currentCosmetics.set(slot, item.id);
        await user.save();

        await interaction.reply({ content: `✅ Equipped **${item.name}** in the ${slot} slot!`, ephemeral: true });
    }

    if (interaction.commandName === 'server_shop_add') {
        if (!await checkManager(interaction)) return;

        const user = await getUser(guildId, interaction.user.id);
        if (!user.isPremium) return interaction.reply({ content: "❌ **Server Pro Shops** are a Premium feature! Use `/premium` to unlock custom server economies.", ephemeral: true });

        const id = interaction.options.getString('id');        const name = interaction.options.getString('name');
        const price = interaction.options.getInteger('price');
        const desc = interaction.options.getString('desc');
        const type = interaction.options.getString('type');
        const role = interaction.options.getRole('role');

        if (type === 'role' && !role) {
            return interaction.reply({ content: "You must specify a role if the type is 'role'.", ephemeral: true });
        }

        const newItem = { id, name, price, desc, type, premiumOnly: false };
        if (type === 'role') newItem.roleId = role.id;

        await updateSystemConfig(guildId, c => {
            if (!c.shopItems) c.shopItems = [];
            c.shopItems = c.shopItems.filter(i => i.id !== id);
            c.shopItems.push(newItem);
        });

        await interaction.reply({ content: `✅ Added **${name}** to the server shop!`, ephemeral: true });
    }

    if (interaction.commandName === 'server_shop_remove') {
        if (!await checkManager(interaction)) return;

        const id = interaction.options.getString('id');
        await updateSystemConfig(guildId, c => {
            if (!c.shopItems) c.shopItems = [];
            c.shopItems = c.shopItems.filter(i => i.id !== id);
        });

        await interaction.reply({ content: `✅ Removed item **${id}** from the server shop.`, ephemeral: true });
    }
    if (interaction.commandName === 'set_birthday') {
        const dateStr = interaction.options.getString('date');
        const force = interaction.options.getBoolean('force');
        
        if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(dateStr)) {
            return interaction.reply({ content: "Invalid format! Please use MM-DD (e.g. 05-24 for May 24th).", ephemeral: true });
        }
        
        const user = await getUser(guildId, interaction.user.id);
        
        if (user.birthday && !user.isPremium) {
            return interaction.reply({ content: "You have already set your birthday! You need PlayBound Premium to change it.", ephemeral: true });
        }
        
        if (user.birthday && user.isPremium && !force) {
            return interaction.reply({ content: "You already have a birthday set. To change it, run this command again with the `force` option set to True.", ephemeral: true });
        }

        await updateUser(guildId, interaction.user.id, u => u.birthday = dateStr);
        await interaction.reply({ content: `✅ Your birthday has been set to ${dateStr}!`, ephemeral: true });
    }

    if (interaction.commandName === 'premium') {
        await trackPremiumPromptShown({
            userId: interaction.user.id,
            guildId,
            trigger: 'premium_command',
            metadata: { entryPoint: 'command', guildId },
        }).catch(() => {});

        const playerEmbed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('💎 PlayBound Premium')
            .setDescription(
                '**For players:** rank up faster, stand out on the leaderboard, and be the host people thank for bigger payouts.\n\n' +
                'Premium is per **Discord account** — your perks follow you in every server where you use PlayBound.'
            )
            .addFields(
                {
                    name: '🏆 Climb the leaderboard faster',
                    value: `**2×** **${ARENA_SCORE.toLowerCase()}** from games you play. Streak bonus up to **+12** per score (free: **+5**).\n\n\`/daily\` every **12h** (not 24h) with **+50** extra on the roll — more claims, bigger rewards.`,
                },
                {
                    name: '✨ Host bigger sessions & boost the lobby',
                    value: `Higher round/question caps when **you** host Trivia, Movie Quotes, Sprint, Unscramble & Name That Tune.\n\n**Host aura:** everyone in that game earns **~1.35×** **${ARENA_SCORE.toLowerCase()}** — stacks with your **2×** if you play too.\n\n**Not the host?** If you have Premium, use the **✨ Boost session** button in the game thread so the lobby still gets aura when a mod starts the game.`,
                },
                {
                    name: '🚀 Autopilot',
                    value: 'Set `repeat_hrs` on supported games so rounds keep running without you babysitting the bot.',
                },
                {
                    name: '🎨 Look exclusive',
                    value: 'Diamond badge & Crystal name color in `/shop`. Default **💎** on `/leaderboard` when you are not wearing another badge.',
                },
                {
                    name: '🎂 Your profile, your rules',
                    value: 'Change your birthday after the first set with `/set_birthday` (`force: true`).',
                },
                {
                    name: '🔁 Factions',
                    value: '**`/faction switch`** — Premium only (**7-day** cooldown). **`/faction leave`** then **`/faction join`** for free users (**7-day** wait after leave before joining again). **`/faction_rename`** + **`/faction_emoji`** = local labels. **`/factions`** = global board.',
                },
                {
                    name: '📣 Invites',
                    value: '**`/invite`** — bot link + your referral code. New server: admin **`/claim_referral`**. **`/invites`** stats · **`/invite_leaderboard`** (global).',
                },
                {
                    name: '🛡️ Also included if you run the server',
                    value:
                        'Custom server shop items (`/server_shop_add`), scheduled announcements, keyword redirects, bulk role tools, **faction challenge** tools, and optional **`/set_faction_reminder_channel`** + **`/set_faction_victory_role`** (where you have **Administrator** or **Bot Manager**).\n\nFaction challenges themselves can also be run by a configured **Faction Leader** role (`/set_faction_leader_role`) — that role does **not** unlock other admin tools.',
                },
            )
            .setFooter({ text: 'Subscribing helps keep PlayBound running — thank you!' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Subscribe Monthly')
                .setStyle(ButtonStyle.Link)
                .setURL(process.env.STRIPE_PAYMENT_LINK_MONTHLY || 'https://buy.stripe.com/monthly'),
            new ButtonBuilder()
                .setLabel('Subscribe Yearly (Save 11%)')
                .setStyle(ButtonStyle.Link)
                .setURL(process.env.STRIPE_PAYMENT_LINK_YEARLY || 'https://buy.stripe.com/yearly')
        );
        const portal = (process.env.STRIPE_CUSTOMER_PORTAL_URL || '').trim();
        const support = (process.env.SUPPORT_SERVER_INVITE || '').trim();
        const extraButtons = [];
        if (portal) {
            extraButtons.push(
                new ButtonBuilder()
                    .setLabel('Manage / Cancel Subscription')
                    .setStyle(ButtonStyle.Link)
                    .setURL(portal),
            );
        }
        if (support) {
            extraButtons.push(
                new ButtonBuilder()
                    .setLabel('Billing Help')
                    .setStyle(ButtonStyle.Link)
                    .setURL(support),
            );
        }
        const components = [row];
        if (extraButtons.length > 0) {
            components.push(new ActionRowBuilder().addComponents(extraButtons.slice(0, 5)));
        }

        await interaction.reply({ embeds: [playerEmbed], components, ephemeral: true });
    }

    if (interaction.commandName === 'support') {
        const invite = process.env.SUPPORT_SERVER_INVITE || 'Support server not yet set.';
        await interaction.reply({ content: `🛠️ Need help or have a question? Join our support server: ${invite}`, ephemeral: true });
    }

    if (interaction.commandName === 'invite') {
        return handleInviteCommand(interaction);
    }
    if (interaction.commandName === 'invites') {
        return handleInvitesCommand(interaction);
    }
    if (interaction.commandName === 'claim_referral') {
        return handleClaimReferralCommand(interaction);
    }
    if (interaction.commandName === 'faction_recruit') {
        return handleFactionRecruitCommand(interaction);
    }
    if (interaction.commandName === 'faction_redeem') {
        return handleFactionRedeemCommand(interaction, client);
    }
    if (interaction.commandName === 'invite_leaderboard') {
        return handleInviteLeaderboardCommand(interaction, client);
    }

    if (interaction.commandName === 'help') {        const invite = process.env.SUPPORT_SERVER_INVITE;
        const e = new EmbedBuilder().setColor('#0099ff').setTitle('🎮 PlayBound Guide')
            .addFields(
                { name: '🪙 Credits vs Arena score', value: creditsVsArenaBlurb() },
                {
                    name: '▶️ Play now (official)',
                    value:
                        '**`/playgame`** — daily **platform** mini-games.\n\nThese are the **main** way to play and the **only** games that can count toward **ranked** faction wars (when enrolled + war rules allow).',
                },
                {
                    name: '🎛️ Host your own (casual)',
                    value:
                        '**`/trivia`**, **`/triviasprint`**, **`/unscramble`**, **`/moviequotes`**, **`/namethattune`**, **`/caption`**, **`/spellingbee`**, **`/guessthenumber`**, **`/startserverdle`**, giveaways, etc. — **hosted** games for fun & server events.\n\nThey **do not** add points to **ranked** wars; casual / **unranked** challenges may still count them if configured.',
                },
                       { name: '⚔️ Duels & factions', value: '`/duel` — **1v1 trivia** (hosted; duel rating is **separate** from war score). **Global faction** (`/faction join`).\n\n**`/factions`** = **Official Faction Rankings** (**ranked** war match points only). **`/faction server`** = server activity.\n\n**`/faction_challenge`** — **ranked** = **/playgame** only for scoring; **unranked** = local, hosted allowed if filter says so. **`/warstatus`** = phase & leader. **Premium** + manager/leader to create. `/set_faction_challenge_defaults`, `/set_faction_ranked_rules`, `/set_faction_leader_role`. **2 duels + 1 royale**/UTC day. `/faction_recruit` · `/leaderboard_history`.\n\n**`/missions`** · **`/claim_mission_rewards`** · **`/featured`** (UTC highlights).' },
                       { name: '📣 Grow', value: '`/invite` + `/invites`\n\nAdmin `/claim_referral` in new servers · `/invite_leaderboard`.' },
                       { name: '👤 Profile & shop', value: `\`/profile\` — scores, **faction** (server + official name), **badges** on **server activity** board, ledger.\n\n**Premium:** \`/profile user:@member\`.\n\n\`/leaderboard\` = **Server activity rankings** (**${CREDITS}**; not global faction board). Game \`points\` cap **${MAX_POINTS_PER_PLACEMENT}**. \`/inventory\` & \`/shop\` private.` },
                       { name: '🎁 Giveaways', value: 'Join active giveaways with the 🎉 button in game threads.' },
                       { name: '🛠️ Support', value: invite ? `[Join Support Server](${invite})` : 'Use `/ticket` for bugs, suggestions, and help.' },
            );
        await interaction.reply({ embeds: [e], ephemeral: true });
    }

    
    // --- SUPPORT SYSTEM ---
    if (interaction.commandName === 'listgames') {        const games = await Game.find({ guildId, status: 'active' });

        let msg = '**Active Games:**\n';
        if (games.length === 0) msg += 'No active games.\n';
        else {
            games.forEach((g, i) => {
                msg += `${i+1}. **${g.type}** in <#${g.channelId}> (ID: \`${g.threadId || 'None'}\`) - Started: ${g.startTime.toLocaleString()}\n`;
            });
        }

        msg += '\n**Scheduled Games:**\n';
        const guildScheduled = Array.from(scheduledGames.values()).filter(g => g.guildId === guildId);
        if (guildScheduled.length === 0) msg += 'No scheduled games.\n';
        else {
            guildScheduled.forEach((g, i) => {
                msg += `${i+1}. **${g.type}** in <#${g.channelId}> (ID: \`${g.id}\`) - Starts at: ${g.startTime.toLocaleString()}\n`;
            });
        }

        await interaction.reply({ content: msg, ephemeral: true });
    }
    if (interaction.commandName === 'endgame') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const id = interaction.options.getString('thread_id'); // Can be SID or Thread ID
        let gameEnded = false;

        if (id) {
            // Check if it's a scheduled game SID
            if (scheduledGames.has(id)) {
                const sched = scheduledGames.get(id);
                if (sched.guildId === guildId) {
                    clearTimeout(sched.timeoutHandle);
                    scheduledGames.delete(id);
                    await Game.findOneAndUpdate({ 'state.sid': id }, { status: 'ended' });
                    return interaction.editReply({ content: `✅ Cancelled scheduled **${sched.type}** (ID: \`${id}\`).` });
                }
            }

            // --- INTERACTIVE GIVEAWAY CANCELLATION ---
            const giveaway = activeGiveaways.get(id);
            if (giveaway) {
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`cancel_giv_winner_${id}`).setLabel('🏆 Pick Winner Now').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`cancel_giv_void_${id}`).setLabel('❌ Cancel Entirely').setStyle(ButtonStyle.Danger)
                );
                return interaction.editReply({ content: '❓ How would you like to end this giveaway?', components: [row] });
            }

            const dbGame = await endActiveGame(id, client);
            if (dbGame) {
                gameEnded = true;
                // Also try to end it in memory if it exists
                guessthenumberGame.forceEnd(client, id);
                spellingBeeGame.forceEnd(client, id);
                serverdleGame.forceEnd(client, id);
                triviaGame.forceEnd(client, id);
                if (activeSprints.has(id)) { triggerTriviaSprintEnd(id); }
                if (activeCaptions.has(id)) { triggerCaptionEnd(id); }
                if (activeTunes.has(id)) { triggerTuneEnd(id); }
                if (activeMovieGames.has(id)) { triggerMovieEnd(id); }
                if (activeUnscrambles.has(id)) { triggerUnscrambleEnd(id); }
            }
        } else {
            // Build dropdown for all games
            const options = [];
            
            // 1. Scheduled (Delayed) Games
            const guildScheduled = Array.from(scheduledGames.values()).filter(g => g.guildId === guildId);
            guildScheduled.forEach(g => {
                options.push({ label: `⏰ [Scheduled] ${g.type}`.substring(0, 100), description: `ID: ${g.id} (Starts: ${g.startTime.toLocaleString()})`.substring(0, 100), value: `end_sched_${g.id}`.substring(0, 100) });
            });

            // 2. Recurring Games
            const guildRecurring = await RecurringGame.find({ guildId });
            guildRecurring.forEach(g => {
                options.push({ label: `🔁 [Recurring] ${g.type}`.substring(0, 100), description: `ID: ${g._id} (Every ${g.intervalHours}h)`.substring(0, 100), value: `end_recur_${g._id}`.substring(0, 100) });
            });

            // 3. Active Games
            const guildActive = await Game.find({ guildId, status: 'active' });
            guildActive.forEach(g => {
                const threadIdStr = g.threadId || g._id.toString();
                options.push({ label: `▶️ [Active] ${g.type}`.substring(0, 100), description: `Thread/Msg: ${threadIdStr}`.substring(0, 100), value: `end_active_${threadIdStr}`.substring(0, 100) });
            });

            if (options.length === 0) {
                return interaction.editReply({ content: 'No active, scheduled, or recurring games found in this server!' });
            }

            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('endgame_select')
                    .setPlaceholder('Select a game to terminate')
                    .addOptions(options.slice(0, 25))
            );

            return interaction.editReply({ content: '❓ Which game would you like to forcefully end or cancel?', components: [row] });
        }

        if (gameEnded) {
            await interaction.editReply({ content: '✅ Game ended and cleaned up.' });
        } else {
            await interaction.editReply({ content: '❌ No active game found with that ID or in this channel.' });
        }
    }

    if (interaction.commandName === 'onboarding') {
        return onboardingDiscord.handleOnboardingCommand(interaction, client);
    }

    if (interaction.commandName === 'playgame') {
        return platformPlay.handleSlashPlaygame(interaction, client);
    }

    if (interaction.commandName === 'giveaway') {
        const dur = interaction.options.getInteger('duration'); const winCount = interaction.options.getInteger('winners') || 1;
        const threadName = interaction.options.getString('thread_name') || defaultGameThreadName('Giveaway');
        const ignoredUsersRaw = interaction.options.getString('ignored_users') || '';
        const ignoredRolesRaw = interaction.options.getString('ignored_roles') || '';
        const ignoreUserOpt = interaction.options.getUser('ignore_user');
        const ignoreRoleOpt = interaction.options.getRole('ignore_role');
        const ignoredUsers = Array.from(
            new Set([
                ...ignoredUsersRaw.split(',').map((u) => u.replace(/[<@!> ]/g, '')).filter((u) => u.length > 0),
                ...(ignoreUserOpt ? [ignoreUserOpt.id] : []),
            ]),
        );
        const ignoredRoles = Array.from(
            new Set([
                ...ignoredRolesRaw.split(',').map((r) => r.replace(/[<@&> ]/g, '')).filter((r) => r.length > 0),
                ...(ignoreRoleOpt ? [ignoreRoleOpt.id] : []),
            ]),
        );
        const cooldownDays = interaction.options.getInteger('cooldown_days') || 0;
        const delay = getSlashScheduleDelayMs(interaction);
        const ptsOpt = interaction.options.getString('points') || DEFAULT_GIVEAWAY_PLACEMENT;

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const giveawayHost = await getUser(guildId, interaction.user.id);
        const giveawayHostPremium = giveawayHost.isPremium === true;

        const start = async () => {
            throwIfImmediateGameStartBlockedByMaintenance(Date.now(), dur * 60000);
            const thread = await createHostedGamePrivateThread(interaction.channel, threadName);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('enter_giveaway').setLabel('🎉 Enter').setStyle(ButtonStyle.Success));
            const msg = await thread.send({
                content: `🎁 **GIVEAWAY!**\nEnds in: **${dur} minutes**`,
                embeds: [makeGameFlairEmbed('giveaway')],
                components: [row],
            });
            await msg.edit({ components: [row, auraBoostRow(msg.id)] });
            const game_state_giveaway = { winnersCount: winCount, participants: [], ignoredUsers, ignoredRoles, cooldownDays, pointValues: parsePointValues(ptsOpt, DEFAULT_GIVEAWAY_PLACEMENT) };
            await createActiveGame(guildId, interaction.channelId, msg.id, 'Giveaway', game_state_giveaway, dur, giveawayHostPremium);
            activeGiveaways.set(msg.id, { guildId, winnersCount: winCount, participants: new Set(), channelId: interaction.channelId, threadId: thread.id, messageRef: msg, ignoredUsers, ignoredRoles, cooldownDays, pointValues: parsePointValues(ptsOpt, DEFAULT_GIVEAWAY_PLACEMENT), hostIsPremium: giveawayHostPremium, premiumAuraBoost: false, timeoutHandle: setTimeout(() => endGiveaway(msg.id), dur * 60000) });
            registerAuraBoostTarget(msg.id, () => {
                const g = activeGiveaways.get(msg.id);
                if (g) g.premiumAuraBoost = true;
            });
            activeGiveaways.get(msg.id).announcementMessage = await sendGlobalAnnouncement(client, guildId, `A new giveaway has started in <#${interaction.channelId}>! Ends in ${dur}m. Status: **${winCount} winners**`, thread.id);
            return thread.id;
        };

        if (delay > 0) { 
            const sid = await scheduleGame(guildId, 'Giveaway', interaction.channelId, delay, start);
            await interaction.editReply({ content: `Scheduled! (ID: \`${sid}\`)` }); 
            announceScheduledGame(client, guildId, 'Giveaway', delay); 
        } else {
            await interaction.editReply({ content: "Starting!" });
            const givTid = await start();
            if (givTid) {
                const givTh = await client.channels.fetch(givTid).catch(() => null);
                if (givTh) {
                    await tryHostPremiumNudge(interaction, giveawayHost, {
                        gameType: 'Giveaway',
                        supportsRepeatHrs: true,
                        supportsPremiumCaps: false,
                    }).catch(() => {});
                    await sendPremiumBoostSessionHint(givTh, giveawayHostPremium, {
                        guildId,
                        hostUserId: interaction.user.id,
                        gameType: 'Giveaway',
                        sessionId: givTh.id,
                        hasAura: false,
                    }).catch(() => {});
                }
            }
        }
    }

    if (interaction.commandName === 'leaderboard') {
        const lbConfig = await getSystemConfig(guildId);
        const { sort, scoreKey, title } = resolveLeaderboardSort(lbConfig);
        const users = await User.find({ guildId, userId: { $ne: 'SYSTEM' } }).sort(sort).limit(10);
        if (users.length === 0) {
            return interaction.reply(
                '**Server activity rankings** — _Early access — rankings are still forming._\n' +
                    `_No **${CREDITS}** entries in this server for the current cadence yet._`,
            );
        }

        const globalItems = await ShopItem.find();
        const serverItems = lbConfig.shopItems || [];

        const itemById = new Map(globalItems.map((i) => [i.id, i]));
        serverItems.forEach((i) => { if (!itemById.has(i.id)) itemById.set(i.id, i); });

        let r =
            `**🏆 Server activity rankings (${title}) 🏆**\n` +
            `_${CREDITS} in this server — may differ from **Official Faction Rankings** (\`/factions\`)._\n\n`;
        for (let i = 0; i < users.length; i++) {
            const u = users[i];
            let badge = '';
            if (u.currentCosmetics && u.currentCosmetics.get('badge')) {
                const bId = u.currentCosmetics.get('badge');
                const bItem = itemById.get(bId);
                if (bItem && bItem.leaderboardEmoji) {
                    badge += `${bItem.leaderboardEmoji} `;
                } else if (bId === 'premium_badge_diamond') {
                    badge += '💎 ';
                } else if (bId === 'badge_star') {
                    badge += '⭐ ';
                } else if (bItem) {
                    badge += `[${bItem.name}] `;
                }
            } else if (u.isPremium) {
                badge += '💎 ';
            }
            const pts = u[scoreKey] ?? 0;
            r += `${i+1}. ${badge}<@${u.userId}> — **${pts}** ${CREDITS}\n`;
        }
        await interaction.reply({ content: r, allowedMentions: { users: [] } });
    }

    if (interaction.commandName === 'leaderboard_history') {
        const period = interaction.options.getString('period', true);
        const periods = Math.min(5, Math.max(1, interaction.options.getInteger('periods') ?? 3));
        const snaps = await LeaderboardPeriodSnapshot.find({ guildId, period })
            .sort({ endedAt: -1 })
            .limit(periods)
            .lean();
        if (!snaps.length) {
            const when = period === 'weekly'
                ? '**Sundays at 8:00 PM** (bot time)'
                : 'the **1st of each month at 8:00 PM** (bot time)';
            return interaction.reply({
                content: `No **${period}** snapshots in this server yet. They are saved automatically each time that period resets (${when}).`,
                ephemeral: true,
            });
        }
        const title = period === 'weekly' ? `📅 Weekly ${CREDITS} history` : `📅 Monthly ${CREDITS} history`;
        const embed = new EmbedBuilder()
            .setColor(period === 'weekly' ? '#FFD700' : '#9B59B6')
            .setTitle(title)
            .setFooter({ text: 'Top 15 saved per reset · showing top 10 per period here' });
        for (const s of snaps) {
            const ts = Math.floor(new Date(s.endedAt).getTime() / 1000);
            const nonzero = (s.entries || []).filter((e) => e.score > 0);
            const lines = nonzero.length
                ? nonzero.slice(0, 10).map((e) => `${e.rank}. <@${e.userId}> — **${e.score}** ${CREDITS}`).join('\n\n')
                : `_No one earned **${CREDITS}** that period._`;
            const name = `Ended <t:${ts}:D>`;
            embed.addFields({ name, value: lines.slice(0, 1024), inline: false });
        }
        await interaction.reply({ embeds: [embed], allowedMentions: { users: [] } });
    }

    if (interaction.commandName === 'faction_role_link') {
        return executeFactionRoleLink(interaction);
    }
    if (interaction.commandName === 'faction_rename') {
        return executeFactionRename(interaction);
    }
    if (interaction.commandName === 'faction_emoji') {
        return executeFactionEmoji(interaction);
    }
    if (interaction.commandName === 'faction_balance') {
        return executeFactionBalance(interaction);
    }

    if (interaction.commandName === 'faction') {
        const fsub = interaction.options.getSubcommand(true);
        const user = await getUser(guildId, interaction.user.id);

        if (fsub === 'join') {
            const joinName = interaction.options.getString('name').trim();
            const result = await joinOfficialFactionInGuild(interaction, joinName);
            if (!result.ok) {
                return interaction.reply({ content: result.content, ephemeral: true });
            }
            await recordFactionJoined(interaction.user.id).catch(() => {});
            return interaction.reply({ content: result.content, ephemeral: true });
        }

        if (fsub === 'leave') {
            if (!user.faction) {
                return interaction.reply({ content: 'You are not in a faction. Use `/faction join`.', ephemeral: true });
            }
            await reconcileFactionTotalsForLeavingMember(user.faction, user.competitivePoints, guildId);
            await removeUserFromFactionChallengeEnrollment(guildId, interaction.user.id);
            user.faction = null;
            user.lastFactionLeaveAt = Date.now();
            await user.save();
            const sysLeave = await getSystemConfig(guildId);
            await syncFactionMemberRoles(interaction.guild, interaction.user.id, sysLeave, null);
            const leaveDays = Math.round(FACTION_JOIN_AFTER_LEAVE_COOLDOWN_MS / 86400000);
            return interaction.reply({
                content:
                    '✅ You left your faction.\n\n' +
                    `⚠️ **Free accounts:** you **cannot \`/faction join\` another team for ${leaveDays} days** after leaving.\n` +
                    '💎 **Premium:** use **`/faction switch`** to change factions instead (**7-day** cooldown between switches; no join lockout).\n\n' +
                    '_If a faction challenge was running, you were unenrolled — use `/faction_challenge join` after you’re on a team again._',
                ephemeral: true,
            });
        }

        if (fsub === 'switch') {
            if (!user.isPremium) {
                return interaction.reply({
                    content: '💎 **Faction switch** is **PlayBound Premium** only. Free players can `/faction leave` then `/faction join`.',
                    ephemeral: true,
                });
            }
            if (!user.faction) {
                return interaction.reply({ content: '❌ You are not in a faction. Use `/faction join` first.', ephemeral: true });
            }
            const nowSw = Date.now();
            if (user.lastFactionSwitchAt && nowSw - user.lastFactionSwitchAt < FACTION_SWITCH_COOLDOWN_MS) {
                const hrs = Math.ceil((FACTION_SWITCH_COOLDOWN_MS - (nowSw - user.lastFactionSwitchAt)) / 3600000);
                return interaction.reply({ content: `⏳ Faction switch cooldown: try again in **~${hrs}h**.`, ephemeral: true });
            }
            const newName = interaction.options.getString('name').trim();
            if (newName === user.faction) {
                return interaction.reply({ content: `❌ You are already in **${user.faction}**.`, ephemeral: true });
            }
            await reconcileFactionTotalsForLeavingMember(user.faction, user.competitivePoints, guildId);
            await removeUserFromFactionChallengeEnrollment(guildId, interaction.user.id);
            const newFac = await resolveFactionDocForJoin(newName);
            if (!newFac) {
                user.faction = null;
                await user.save();
                return interaction.reply({
                    content:
                        `❌ No faction **${newName}**. You were removed from your old faction; use \`/faction join\` when you know the exact name.`,
                    ephemeral: true,
                });
            }
            user.faction = newName;
            user.lastFactionSwitchAt = nowSw;
            user.lastFactionLeaveAt = null;
            await user.save();
            if (!isGuildExcludedFromGlobalCounts(guildId)) {
                newFac.members += 1;
                await newFac.save();
            }
            const sysSw = await getSystemConfig(guildId);
            await syncFactionMemberRoles(interaction.guild, interaction.user.id, sysSw, newName);
            const swEm = getFactionDisplayEmoji(newName, sysSw, newFac.emoji);
            const swDual = formatFactionDualLabel(newName, sysSw);
            return interaction.reply({
                content:
                    `✅ Switched to **${swEm} ${swDual}**. **Official faction:** \`${newName}\`. Re-run \`/faction_challenge join\` if a challenge is active.\n\n` +
                    `⏳ **Next /faction switch** — available after **7 days** (Premium cooldown between switches).`,
                ephemeral: true,
            });
        }

        if (fsub === 'stats') {
            if (!user.faction) {
                return interaction.reply({ content: 'You are not in a faction! Use `/faction join`.', ephemeral: true });
            }
            const factionDoc = await Faction.findOne({ name: user.faction });
            if (!factionDoc) {
                user.faction = null;
                await user.save();
                return interaction.reply({ content: 'Your faction record was missing and has been cleared. Use `/faction join`.', ephemeral: true });
            }
            const facCfgStats = await getSystemConfig(guildId);
            const globalAgg = await getGlobalFactionTotalsForName(user.faction);
            const stEm = getFactionDisplayEmoji(user.faction, facCfgStats, factionDoc.emoji);
            const statsDual = formatFactionDualLabel(factionDoc.name, facCfgStats);
            const embed = new EmbedBuilder()
                .setColor('#FF4500')
                .setTitle(`${stEm} ${statsDual}`)
                .setDescription(
                    `${factionDoc.desc}\n\n_**Official faction:** \`${factionDoc.name}\` — if your server renamed it, both names appear in the title._`,
                )
                .addFields(
                    {
                        name: 'Official standings (global)',
                        value:
                            `**${globalAgg.matchPoints.toLocaleString()}** match points · **W** ${globalAgg.rankedWins} · **L** ${globalAgg.rankedLosses} · **T** ${globalAgg.rankedTies}\n\n` +
                            `_Raw from ranked wars: **${globalAgg.rawWarContributionTotal.toLocaleString()}** · Legacy challenge total: **${globalAgg.legacyChallengePoints.toLocaleString()}**_`,
                        inline: true,
                    },
                    { name: 'Total Members', value: `**${globalAgg.members.toLocaleString()}**`, inline: true },
                    {
                        name: `Your ${ARENA_SCORE}`,
                        value: `**${(user.competitivePoints || 0).toLocaleString()}** (this server — not added to global faction totals)`,
                        inline: false,
                    },
                    {
                        name: CREDITS,
                        value: `**${(user.points || 0).toLocaleString()}** — shop, dailies, transfers, duels, \`/adjustpoints\` (not global faction)`,
                        inline: false,
                    },
                )
                .setFooter({ text: 'Official /factions board = match points from ranked wars — not raw grind' });
            if (user.isPremium) {
                const standingsPr = await getGlobalFactionStandingsFromUsers();
                const gapPr = formatPremiumGlobalBoardGap(standingsPr, user.faction);
                if (gapPr) {
                    embed.addFields({
                        name: '💎 Premium · Global board context',
                        value: gapPr.slice(0, 1020),
                        inline: false,
                    });
                }
            }
            return interaction.reply({ embeds: [embed] });
        }

        if (fsub === 'server') {
            const rows = await User.aggregate([
                { $match: { guildId, userId: { $ne: 'SYSTEM' }, faction: { $nin: [null, ''] } } },
                { $group: { _id: '$faction', members: { $sum: 1 }, points: { $sum: '$competitivePoints' } } },
                { $sort: { points: -1 } },
            ]);
            if (!rows.length) {
                return interaction.reply({ content: 'No members with a faction in this server yet. Use `/faction join`.', ephemeral: true });
            }
            const facCfgSrv = await getSystemConfig(guildId);
            const names = rows.map((r) => r._id);
            const facDocs = await Faction.find({ name: { $in: names } });
            const emojiBy = new Map(facDocs.map((f) => [f.name, f.emoji]));
            let desc =
                `**Server activity rankings** — sums **${ARENA_SCORE}** from members in **this server** only.\n` +
                `_Server rankings may differ from **Official Faction Rankings** (\`/factions\` = global challenge results only)._\n\n`;
            rows.forEach((r, index) => {
                const medal = index === 0 ? '🏆' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔹';
                const em = getFactionDisplayEmoji(r._id, facCfgSrv, emojiBy.get(r._id));
                const disp = formatFactionDualLabel(r._id, facCfgSrv);
                desc += `${medal} **${em} ${disp}** — **${(r.points || 0).toLocaleString()}** ${ARENA_SCORE.toLowerCase()} · ${r.members} members here\n\n`;
            });
            const embed = new EmbedBuilder()
                .setColor('#4169E1')
                .setTitle(`⚔️ Server activity rankings (${ARENA_SCORE})`)
                .setDescription(desc.slice(0, 4090));
            if (user.isPremium && user.faction) {
                const placeSrv = await formatPremiumServerArenaRank(guildId, user.faction, user.competitivePoints);
                if (placeSrv) {
                    embed.addFields({
                        name: '💎 Premium · Your placement',
                        value: placeSrv.slice(0, 1020),
                        inline: false,
                    });
                }
            }
            return interaction.reply({ embeds: [embed] });
        }
    }

    if (interaction.commandName === 'factions') {
        const factions = await getGlobalFactionStandingsFromUsers();
        if (factions.length === 0) {
            return interaction.reply({
                content: '**Official Faction Rankings** — _Early access — rankings are still forming._',
                ephemeral: true,
            });
        }

        const SUMMARY_CAP = 14;
        const summarySlice = factions.slice(0, SUMMARY_CAP);
        const factionsAllZero = factions.every(
            (f) => !((f.matchPoints || 0) > 0) && !((f.legacyChallengePoints || 0) > 0),
        );

        let desc =
            (factionsAllZero ? '_Early access — rankings are still forming._\n\n' : '') +
            '**Official Faction Rankings** — **global** names only. Play freely anytime; **official** standings come from **ranked wars** (fair rules), not endless grinding.\n' +
            'Join with `/faction join` (**name** = official spelling). **Match points:** win **+3**, tie **+1**, loss **+0**.\n\n' +
            '_Raw war score is tracked separately and does **not** decide the official board by itself._\n\n' +
            '**Quarterly seasons (UTC):** compete in **ranked** wars to climb the **seasonal** board — `/season` for this quarter.\n\n' +
            '**Top servers** (per faction) = most **ranked-war raw contribution** by guild — labels show `Server (Official)` where set.\n\n';
        summarySlice.forEach((f, index) => {
            const medal = index === 0 ? '🏆' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔹';
            const emCanon = f.emoji && String(f.emoji).trim() ? String(f.emoji).trim() : '⚔️';
            const seasonTag =
                f.seasonHighlightActive && f.seasonHighlightLabel
                    ? ` · 🎖️ _${f.seasonHighlightLabel}_`
                    : '';
            desc += `${medal} **${emCanon} ${f.name}** — **${f.matchPoints.toLocaleString()}** match pts (**W** ${f.rankedWins} **L** ${f.rankedLosses} **T** ${f.rankedTies}) · **${f.members}** members globally${seasonTag}\n\n`;
        });
        if (factions.length > SUMMARY_CAP) {
            desc += `\n_…and **${factions.length - SUMMARY_CAP}** more faction(s) (official standings above)._`;
        }

        const embed = new EmbedBuilder()
            .setColor('#1E90FF')
            .setTitle('🌐 Official Faction Rankings')
            .setDescription(desc.slice(0, 4090))
            .setFooter({ text: 'Match points = ranked wars · /faction server = this server’s activity view' });

        /** Keep total embed under ~6000 chars (title + description + fields). */
        const TOP_SERVERS = 5;
        const MAX_FACTION_FIELDS = Math.min(factions.length, Math.max(GLOBAL_FACTION_KEYS.length, 20));
        const FIELD_VAL_MAX = 950;
        const cfgByGuild = new Map();

        const cfgFor = async (gid) => {
            if (cfgByGuild.has(gid)) return cfgByGuild.get(gid);
            const c = await getSystemConfig(gid);
            cfgByGuild.set(gid, c);
            return c;
        };

        for (let i = 0; i < MAX_FACTION_FIELDS; i++) {
            const f = factions[i];
            const rows = await getTopGuildsForFactionChallengePoints(f.name, TOP_SERVERS);

            let block = '';
            if (rows.length === 0) {
                block = '_No ended challenges with recorded totals for this faction yet._';
            } else {
                for (const r of rows) {
                    const gid = r.guildId;
                    const g = client.guilds.cache.get(gid);
                    const gName = (g?.name || `ID ${gid}`).slice(0, 72);
                    const cfg = await cfgFor(gid);
                    const local = String(formatFactionDualLabel(f.name, cfg)).slice(0, 72);
                    const line = `**${gName}** · _${local}_ — **${(r.pts || 0).toLocaleString()}** ranked-war raw total · ${r.n} members here\n\n`;
                    if (block.length + line.length > FIELD_VAL_MAX - 24) {
                        block += '_…truncated_';
                        break;
                    }
                    block += line;
                }
                if (rows.length === TOP_SERVERS && !block.includes('truncated'))
                    block += `_Top **${TOP_SERVERS}** servers by **challenge** points for this faction._`;
            }

            const emField = f.emoji && String(f.emoji).trim() ? String(f.emoji).trim() : '⚔️';
            const fieldTitle = `${emField} ${f.name} — top servers`;
            embed.addFields({
                name: fieldTitle.slice(0, 256),
                value: (block || '—').slice(0, 1020),
                inline: false,
            });
        }

        if (factions.length > MAX_FACTION_FIELDS) {
            embed.setFooter({
                text: `Match points = ranked wars · /faction server = activity here · Top ${MAX_FACTION_FIELDS} factions by official standings.`,
            });
        }

        const factionsViewer = await getUser(guildId, interaction.user.id);
        if (factionsViewer.isPremium && factionsViewer.faction) {
            const gapFv = formatPremiumGlobalBoardGap(factions, factionsViewer.faction);
            if (gapFv) {
                embed.addFields({
                    name: '💎 Premium · Your faction on this board',
                    value: gapFv.slice(0, 1020),
                    inline: false,
                });
            }
        }

        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === 'season') {
        const { getCurrentSeasonOverview, getHallOfChampions } = require('../../lib/factionSeasons');
        const ov = await getCurrentSeasonOverview();
        const hall = await getHallOfChampions(8);
        const facLines = (ov.topFactions || []).slice(0, 6).map((r, i) => {
            return `**${i + 1}.** **${r.factionName}** — **${r.matchPoints}** season MP · W **${r.wins}** · L **${r.losses}** · T **${r.ties}**`;
        });
        const hallLines = (hall.quarters || [])
            .slice(0, 5)
            .map((q) => `**${q.seasonKey}** · Faction **${q.winningFactionName || '—'}**${q.winningGuildId ? ` · Top server \`${q.winningGuildId}\`` : ''}`);
        const embed = new EmbedBuilder()
            .setColor('#9B59B6')
            .setTitle(`📅 Quarterly season · ${ov.seasonKey} (UTC)`)
            .setDescription(
                `**Season ends** in about **${ov.daysRemainingApprox}** day(s).\n\n` +
                    `_Earn **seasonal** match points from **ranked** wars (same **+3 / +1** rules as global standings)._`,
            )
            .addFields(
                { name: 'Top factions this quarter', value: (facLines.join('\n\n') || '—').slice(0, 1020), inline: false },
                {
                    name: 'Hall of champions (recent quarters)',
                    value: (hallLines.join('\n\n') || '_No completed quarters yet._').slice(0, 1020),
                    inline: false,
                },
            );
        if (ov.lastQuarterWinnerFaction) {
            embed.addFields({
                name: 'Last quarter',
                value: `**${ov.lastQuarterKey || '—'}** · **${ov.lastQuarterWinnerFaction}**${ov.lastQuarterWinnerGuildId ? ` · Server \`${ov.lastQuarterWinnerGuildId}\`` : ''}`,
                inline: false,
            });
        }
        const seasonUser = await getUser(guildId, interaction.user.id);
        if (seasonUser.isPremium && seasonUser.faction) {
            const seasonPl = await formatPremiumSeasonFactionPlacement(ov.seasonKey, seasonUser.faction);
            if (seasonPl) {
                embed.addFields({
                    name: '💎 Premium · Your faction this quarter',
                    value: seasonPl.slice(0, 1020),
                    inline: false,
                });
            }
        }
        const eng = await EngagementProfile.findOne({ guildId, userId: interaction.user.id }).lean();
        if (eng && (eng.seasonXp > 0 || eng.cosmeticCurrency > 0)) {
            embed.addFields({
                name: '🎯 Seasonal progression (non-ranked)',
                value: `Season XP: **${(eng.seasonXp || 0).toLocaleString()}** · Cosmetic tokens: **${(eng.cosmeticCurrency || 0).toLocaleString()}**`,
                inline: false,
            });
        }
        embed.setFooter({ text: 'Year-end crowns sum all four quarters · playbound.app' });
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === 'missions') {
        const userM = await getUser(guildId, interaction.user.id);
        const board = await listMissionBoard(guildId, interaction.user.id, userM.faction || null);
        const embed = new EmbedBuilder()
            .setTitle('🎯 Missions (UTC)')
            .setColor(0x3498db)
            .setDescription(
                `**Day** \`${board.day}\` · **Week** \`${board.week}\`\n\n${board.lines.join('\n') || '—'}`.slice(0, 3900),
            );
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (interaction.commandName === 'claim_mission_rewards') {
        const userC = await getUser(guildId, interaction.user.id);
        const { total, lines } = await claimCompletedMissions(guildId, interaction.user.id, userC.faction || null);
        const msg = total
            ? `✅ Claimed **${total}** reward(s):\n${lines.join('\n')}`
            : 'No completed missions to claim — check `/missions` for progress.';
        return interaction.reply({ content: msg.slice(0, 1900), ephemeral: true });
    }

    if (interaction.commandName === 'featured') {
        const rot = await ensureRotationForDate();
        const ranked = (rot.rankedFeaturedTags || []).map((t) => `\`${t}\``).join(', ') || '—';
        const casual = rot.featuredTag ? `\`${rot.featuredTag}\`` : '—';
        const pool = (rot.activeTags || []).join(', ') || '—';
        return interaction.reply({
            content:
                `**UTC day** \`${rot.dayUtc}\`\n` +
                `🌟 **Casual featured** (personal Credits bonus): ${casual}\n` +
                `⚔️ **Ranked featured** (missions + **capped** war base bonus): ${ranked}\n` +
                `📋 **Rotation pool**: ${pool}`,
            ephemeral: true,
        });
    }

    if (interaction.commandName === 'warstatus') {
        await expireStaleChallenges(guildId, client);
        const warCh = await getActiveChallenge(guildId);
        if (!warCh) {
            return interaction.reply({ content: 'No active faction war in this server.', ephemeral: true });
        }
        const phase = getWarPhase(warCh);
        const scores = computeScores(warCh);
        const teams = scores.teams || [];
        const sorted = [...teams].sort((a, b) => b.value - a.value);
        const lead = sorted[0];
        const bounds = getPhaseBounds(warCh);
        const leaderLine = lead ? `**${lead.name}** — **${Number(lead.value).toFixed(2)}** (${scores.label || 'score'})` : '—';
        const second = sorted[1];
        const runner = second ? `**${second.name}** — **${Number(second.value).toFixed(2)}**` : '';
        return interaction.reply({
            content:
                `**Phase:** **${phase}** · **Final hour mode:** \`${warCh.finalHourMode || 'none'}\`\n` +
                `**Prep ends:** <t:${Math.floor(bounds.prepEnds.getTime() / 1000)}:R> · **Final hour:** <t:${Math.floor(bounds.fhStart.getTime() / 1000)}:R> · **Ends:** <t:${Math.floor(new Date(warCh.endAt).getTime() / 1000)}:R>\n` +
                `**Leading:** ${leaderLine}${runner ? `\n**Next:** ${runner}` : ''}\n` +
                `_Official scoring uses **base** points only; ledger length **${(warCh.warPointLedger || []).length}**._`.slice(0, 1900),
            ephemeral: true,
        });
    }

    if (interaction.commandName === 'engagement_admin') {
        const isAdmEa = interaction.member?.permissions?.has('Administrator');
        const cfgEa = await getSystemConfig(guildId);
        const hasMgrEa = cfgEa.managerRoleId && interaction.member?.roles?.cache?.has(cfgEa.managerRoleId);
        if (!isAdmEa && !hasMgrEa && !isBotDeveloper(interaction.user.id)) {
            return interaction.reply({ content: '❌ **Administrator** or **Bot Manager** only.', ephemeral: true });
        }
        const subEa = interaction.options.getSubcommand();
        const settingsEa = await getSettings();
        if (subEa === 'ranked_tags') {
            const tags = Object.keys(GAME_REGISTRY).filter((t) => tagCreditsOfficialRankedWar(t, settingsEa));
            return interaction.reply({ content: tags.sort().join(', ').slice(0, 1900) || '—', ephemeral: true });
        }
        if (subEa === 'featured_rotation') {
            const rotEa = await ensureRotationForDate();
            return interaction.reply({
                content: `\`\`\`json\n${JSON.stringify(
                    {
                        dayUtc: rotEa.dayUtc,
                        activeTags: rotEa.activeTags,
                        featuredTag: rotEa.featuredTag,
                        rankedFeaturedTags: rotEa.rankedFeaturedTags || [],
                    },
                    null,
                    2,
                )}\n\`\`\``.slice(0, 1900),
                ephemeral: true,
            });
        }
        if (subEa === 'war_config') {
            await expireStaleChallenges(guildId, client);
            const chEa = await getActiveChallenge(guildId);
            if (!chEa) return interaction.reply({ content: 'No active war.', ephemeral: true });
            const leanEa = await FactionChallenge.findById(chEa._id).lean();
            const out = {
                prepMinutes: leanEa.prepMinutes,
                finalHourMinutes: leanEa.finalHourMinutes,
                finalHourMode: leanEa.finalHourMode,
                prepEndsAt: leanEa.prepEndsAt,
                finalHourStartsAt: leanEa.finalHourStartsAt,
                warFeaturedTags: leanEa.warFeaturedTags,
                ledgerLength: (leanEa.warPointLedger || []).length,
                phase: getWarPhase(leanEa),
            };
            return interaction.reply({ content: `\`\`\`json\n${JSON.stringify(out, null, 2)}\n\`\`\``.slice(0, 1900), ephemeral: true });
        }
        if (subEa === 'mission_definitions') {
            const defsEa = await listMissionDefinitionsLean();
            return interaction.reply({ content: `\`\`\`json\n${JSON.stringify(defsEa, null, 2)}\n\`\`\``.slice(0, 1900), ephemeral: true });
        }
        if (subEa === 'mission_progress') {
            const targetU = interaction.options.getUser('user');
            const uidP = targetU?.id || interaction.user.id;
            const rowsP = await MissionProgress.find({ guildId, userId: uidP }).sort({ updatedAt: -1 }).limit(25).lean();
            return interaction.reply({ content: `\`\`\`json\n${JSON.stringify(rowsP, null, 2)}\n\`\`\``.slice(0, 1900), ephemeral: true });
        }
    }

    if (interaction.commandName === 'faction_challenge') {
        const sub = interaction.options.getSubcommand();
        const configFc = await getSystemConfig(guildId);
        const canFcManage = canManageFactionChallenges(interaction.member, interaction.user.id, configFc);
        const fcPermDeny =
            '❌ Faction challenges can be managed by **Administrators**, **Bot Managers**, or the configured **Faction Leader** role (`/set_faction_leader_role`).';

        if (sub === 'create') {
            const actor = await getUser(guildId, interaction.user.id);
            if (!actor.isPremium) {
                return interaction.reply({ content: '❌ **Faction challenges** require **PlayBound Premium**.', ephemeral: true });
            }
            if (!canFcManage) {
                return interaction.reply({ content: fcPermDeny, ephemeral: true });
            }
            await expireStaleChallenges(guildId, client);
            const existing = await getActiveChallenge(guildId);
            if (existing) {
                return interaction.reply({ content: '❌ There is already an active faction challenge in this server. End it first with `/faction_challenge end`.', ephemeral: true });
            }
            const warsToday = await countFactionChallengesToday(guildId);
            if (warsToday >= 3) {
                return interaction.reply({
                    content: '❌ This server already used **3 faction wars** this **UTC** day. Try again tomorrow.',
                    ephemeral: true,
                });
            }
            let factionA = interaction.options.getString('faction_a');
            let factionB = interaction.options.getString('faction_b');
            if ((factionA && !factionB) || (!factionA && factionB)) {
                return interaction.reply({
                    content: '❌ Provide **both** `faction_a` and `faction_b`, or **neither** for automatic rotation.',
                    ephemeral: true,
                });
            }
            if (!factionA && !factionB) {
                const duelsToday = await countFactionChallengesOfTypeToday(guildId, 'duel');
                const pair = duelPairForDailySlot(duelsToday);
                factionA = pair[0];
                factionB = pair[1];
            }
            if (factionA === factionB) {
                return interaction.reply({ content: '❌ Choose two **different** factions.', ephemeral: true });
            }
            const challengeMode = 'ranked';
            const durationHrs = interaction.options.getInteger('duration_hours');
            let { gameType, scoringMode, topN } = resolveFactionChallengeCreateOptions(configFc, {
                gameType: interaction.options.getString('game_type'),
                scoringMode: null,
                topN: null,
            });
            const maxPerRaw = interaction.options.getInteger('max_per_team');
            let maxPerTeam = maxPerRaw != null && maxPerRaw >= 1 ? Math.min(25, maxPerRaw) : null;
            let pointCap = null;

            scoringMode = RANKED_FIXED_SCORING_MODE;
            topN = RANKED_FIXED_TOP_N;
            const vErrs = validateChallengeCreateParams({
                challengeMode: 'ranked',
                pointCap,
                maxPerTeam,
                scoringMode,
                topN,
                warVersion: RANKED_SLASH_CREATE_WAR_VERSION,
            });
            if (vErrs.length) {
                return interaction.reply({ content: `❌ ${vErrs[0]}`, ephemeral: true });
            }

            const gameTypesArr = resolveGameTypesArrayForChallenge(null, gameType);
            const platSettings = await getSettings();
            const rankedGtErrs = validateRankedChallengeGameSelection(gameTypesArr, platSettings);
            if (rankedGtErrs.length) {
                return interaction.reply({ content: `❌ ${rankedGtErrs[0]}`, ephemeral: true });
            }
            const legacyGameType =
                gameTypesArr.length === 1 ? gameTypesArr[0] : gameTypesArr.includes('all') ? 'all' : gameTypesArr[0];
            const gameFilterLabel = formatChallengeGameFilterLabel({ gameTypes: gameTypesArr, gameType: legacyGameType });
            const contributionCapsFromSlash = parseContributionCapsCsv(interaction.options.getString('contribution_caps'));
            const contributionCapsByTag = (() => {
                if (challengeMode !== 'ranked') return null;
                const cfgCaps = rankedContributionCapsFromConfig(configFc);
                const merged = { ...(cfgCaps || {}), ...(contributionCapsFromSlash || {}) };
                return Object.keys(merged).length ? merged : null;
            })();
            const rankedSnap = buildRankedRulesSnapshot({
                challengeMode,
                scoringMode,
                topN,
                maxPerTeam,
                gameTypes: gameTypesArr,
                contributionCapsByTag,
                pointCap,
            });

            const capLine = pointCap
                ? `\nPoint goal: first team to **${pointCap.toLocaleString()}** enrolled **war total** (base mini-game score) ends the war early.`
                : '';
            const modeExplain =
                '\n\n**Official ranked war** — affects **global** standings (**match points**: win **+3**, tie **+1**). **Only /playgame** platform games can score; **hosted** commands (/trivia, etc.) never count.';

            const endAt = new Date(Date.now() + durationHrs * 3600000);
            const prepMinutesCr = interaction.options.getInteger('prep_minutes') ?? 0;
            const finalHourMinutesCr = interaction.options.getInteger('final_hour_minutes') ?? 60;
            const finalHourModeCr = interaction.options.getString('final_hour_mode') ?? 'none';
            const createNowCr = new Date();
            const prepEndsAtCr = new Date(createNowCr.getTime() + Math.max(0, prepMinutesCr) * 60000);
            let finalHourStartsAtCr = new Date(endAt.getTime() - Math.max(0, finalHourMinutesCr) * 60000);
            if (finalHourStartsAtCr.getTime() < prepEndsAtCr.getTime()) finalHourStartsAtCr = prepEndsAtCr;
            const platDayCr = await GamePlatformDay.findOne({ dayUtc: utcDayString() }).lean();
            const warFeaturedTagsCr = [...new Set((platDayCr?.rankedFeaturedTags || []).map((t) => String(t).toLowerCase()))]
                .filter(Boolean)
                .slice(0, 8);
            await FactionChallenge.create({
                guildId,
                challengeMode,
                challengeType: 'duel',
                factionA,
                factionB,
                gameType: legacyGameType,
                gameTypes: gameTypesArr,
                scoringMode,
                topN,
                pointCap,
                maxPerTeam,
                warVersion: RANKED_SLASH_CREATE_WAR_VERSION,
                contributionCapsByTag,
                rankedRulesSnapshot: rankedSnap,
                status: 'active',
                createdBy: interaction.user.id,
                participantsA: [],
                participantsB: [],
                endAt,
                prepMinutes: prepMinutesCr,
                finalHourMinutes: finalHourMinutesCr,
                finalHourMode: finalHourModeCr,
                prepEndsAt: prepEndsAtCr,
                finalHourStartsAt: finalHourStartsAtCr,
                warFeaturedTags: warFeaturedTagsCr,
            });
            const matchupLineDuelLive = await formatFactionWarMatchupLine(configFc, {
                isRoyale: false,
                factionA,
                factionB,
            });
            const announced = await announceFactionChallengeToGuild(client, guildId, configFc, {
                matchupLine: matchupLineDuelLive,
                endAt,
                gameType: legacyGameType,
                gameFilterLabel,
                scoringMode,
                topN,
                pointCap,
                maxPerTeam,
                isRoyale: false,
                factionA,
                factionB,
                challengeMode,
            });
            const pubLine = announced ? `\n\n📣 Posted to <#${configFc.announceChannel}>.` : '';
            const liveA = formatFactionDualLabel(factionA, configFc);
            const liveB = formatFactionDualLabel(factionB, configFc);
            return interaction.reply({
                content:
                    `✅ **Faction challenge created!** **${liveA}** vs **${liveB}** — ends <t:${Math.floor(endAt.getTime() / 1000)}:F>. Members use \`/faction_challenge join\` to enroll.` +
                    `\n\nGames: \`${gameFilterLabel}\`\n` +
                    `Scoring: **${RANKED_SCORING_DISPLAY_LABEL}**${capLine}${modeExplain}${pubLine}\n\n` +
                    `_Only **enrolled** players contribute. Only **allowed game types** count._`,
                ephemeral: true,
            });
        }

        if (sub === 'create_royale') {
            const actorRoyale = await getUser(guildId, interaction.user.id);
            if (!actorRoyale.isPremium) {
                return interaction.reply({ content: '❌ **Faction challenges** require **PlayBound Premium**.', ephemeral: true });
            }
            if (!canFcManage) {
                return interaction.reply({ content: fcPermDeny, ephemeral: true });
            }
            await expireStaleChallenges(guildId, client);
            const existingRoyale = await getActiveChallenge(guildId);
            if (existingRoyale) {
                return interaction.reply({ content: '❌ There is already an active faction challenge in this server. End it first with `/faction_challenge end`.', ephemeral: true });
            }
            const warsTodayR = await countFactionChallengesToday(guildId);
            if (warsTodayR >= 3) {
                return interaction.reply({
                    content: '❌ This server already used **3 faction wars** this **UTC** day. Try again tomorrow.',
                    ephemeral: true,
                });
            }
            const challengeModeR = 'ranked';
            const durationHrsR = interaction.options.getInteger('duration_hours');
            let { gameType: gameTypeR, scoringMode: scoringModeR, topN: topNR } = resolveFactionChallengeCreateOptions(configFc, {
                gameType: interaction.options.getString('game_type'),
                scoringMode: null,
                topN: null,
            });
            const maxPerRawR = interaction.options.getInteger('max_per_team');
            let maxPerTeamR = maxPerRawR != null && maxPerRawR >= 1 ? Math.min(25, maxPerRawR) : null;
            let pointCapR = null;

            scoringModeR = RANKED_FIXED_SCORING_MODE;
            topNR = RANKED_FIXED_TOP_N;
            const vErrsR = validateChallengeCreateParams({
                challengeMode: 'ranked',
                pointCap: pointCapR,
                maxPerTeam: maxPerTeamR,
                scoringMode: scoringModeR,
                topN: topNR,
                warVersion: RANKED_SLASH_CREATE_WAR_VERSION,
            });
            if (vErrsR.length) {
                return interaction.reply({ content: `❌ ${vErrsR[0]}`, ephemeral: true });
            }

            const gameTypesArrR = resolveGameTypesArrayForChallenge(null, gameTypeR);
            const platSettingsR = await getSettings();
            const rankedGtErrsR = validateRankedChallengeGameSelection(gameTypesArrR, platSettingsR);
            if (rankedGtErrsR.length) {
                return interaction.reply({ content: `❌ ${rankedGtErrsR[0]}`, ephemeral: true });
            }
            const legacyGameTypeR =
                gameTypesArrR.length === 1 ? gameTypesArrR[0] : gameTypesArrR.includes('all') ? 'all' : gameTypesArrR[0];
            const gameFilterLabelR = formatChallengeGameFilterLabel({ gameTypes: gameTypesArrR, gameType: legacyGameTypeR });
            const contributionCapsFromSlashR = parseContributionCapsCsv(interaction.options.getString('contribution_caps'));
            const contributionCapsByTagR = (() => {
                if (challengeModeR !== 'ranked') return null;
                const cfgCaps = rankedContributionCapsFromConfig(configFc);
                const merged = { ...(cfgCaps || {}), ...(contributionCapsFromSlashR || {}) };
                return Object.keys(merged).length ? merged : null;
            })();
            const rankedSnapR = buildRankedRulesSnapshot({
                challengeMode: challengeModeR,
                scoringMode: scoringModeR,
                topN: topNR,
                maxPerTeam: maxPerTeamR,
                gameTypes: gameTypesArrR,
                contributionCapsByTag: contributionCapsByTagR,
                pointCap: pointCapR,
            });

            const capLineR = pointCapR
                ? `\nPoint goal: **${pointCapR.toLocaleString()}** enrolled **war total** (first team there wins).`
                : '';
            const modeExplainR =
                '\n\n**Official ranked royale** — affects **global** standings (**match points**: win **+3**, shared ties **+1** where rules say so). **Only /playgame** games score; hosted commands never count.';

            const endAtR = new Date(Date.now() + durationHrsR * 3600000);
            const prepMinutesR = interaction.options.getInteger('prep_minutes') ?? 0;
            const finalHourMinutesR = interaction.options.getInteger('final_hour_minutes') ?? 60;
            const finalHourModeR = interaction.options.getString('final_hour_mode') ?? 'none';
            const createNowR = new Date();
            const prepEndsAtR = new Date(createNowR.getTime() + Math.max(0, prepMinutesR) * 60000);
            let finalHourStartsAtR = new Date(endAtR.getTime() - Math.max(0, finalHourMinutesR) * 60000);
            if (finalHourStartsAtR.getTime() < prepEndsAtR.getTime()) finalHourStartsAtR = prepEndsAtR;
            const platDayR = await GamePlatformDay.findOne({ dayUtc: utcDayString() }).lean();
            const warFeaturedTagsR = [...new Set((platDayR?.rankedFeaturedTags || []).map((t) => String(t).toLowerCase()))]
                .filter(Boolean)
                .slice(0, 8);
            const participantsByFaction = new Map();
            for (const n of ROYALE_FACTIONS) participantsByFaction.set(n, []);
            await FactionChallenge.create({
                guildId,
                challengeMode: challengeModeR,
                challengeType: 'royale',
                factionA: ROYALE_FACTIONS[0],
                factionB: ROYALE_FACTIONS[1],
                battleFactions: [...ROYALE_FACTIONS],
                participantsByFaction,
                gameType: legacyGameTypeR,
                gameTypes: gameTypesArrR,
                scoringMode: scoringModeR,
                topN: topNR,
                pointCap: pointCapR,
                maxPerTeam: maxPerTeamR,
                warVersion: RANKED_SLASH_CREATE_WAR_VERSION,
                contributionCapsByTag: contributionCapsByTagR,
                rankedRulesSnapshot: rankedSnapR,
                status: 'active',
                createdBy: interaction.user.id,
                participantsA: [],
                participantsB: [],
                endAt: endAtR,
                prepMinutes: prepMinutesR,
                finalHourMinutes: finalHourMinutesR,
                finalHourMode: finalHourModeR,
                prepEndsAt: prepEndsAtR,
                finalHourStartsAt: finalHourStartsAtR,
                warFeaturedTags: warFeaturedTagsR,
            });
            const matchupLineRoyaleLive = await formatFactionWarMatchupLine(configFc, {
                isRoyale: true,
                factionA: ROYALE_FACTIONS[0],
                factionB: ROYALE_FACTIONS[1],
                battleFactions: [...ROYALE_FACTIONS],
            });
            const announcedR = await announceFactionChallengeToGuild(client, guildId, configFc, {
                matchupLine: matchupLineRoyaleLive,
                endAt: endAtR,
                gameType: legacyGameTypeR,
                gameFilterLabel: gameFilterLabelR,
                scoringMode: scoringModeR,
                topN: topNR,
                pointCap: pointCapR,
                maxPerTeam: maxPerTeamR,
                isRoyale: true,
                factionA: ROYALE_FACTIONS[0],
                factionB: ROYALE_FACTIONS[1],
                battleFactions: [...ROYALE_FACTIONS],
                challengeMode: challengeModeR,
            });
            const pubLineR = announcedR ? `\n\n📣 Posted to <#${configFc.announceChannel}>.` : '';
            const royaleLineLive = ROYALE_FACTIONS.map((n) => formatFactionDualLabel(n, configFc)).join(' vs ');
            const royaleWayN = ROYALE_FACTIONS.length;
            return interaction.reply({
                content:
                    `✅ **${royaleWayN}-way faction royale!** **${royaleLineLive}** — ends <t:${Math.floor(endAtR.getTime() / 1000)}:F>. Members use \`/faction_challenge join\` to enroll.` +
                    `\n\nGames: \`${gameFilterLabelR}\`\n` +
                    `Scoring: **${RANKED_SCORING_DISPLAY_LABEL}**${capLineR}${modeExplainR}${pubLineR}\n\n` +
                    `_Only **enrolled** players contribute. Only **allowed game types** count._`,
                ephemeral: true,
            });
        }

        if (sub === 'join') {
            await expireStaleChallenges(guildId, client);
            const ch = await getActiveChallenge(guildId);
            if (!ch) {
                return interaction.reply({ content: '❌ There is no active faction challenge in this server.', ephemeral: true });
            }
            const user = await getUser(guildId, interaction.user.id);
            if (!user.faction) {
                return interaction.reply({ content: '❌ Join a global faction first with `/faction join` (use the **name** option).', ephemeral: true });
            }
            const doc = await FactionChallenge.findById(ch._id);
            if (isRoyale(doc)) {
                if (!doc.battleFactions?.includes(user.faction)) {
                    const pool = (doc.battleFactions || []).map((n) => formatFactionDualLabel(n, configFc)).join(', ');
                    return interaction.reply({
                        content: `❌ Your faction isn’t in this royale. Enrolled teams: ${pool || '—'}.`,
                        ephemeral: true,
                    });
                }
                let sideList = doc.participantsByFaction.get(user.faction);
                if (!sideList) {
                    sideList = [];
                    doc.participantsByFaction.set(user.faction, sideList);
                }
                if (sideList.includes(interaction.user.id)) {
                    return interaction.reply({ content: '✅ You are already enrolled in this challenge.', ephemeral: true });
                }
                if (isRosterFullForFaction(doc, user.faction)) {
                    return interaction.reply({
                        content: `❌ **${formatFactionDualLabel(user.faction, configFc)}** roster is full (**${doc.maxPerTeam}**). Only the first **${doc.maxPerTeam}** who joined can score for this war.`,
                        ephemeral: true,
                    });
                }
                sideList.push(interaction.user.id);
                doc.markModified('participantsByFaction');
                await doc.save();
                const nWayJoin = doc.battleFactions?.length || ROYALE_FACTIONS.length;
                return interaction.reply({
                    content:
                        `✅ **Enrolled** for **${formatFactionDualLabel(user.faction, configFc)}** in the **${nWayJoin}-way** royale.\n` +
                        `_Only **enrolled** players contribute. Only **allowed game types** count._`,
                    ephemeral: true,
                });
            }
            if (user.faction !== doc.factionA && user.faction !== doc.factionB) {
                return interaction.reply({
                    content: `❌ This challenge is only for **${formatFactionDualLabel(doc.factionA, configFc)}** and **${formatFactionDualLabel(doc.factionB, configFc)}**.`,
                    ephemeral: true,
                });
            }
            const listKey = user.faction === doc.factionA ? 'participantsA' : 'participantsB';
            const list = doc[listKey];
            if (list.includes(interaction.user.id)) {
                return interaction.reply({ content: '✅ You are already enrolled in this challenge.', ephemeral: true });
            }
            if (isRosterFullForFaction(doc, user.faction)) {
                return interaction.reply({
                    content: `❌ **${formatFactionDualLabel(user.faction, configFc)}** roster is full (**${doc.maxPerTeam}**). Only the first **${doc.maxPerTeam}** who joined can score for this war.`,
                    ephemeral: true,
                });
            }
            list.push(interaction.user.id);
            await doc.save();
            return interaction.reply({
                content:
                    `✅ **Enrolled** for **${formatFactionDualLabel(user.faction, configFc)}**.\n` +
                    `_Only **enrolled** players contribute. Only **allowed game types** count._`,
                ephemeral: true,
            });
        }

        if (sub === 'status') {
            await expireStaleChallenges(guildId, client);
            const ch = await getActiveChallenge(guildId);
            if (!ch) {
                return interaction.reply({ content: '❌ There is no active faction challenge in this server.', ephemeral: true });
            }
            const stCfg = await getSystemConfig(guildId);
            const stFacNames = isRoyale(ch) ? [...(ch.battleFactions || ROYALE_FACTIONS)] : [ch.factionA, ch.factionB];
            const stFacRows = await Faction.find({ name: { $in: stFacNames } }).select('name emoji').lean();
            const stEmojiBy = new Map(stFacRows.map((d) => [d.name, d.emoji]));
            const stWarLabel = (name) => {
                const em = getFactionDisplayEmoji(name, stCfg, stEmojiBy.get(name));
                const dual = formatFactionDualLabel(name, stCfg);
                return `${em} ${dual}`;
            };
            const { valueA, valueB, label, teams } = computeScores(ch);
            const winnerSide = pickChallengeWinner(ch);
            const rankedSt = isChallengeRanked(ch);
            const badgeSt = rankedSt ? '🏛️ Official ranked war' : '🎉 Casual challenge';
            const title = `${badgeSt} · ${isRoyale(ch) ? 'Royale (active)' : 'Duel (active)'}`;
            const scoreNote = `\n\n_War totals use **base** mini-game score only (not full **${ARENA_SCORE}** bonuses like streak / Premium / pass / aura)._`;
            const fairnessSt = rankedSt
                ? `\n\n_Global standings use **match results** (win +3 / tie +1), not raw grinding. Below: **official score** (fair formula) and **raw contribution**._`
                : `\n\n_Local fun only — this challenge does **not** change global standings._`;
            const filterLbl = formatChallengeGameFilterLabel(ch);
            const desc = isRoyale(ch)
                ? `${stFacNames.map((n) => stWarLabel(n)).join(' vs ')}\n\nGames: \`${filterLbl}\` · ${label}\n\nEnds: <t:${Math.floor(ch.endAt.getTime() / 1000)}:R>${scoreNote}${fairnessSt}`
                : `${stWarLabel(ch.factionA)} vs ${stWarLabel(ch.factionB)}\n\nGames: \`${filterLbl}\` · ${label}\n\nEnds: <t:${Math.floor(ch.endAt.getTime() / 1000)}:R>${scoreNote}${fairnessSt}`;
            const embed = new EmbedBuilder().setColor('#FF6347').setTitle(title).setDescription(desc);
            const stViewer = await getUser(guildId, interaction.user.id);
            const stEnrolled =
                stViewer.faction &&
                (await isUserEnrolledInActiveFactionChallenge(guildId, interaction.user.id, stViewer.faction));
            if (isRoyale(ch) && teams && teams.length > 2) {
                for (const t of teams) {
                    embed.addFields({
                        name: stWarLabel(t.name).slice(0, 256),
                        value:
                            `Official score: **${t.value.toFixed(2)}**\n\nRaw contribution: **${teamRawPointSum(ch, t.name).toLocaleString()}**`,
                        inline: true,
                    });
                }
                const enrolledR = teams.map((t) => `${stWarLabel(t.name)}: ${getParticipantIds(ch, t.name).length}`).join(' · ');
                embed.addFields(
                    { name: 'Leading', value: winnerSide ? stWarLabel(winnerSide) : '**Tie**', inline: false },
                    { name: 'Enrolled', value: enrolledR.slice(0, 1020), inline: false },
                );
            } else {
                embed.addFields(
                    {
                        name: stWarLabel(ch.factionA).slice(0, 256),
                        value: `Official score: **${valueA.toFixed(2)}**\n\nRaw contribution: **${teamRawPointSum(ch, ch.factionA).toLocaleString()}**`,
                        inline: true,
                    },
                    {
                        name: stWarLabel(ch.factionB).slice(0, 256),
                        value: `Official score: **${valueB.toFixed(2)}**\n\nRaw contribution: **${teamRawPointSum(ch, ch.factionB).toLocaleString()}**`,
                        inline: true,
                    },
                    { name: 'Leading', value: winnerSide ? stWarLabel(winnerSide) : '**Tie**', inline: false },
                    { name: 'Enrolled', value: `${ch.participantsA.length} vs ${ch.participantsB.length}`, inline: false },
                );
            }
            if (ch.pointCap) {
                embed.addFields({
                    name: 'Point goal',
                    value: `**${Number(ch.pointCap).toLocaleString()}** enrolled **war total** (first team there wins)`,
                    inline: false,
                });
            }
            if (ch.maxPerTeam) {
                const cap = Number(ch.maxPerTeam);
                if (isRoyale(ch) && teams && teams.length > 2) {
                    const bits = teams
                        .map((t) => `${stWarLabel(t.name)}: ${getParticipantIds(ch, t.name).length}/${cap}`)
                        .join(' · ');
                    embed.addFields({ name: 'Roster cap', value: `**${cap}** per faction · ${bits}`.slice(0, 1020), inline: false });
                } else {
                    embed.addFields({
                        name: 'Roster cap',
                        value: `**${cap}** per side · ${stWarLabel(ch.factionA)}: ${ch.participantsA.length}/${cap} · ${stWarLabel(ch.factionB)}: ${ch.participantsB.length}/${cap}`.slice(
                            0,
                            1020,
                        ),
                        inline: false,
                    });
                }
            }
            embed.addFields({
                name: 'Challenge rules',
                value:
                    'Only **enrolled** players contribute · only **allowed game types** count.\n\n' +
                    (rankedSt
                        ? '**Ranked:** only **/playgame** platform games (hosted /trivia etc. never count) · **top 5 average** official score.'
                        : '**Casual:** hosted games may count if the filter includes them.'),
                inline: false,
            });
            const myCountedWar = stEnrolled ? getScoreByUser(ch, interaction.user.id) : 0;
            const myRawWar = stEnrolled ? getRawScoreByUser(ch, interaction.user.id) : 0;
            embed.addFields({
                name: 'Your enrollment',
                value: stEnrolled
                    ? `✅ **Enrolled** — qualifying games add to your faction.\n\nYour **official counted** war score: **${myCountedWar.toLocaleString()}** · Raw: **${myRawWar.toLocaleString()}**`
                    : '⚪ **Not enrolled** — run `/faction_challenge join` to earn points for your faction.',
                inline: false,
            });
            if (stViewer.isPremium) {
                const rosterInsight = formatPremiumWarRosterInsight(ch, interaction.user.id, stViewer.faction, stEnrolled);
                if (rosterInsight) {
                    embed.addFields({
                        name: '💎 Premium · Roster breakdown',
                        value: rosterInsight.slice(0, 1020),
                        inline: false,
                    });
                } else if (stViewer.faction) {
                    embed.addFields({
                        name: '💎 Premium · Roster breakdown',
                        value:
                            'Run `/faction_challenge join` to unlock **team counted totals**, per-player averages, and **your** share vs the roster — _same war rules for everyone_.',
                        inline: false,
                    });
                }
            }
            return interaction.reply({ embeds: [embed] });
        }

        if (sub === 'history') {
            const limitRaw = interaction.options.getInteger('limit');
            const histActor = await getUser(guildId, interaction.user.id);
            const histCap = histActor.isPremium ? 25 : 15;
            const limit = Math.min(histCap, Math.max(1, limitRaw ?? 10));
            await expireStaleChallenges(guildId, client);
            const past = await FactionChallenge.find({ guildId, status: 'ended' })
                .sort({ endedAt: -1 })
                .limit(limit);
            if (!past.length) {
                return interaction.reply({ content: 'No ended faction challenges in this server yet.', ephemeral: true });
            }
            const histCfg = await getSystemConfig(guildId);
            const lines = past.map((c, i) => {
                const matchup = isRoyale(c)
                    ? (c.battleFactions || []).map((n) => formatFactionDualLabel(n, histCfg)).join(' vs ')
                    : `${formatFactionDualLabel(c.factionA, histCfg)} vs ${formatFactionDualLabel(c.factionB, histCfg)}`;
                const endTs = c.endedAt ? Math.floor(c.endedAt.getTime() / 1000) : null;
                const endStr = endTs ? `<t:${endTs}:D>` : '—';
                const w = c.winnerFaction || 'Tie';
                const modeHist = isChallengeRanked(c) ? '**ranked**' : 'casual';
                const globalHist = isChallengeRanked(c)
                    ? c.globalTotalsApplied
                        ? ' · global standings updated'
                        : ''
                    : ' · local only';
                return `**${i + 1}.** ${modeHist} · ${matchup} · **${w}** · ended ${endStr}${globalHist}`;
            });
            const embed = new EmbedBuilder()
                .setColor('#FF6347')
                .setTitle('Faction challenge history')
                .setDescription(lines.join('\n\n').slice(0, 4090));
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (sub === 'end') {
            const actor = await getUser(guildId, interaction.user.id);
            if (!actor.isPremium) {
                return interaction.reply({ content: '❌ **Faction challenges** require **PlayBound Premium** to manage.', ephemeral: true });
            }
            if (!canFcManage) {
                return interaction.reply({ content: fcPermDeny, ephemeral: true });
            }
            await expireStaleChallenges(guildId, client);
            const ch = await getActiveChallenge(guildId);
            if (!ch) {
                return interaction.reply({ content: '❌ No active faction challenge to end.', ephemeral: true });
            }
            ch.status = 'ended';
            ch.endedAt = new Date();
            ch.winnerFaction = pickChallengeWinner(ch);
            await ch.save();
            await applyEndedChallengeToGlobalTotals(client, guildId, ch._id);
            await grantFactionVictoryRoleIfConfigured(client, guildId, ch.winnerFaction, ch);
            await grantWarEndPersonalCredits(client, guildId, ch._id);
            const w = ch.winnerFaction;
            const summary = w ? `**${w}** wins!` : '**Tie** — no single winner.';
            const afterEnd = await FactionChallenge.findById(ch._id).lean();
            let globalTail = '';
            if (afterEnd && isChallengeRanked(afterEnd)) {
                globalTail = afterEnd.rankedResultSummary
                    ? `\n${afterEnd.rankedResultSummary}\n_This ranked result updated **global** faction standings._`
                    : '\n_Global standings updated (**match points**)._';
            } else if (afterEnd) {
                globalTail = '\n_Casual challenge — **global standings unchanged**._';
            }
            return interaction.reply({ content: `🏁 Challenge ended. ${summary}${globalTail}`, ephemeral: true });
        }
    }

    if (interaction.commandName === 'profile') {
        const targetDiscord = interaction.options.getUser('user') || interaction.user;
        const viewingSelf = targetDiscord.id === interaction.user.id;

        if (!viewingSelf) {
            const actor = await getUser(guildId, interaction.user.id);
            if (!actor.isPremium && !isBotDeveloper(interaction.user.id)) {
                return interaction.reply({
                    content:
                        '💎 **Premium** unlocks **profile peek**: `/profile user:@member` to view another player’s stats and equipped cosmetics in this channel.\n\nUse `/premium` to subscribe.',
                    ephemeral: true,
                });
            }
        }

        let profileUser;
        if (viewingSelf) {
            profileUser = await getUser(guildId, targetDiscord.id);
        } else {
            profileUser = await User.findOne({ guildId, userId: targetDiscord.id });
            if (!profileUser) {
                return interaction.reply({
                    content: `No profile for <@${targetDiscord.id}> in this server yet—they need to use the bot here first (e.g. a command or game).`,
                    allowedMentions: { users: [] },
                });
            }
        }

        const config = await getSystemConfig(guildId);
        const achKeys = profileUser.achievements || [];
        const achSummary =
            achKeys.length === 0
                ? 'None yet!'
                : `**${achKeys.length}** unlocked — use a **dropdown** below to read any one in full.`;

        const globalItems = await ShopItem.find();
        const serverItems = config.shopItems || [];

        let titleBadge = profileUser.isPremium
            ? `${PROFILE_GLYPH.diamond} Premium Profile`
            : `${PROFILE_GLYPH.person} Profile`;
        if (profileUser.currentCosmetics && profileUser.currentCosmetics.get('badge')) {
            const bId = profileUser.currentCosmetics.get('badge');
            const bItem = globalItems.find(x => x.id === bId) || serverItems.find(x => x.id === bId);
            if (bId === 'premium_badge_diamond') titleBadge = `${PROFILE_GLYPH.diamond} Diamond Profile`;
            else if (bId === 'badge_star') titleBadge = `${PROFILE_GLYPH.star} VIP Profile`;
            else if (bItem) {
                const em = bItem.leaderboardEmoji ? `${bItem.leaderboardEmoji} ` : '';
                titleBadge = `${em}${bItem.name} Profile`.trim();
            }
        }

        let embedColor = profileUser.isPremium ? '#00FFFF' : '#00FF00';
        if (profileUser.currentCosmetics && profileUser.currentCosmetics.get('color')) {
            const cId = profileUser.currentCosmetics.get('color');
            const cItem = globalItems.find(x => x.id === cId) || serverItems.find(x => x.id === cId);
            if (cItem && cItem.profileColorHex) {
                embedColor = cItem.profileColorHex;
            } else if (cId === 'role_color_gold') {
                embedColor = '#FFD700';
            } else if (cId === 'premium_color_crystal') {
                embedColor = '#AEEEEE';
            } else {
                embedColor = '#FF00FF';
            }
        }

        let displayName = targetDiscord.username;
        try {
            const member = await interaction.guild.members.fetch(targetDiscord.id);
            displayName = member.displayName || member.user.username;
        } catch {
            /* user may have left the server */
        }

        const engagementProf = await EngagementProfile.findOne({ guildId, userId: targetDiscord.id }).lean();
        const duelProf = await DuelProfile.findOne({ guildId, userId: targetDiscord.id }).lean();

        let factionProfileField = null;
        if (profileUser.faction) {
            const profileFacDoc = await Faction.findOne({ name: profileUser.faction })
                .select('emoji matchPoints rankedWins rankedLosses rankedTies rawWarContributionTotal totalPoints')
                .lean();
            const pfEm = getFactionDisplayEmoji(profileUser.faction, config, profileFacDoc?.emoji);
            const pfDual = formatFactionDualLabel(profileUser.faction, config);
            const premiumFactionTail =
                viewingSelf && profileUser.isPremium
                    ? `\n\n${PROFILE_GLYPH.diamond} **Premium:** \`/factions\` shows **match-point** gaps on the board; \`/season\` shows **quarterly** place ${PROFILE_GLYPH.mdash} **war credit** stays **base-only** for everyone.`
                    : '';
            factionProfileField = {
                name: `${PROFILE_GLYPH.swords} Faction`,
                value:
                    `**${pfEm} ${pfDual}**\n\n` +
                    `_Official faction: \`${profileUser.faction}\` ${PROFILE_GLYPH.mdash} server display may differ._\n\n` +
                    `Official war record: **${profileFacDoc?.matchPoints ?? 0}** match pts ${PROFILE_GLYPH.dot} **W** ${profileFacDoc?.rankedWins ?? 0} ${PROFILE_GLYPH.dot} **L** ${profileFacDoc?.rankedLosses ?? 0} ${PROFILE_GLYPH.dot} **T** ${profileFacDoc?.rankedTies ?? 0}\n\n` +
                    `_Ranked raw total **${profileFacDoc?.rawWarContributionTotal ?? 0}** ${PROFILE_GLYPH.dot} Legacy pts **${profileFacDoc?.totalPoints ?? 0}**_\n\n` +
                    `_Use **/factions** for the global board (match results, not raw grind)._${premiumFactionTail}`,
                inline: true,
            };
        }

        const profileFields = [
            {
                name: `${PROFILE_GLYPH.coin} Scores`,
                value:
                    `**${CREDITS}:** **${profileUser.points || 0}**\n\n` +
                    `**${ARENA_SCORE}:** **${profileUser.competitivePoints || 0}**\n\n` +
                    `Weekly / monthly (**${CREDITS}** cadence): **${profileUser.weeklyPoints || 0}** ${PROFILE_GLYPH.dot} **${profileUser.monthlyPoints || 0}**`,
                inline: true,
            },
            ...(factionProfileField ? [factionProfileField] : []),
            { name: `${PROFILE_GLYPH.fire} Streak`, value: `**${profileUser.currentStreak || 0}** days`, inline: true },
            ...(engagementProf &&
            (engagementProf.displayTitle || engagementProf.favoriteGameTag || (engagementProf.seasonXp || 0) > 0)
                ? [
                      {
                          name: '🎯 Identity',
                          value: [
                              engagementProf.displayTitle ? `Title: **${engagementProf.displayTitle}**` : null,
                              engagementProf.favoriteGameTag
                                  ? `Favorite /playgame: \`${engagementProf.favoriteGameTag}\``
                                  : null,
                              (engagementProf.seasonXp || 0) > 0
                                  ? `Season XP: **${engagementProf.seasonXp}**`
                                  : null,
                          ]
                              .filter(Boolean)
                              .join('\n'),
                          inline: true,
                      },
                  ]
                : []),
            ...(duelProf && (duelProf.wins > 0 || duelProf.losses > 0)
                ? [
                      {
                          name: '⚔️ Duels (trivia)',
                          value: `**W** ${duelProf.wins} · **L** ${duelProf.losses} · Streak **${duelProf.streak}** · Rating **${Math.round(duelProf.rating)}** _(not war score)_`,
                          inline: true,
                      },
                  ]
                : []),
            {
                name: `${PROFILE_GLYPH.cake} Birthday`,
                value: viewingSelf ? (profileUser.birthday || 'Not set') : `${PROFILE_GLYPH.mdash}`,
                inline: true,
            },
            {
                name: `${PROFILE_GLYPH.chart} Stats`,
                value: `Messages: ${profileUser.stats?.messagesSent || 0}\n\nGiveaways entered: ${profileUser.stats?.giveawaysEntered || 0}`,
            },
            { name: `${PROFILE_GLYPH.trophy} Achievements`, value: achSummary.slice(0, 1024) },
        ];
        if (viewingSelf) {
            const rp = await ReferralProfile.findOne({ userId: targetDiscord.id }).lean();
            const ex = getExcludedGuildIds();
            const serverInvitesDone = await ReferralFirstGamePayout.countDocuments({
                referrerUserId: targetDiscord.id,
                ...(ex.length ? { guildId: { $nin: ex } } : {}),
            });
            if (rp && (serverInvitesDone > 0 || (rp.referralServerPointsEarned || 0) + (rp.referralFactionPointsEarned || 0) > 0)) {
                profileFields.push({
                    name: `${PROFILE_GLYPH.megaphone} Referrals`,
                    value: `**${serverInvitesDone}** server invites completed (excludes test servers) ${PROFILE_GLYPH.dot} \`/invites\` for full stats`,
                    inline: false,
                });
            }
        }
        if (viewingSelf && profileUser.pointLedger && profileUser.pointLedger.length > 0) {
            const hist = profileUser.pointLedger
                .slice(0, 10)
                .map((e) => {
                    const ts = Math.floor(new Date(e.at).getTime() / 1000);
                    const sign = e.amount >= 0 ? '+' : '';
                    return `${sign}${e.amount} ${PROFILE_GLYPH.dot} ${e.label} ${PROFILE_GLYPH.dot} <t:${ts}:R>`;
                })
                .join('\n\n');
            profileFields.push({ name: `${PROFILE_GLYPH.scroll} Recent ledger`, value: hist.slice(0, 1020) });
        } else if (viewingSelf) {
            profileFields.push({
                name: `${PROFILE_GLYPH.scroll} Recent ledger`,
                value: `_**${CREDITS}**, duels, dailies, shop, admin adjustments ${PROFILE_GLYPH.mdash} new lines appear here._`,
            });
        }

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(`${titleBadge}: ${displayName}`)
            .setThumbnail(targetDiscord.displayAvatarURL({ size: 256 }))
            .addFields(profileFields);

        if (!viewingSelf) {
            embed.setFooter({ text: `Requested by ${interaction.user.username}` });
        }

        const profileComponents = [];
        if (achKeys.length > 0) {
            const PAGE = 25;
            const maxPages = Math.min(5, Math.ceil(achKeys.length / PAGE));
            for (let page = 0; page < maxPages; page++) {
                const slice = achKeys.slice(page * PAGE, page * PAGE + PAGE);
                const menu = new StringSelectMenuBuilder()
                    .setCustomId(`pach:${interaction.user.id}:${guildId}:${targetDiscord.id}:${page}`)
                    .setPlaceholder(`Achievements ${page * PAGE + 1}–${page * PAGE + slice.length} of ${achKeys.length}`)
                    .addOptions(
                        slice.map((key, i) => {
                            const m = resolveAchievementMeta(key, config);
                            const rawLabel = m ? formatAchievementLabel(m) : key;
                            const label = rawLabel.length > 100 ? `${rawLabel.slice(0, 97)}…` : rawLabel;
                            const dsc = m?.desc
                                ? m.desc.length > 100
                                    ? `${m.desc.slice(0, 97)}…`
                                    : m.desc
                                : undefined;
                            return { label, description: dsc, value: String(i) };
                        }),
                    );
                profileComponents.push(new ActionRowBuilder().addComponents(menu));
            }
        }

        await interaction.reply({ embeds: [embed], components: profileComponents });
    }

    if (await triviaGame.handleInteraction(interaction, client)) return;

    if (interaction.commandName === 'moviequotes') {
        if (activeMovieGames.has(interaction.channelId)) return interaction.reply({ content: 'A TV & Movie Quotes game is already in progress!', ephemeral: true });

        const roundSecondsOpt = interaction.options.getInteger('round_seconds');
        const roundSeconds = roundSecondsOpt == null ? 90 : Math.max(0, Math.min(roundSecondsOpt, 600));
        const sessionMinOpt = interaction.options.getInteger('session_minutes');
        const sessionMinutes =
            sessionMinOpt == null ? null : Math.max(1, Math.min(sessionMinOpt, 24 * 60));
        const threadName = interaction.options.getString('thread_name') || defaultGameThreadName('TV & Movie Quotes');
        const pointsOption = interaction.options.getString('points') || DEFAULT_PLACEMENT_POINTS;
        const delay = getSlashScheduleDelayMs(interaction);

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const mqHost = await getUser(guildId, interaction.user.id);
        const rounds = clampHostGameInt(interaction.options.getInteger('rounds'), mqHost.isPremium, 'movieRounds');

        const start = async () => {
            try {
                const catalog = await MovieQuote.find({});
                if (catalog.length < rounds) {
                    return interaction.followUp({ content: `❌ Not enough TV & movie quotes in the database (have ${catalog.length}, need ${rounds}).`, ephemeral: true });
                }

                const movieMaintMs =
                    sessionMinutes != null
                        ? sessionMinutes * 60000
                        : rounds * (Math.max(30, roundSeconds) + 25) * 1000;
                throwIfImmediateGameStartBlockedByMaintenance(Date.now(), movieMaintMs);

                const thread = await createHostedGamePublicThread(interaction.channel, threadName);
                
                activeMovieGames.set(thread.id, { 
                    guildId, 
                    parentChannelId: interaction.channelId, 
                    threadId: thread.id, 
                    totalRounds: rounds, 
                    currentRound: 0,
                    catalog: catalog,
                    scores: {}, 
                    pointValues: parsePointValues(pointsOption, DEFAULT_PLACEMENT_POINTS), 
                    currentMovie: null, 
                    roundStartTime: 0,
                    roundSeconds,
                    roundTimeoutHandle: null,
                    sessionTimeoutHandle: null,
                    hostIsPremium: mqHost.isPremium === true,
                    premiumAuraBoost: false,
                });

                await createActiveGame(
                    guildId,
                    interaction.channelId,
                    thread.id,
                    'MovieQuotes',
                    {
                        totalRounds: rounds,
                        pointValues: parsePointValues(pointsOption, DEFAULT_PLACEMENT_POINTS),
                        scores: {},
                    },
                    0,
                    mqHost.isPremium === true,
                    { maintenanceEstimatedDurationMs: movieMaintMs },
                );
                registerAuraBoostTarget(thread.id, () => {
                    const mv = activeMovieGames.get(thread.id);
                    if (mv) mv.premiumAuraBoost = true;
                });

                await thread.send({ embeds: [makeGameFlairEmbed('moviequotes')], components: [auraBoostRow(thread.id)] });
                await nextMovieQuote(thread.id);
                const mv = activeMovieGames.get(thread.id);
                if (mv) {
                    if (sessionMinutes != null) {
                        mv.sessionTimeoutHandle = setTimeout(() => triggerMovieEnd(thread.id), sessionMinutes * 60000);
                    }
                    mv.announcementMessage = await sendGlobalAnnouncement(
                        client,
                        guildId,
                        sessionMinutes != null
                            ? `A **TV & Movie Quotes** game has started in <#${interaction.channelId}>! **${rounds} rounds** · ends in **${sessionMinutes} min** max.`
                            : `A **TV & Movie Quotes** game has started in <#${interaction.channelId}>! **${rounds} rounds**!`,
                        thread.id,
                    );
                }
                return thread.id;
            } catch (err) {
                console.error("Error starting TV & Movie Quotes game:", err);
                return null;
            }
        };

        if (delay > 0) { 
            const sid = await scheduleGame(guildId, 'TV & Movie Quotes', interaction.channelId, delay, start);
            const mqFc = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, delay, 'moviequotes');
            await interaction.editReply({ content: `Scheduled! (ID: \`${sid}\`)${mqFc}` });
            announceScheduledGame(client, guildId, 'TV & Movie Quotes', delay); 
        }
        else {
            const mqFc0 = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, 0, 'moviequotes');
            await interaction.editReply({ content: `Game starting!${mqFc0}` });
            const mqTid = await start();
            if (mqTid) {
                const mqTh = await client.channels.fetch(mqTid).catch(() => null);
                if (mqTh) {
                    await tryHostPremiumNudge(interaction, mqHost, {
                        gameType: 'MovieQuotes',
                        supportsRepeatHrs: true,
                        supportsPremiumCaps: true,
                    }).catch(() => {});
                    await sendPremiumBoostSessionHint(mqTh, mqHost.isPremium === true, {
                        guildId,
                        hostUserId: interaction.user.id,
                        gameType: 'MovieQuotes',
                        sessionId: mqTh.id,
                        hasAura: false,
                    }).catch(() => {});
                }
            }
        }
    }
    if (interaction.commandName === 'namethattune') {
        const hostChannel = resolveGameHostChannel(interaction);
        if (!hostChannel) {
            return interaction.reply({
                content:
                    '❌ Run `/namethattune` from a **normal text channel** (or forum channel). If you’re inside a **thread**, use the command in the parent channel instead — threads can’t host another game thread.',
                ephemeral: true,
            });
        }
        const parentChannelId = hostChannel.id;
        if ([...activeTunes.values()].some((t) => t.parentChannelId === parentChannelId)) {
            return interaction.reply({ content: 'A "Name That Tune" game is already in progress for this channel!', ephemeral: true });
        }

        const duration = Math.max(5, Math.min(interaction.options.getInteger('duration') ?? 30, 600));
        const genre = interaction.options.getString('genre') || 'pop';
        const query = interaction.options.getString('query');
        const threadName = interaction.options.getString('thread_name') || defaultGameThreadName('Name That Tune');
        const pointsOption = interaction.options.getString('points') || DEFAULT_PLACEMENT_POINTS;
        const delay = getSlashScheduleDelayMs(interaction);

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const tuneHost = await getUser(guildId, interaction.user.id);
        const rounds = clampHostGameInt(interaction.options.getInteger('rounds'), tuneHost.isPremium, 'tuneRounds');
        const totalRounds = rounds;

        const start = async () => {
            const afterSchedule = delay > 0;
            const tellUser = async (content) => {
                if (afterSchedule) {
                    await interaction.followUp({ content, ephemeral: true }).catch(() => {});
                } else {
                    await interaction.editReply({ content }).catch(() => {});
                }
            };

            // Deferred interactions show “thinking” until editReply. Voice + iTunes can take a long time;
            // acknowledge immediately so the user sees progress (and isn’t stuck on a blank loader).
            if (!afterSchedule) {
                await interaction
                    .editReply({
                        content:
                            '🎵 **Name That Tune** — fetching tracks and connecting to your voice channel…\n' +
                            '_If this hangs ~1 min, the host may be blocking **outbound UDP** to Discord voice._',
                    })
                    .catch(() => {});
            }

            let thread;
            const player = createAudioPlayer();
            player.on('error', (e) => console.error('[namethattune] AudioPlayer:', e));
            let connection = null;

            /** Shorter than default 120s so failed UDP/firewall cases fail faster. */
            const VOICE_READY_MS = 60_000;

            try {
                const voiceChannel = await resolveUserVoiceChannel(interaction.guild, interaction.user.id, interaction.member);
                if (!voiceChannel) {
                    await tellUser(
                        '❌ You must be **in a voice channel** when the game starts (the bot must see you connected). Join VC, wait a moment, then try again.',
                    );
                    return;
                }

                const searchTerm = query || genre;
                let tracks = [];

                if (searchTerm === 'mix') {
                    const genres = ['pop', 'rock', 'hiphop', '80s', '90s', 'country'];
                    const promises = genres.map((g) => axios.get(itunesSearchUrl(g, 80)));
                    const results = await Promise.all(promises);
                    results.forEach((res) => {
                        tracks = tracks.concat(itunesTracksWithEnglishPreviews(res.data.results || []));
                    });
                    tracks = dedupeItunesByTrackId(tracks);
                    tracks.sort(() => 0.5 - Math.random());
                } else {
                    const itunesRes = await axios.get(itunesSearchUrl(searchTerm, 200));
                    tracks = dedupeItunesByTrackId(itunesTracksWithEnglishPreviews(itunesRes.data.results || []));
                }

                if (tracks.length < rounds) {
                    await tellUser(`❌ Not enough tracks found for ${searchTerm}. Try a different search!`);
                    return;
                }

                try {
                    connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: interaction.guild.id,
                        adapterCreator: interaction.guild.voiceAdapterCreator,
                        selfDeaf: false,
                    });
                    connection.subscribe(player);
                    const onState = (o, n) =>
                        playboundDebugLog(`[namethattune] voice: ${o.status} → ${n.status}`);
                    connection.on('stateChange', onState);
                    try {
                        await entersState(connection, VoiceConnectionStatus.Ready, VOICE_READY_MS);
                    } finally {
                        connection.off('stateChange', onState);
                    }
                } catch (voiceErr) {
                    const aborted = voiceErr?.code === 'ABORT_ERR' || voiceErr?.name === 'AbortError';
                    console.error('[namethattune] voice connect/ready:', voiceErr);
                    if (aborted) {
                        console.error(
                            `[namethattune] Timed out waiting for voice Ready (${VOICE_READY_MS / 1000}s). Allow outbound UDP from this host to Discord voice endpoints, or try again.`,
                        );
                    }
                    try {
                        connection?.destroy();
                    } catch (_) {
                        /* ignore */
                    }
                    player.stop();
                    const voiceFailUser = aborted
                        ? '❌ Voice **timed out** while connecting. If the bot runs on a server, allow **outbound UDP** (Discord voice); otherwise try again in a moment.'
                        : '❌ Could not join your voice channel. Give the bot **Connect** and **Speak**, then try again.';
                    await tellUser(voiceFailUser);
                    return;
                }

                const tuneMaintMs = totalRounds * (duration + 30) * 1000 + 120_000;
                throwIfImmediateGameStartBlockedByMaintenance(Date.now(), tuneMaintMs);

                thread = await createHostedGamePublicThread(hostChannel, threadName);

                activeTunes.set(thread.id, {
                    guildId,
                    parentChannelId: parentChannelId,
                    threadId: thread.id,
                    voiceChannelId: voiceChannel.id,
                    rounds: rounds,
                    duration: duration,
                    tracks: tracks,
                    scores: {},
                    playerStats: {},
                    pointValues: parsePointValues(pointsOption, DEFAULT_PLACEMENT_POINTS),
                    timeoutHandle: null,
                    player,
                    connection,
                    currentSong: null,
                    roundStartTime: 0,
                    roundTimeout: null,
                    hostIsPremium: tuneHost.isPremium === true,
                    premiumAuraBoost: false,
                });

                await createActiveGame(
                    guildId,
                    parentChannelId,
                    thread.id,
                    'NameThatTune',
                    {
                        rounds,
                        pointValues: parsePointValues(pointsOption, DEFAULT_PLACEMENT_POINTS),
                        scores: {},
                        playerStats: {},
                    },
                    0,
                    tuneHost.isPremium === true,
                    { maintenanceEstimatedDurationMs: tuneMaintMs },
                );
                registerAuraBoostTarget(thread.id, () => {
                    const t = activeTunes.get(thread.id);
                    if (t) t.premiumAuraBoost = true;
                });

                const activeTune = activeTunes.get(thread.id);

                const startNextRound = async () => {
                    if (activeTune.roundTimeout) clearTimeout(activeTune.roundTimeout);
                    if (activeTune.rounds <= 0) {
                        await triggerTuneEnd(thread.id);
                        return;
                    }

                    const trackIdx = Math.floor(Math.random() * activeTune.tracks.length);
                    const track = activeTune.tracks.splice(trackIdx, 1)[0];
                    activeTune.currentSong = track.trackName;
                    activeTune.rounds--;
                    activeTune.roundStartTime = Date.now();

                    // FFmpeg’s built-in HTTP fetch often gets blocked or empty audio from Apple’s CDN
                    // (datacenter IPs / non-browser UA). Stream via axios with a normal browser profile.
                    let previewStream;
                    try {
                        const previewRes = await axios.get(track.previewUrl, {
                            responseType: 'stream',
                            timeout: 25_000,
                            maxContentLength: 8 * 1024 * 1024,
                            headers: {
                                'User-Agent':
                                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                                Accept: 'audio/aac,audio/mp4,audio/*;q=0.9,*/*;q=0.8',
                                Referer: 'https://music.apple.com/',
                            },
                        });
                        previewStream = previewRes.data;
                        previewStream.on('error', (err) =>
                            console.error('[namethattune] preview stream error:', err?.message || err),
                        );
                    } catch (fetchErr) {
                        console.error(
                            '[namethattune] preview fetch failed:',
                            track.previewUrl,
                            fetchErr?.message || fetchErr,
                        );
                        await thread.send(
                            '⚠️ **Could not load this preview**\n\n' +
                                'Apple’s CDN did not send audio (network or blocking). Trying another round in a moment…',
                        );
                        setTimeout(startNextRound, 2500);
                        return;
                    }

                    const resource = createAudioResource(previewStream);
                    activeTune.player.play(resource);

                    await thread.send(
                        `🎵 **Round ${totalRounds - activeTune.rounds}**\n\n` +
                            `🔊 Listen in <#${activeTune.voiceChannelId}> — you have **${duration}s**.\n\n` +
                            `✍️ **Type the song title** in this thread to guess.`,
                    );

                    activeTune.roundTimeout = setTimeout(async () => {
                        await thread.send(
                            `⏰ **Time's up!**\n\n` +
                                `The song was **${track.trackName}** by **${track.artistName}**.\n\n` +
                                `_Next round in a few seconds…_`,
                        );
                        activeTune.player.stop();
                        setTimeout(startNextRound, 3000);
                    }, duration * 1000);
                };

                const introContent = [
                    '🎵 **Name That Tune**',
                    '',
                    '---',
                    '',
                    `🔊 **Join <#${voiceChannel.id}>** to hear each preview (the bot plays audio there).`,
                    '',
                    `✍️ **Reply in this thread** with the **song title** to guess — you have **${duration}s** per round.`,
                    '',
                    `**${totalRounds}** rounds · _${searchTerm === 'mix' ? 'genre mix' : `search: ${searchTerm}`}_`,
                ].join('\n');

                await thread.send({
                    content: introContent,
                    embeds: [makeGameFlairEmbed('namethattune')],
                    components: [auraBoostRow(thread.id)],
                });

                await thread.send('—').catch(() => {});

                await hostChannel
                    .send(
                        `🎵 **Name That Tune** is live.\n\n` +
                            `🔊 Hear clips in <#${voiceChannel.id}>\n\n` +
                            `✍️ Post guesses in ${thread}`,
                    )
                    .catch(() => {});

                activeTune.startNextRound = startNextRound;
                await startNextRound();
                activeTune.announcementMessage = await sendGlobalAnnouncement(
                    client,
                    guildId,
                    `A \"Name That Tune\" game has started in <#${parentChannelId}>! **${totalRounds} rounds** — listen in <#${voiceChannel.id}> · guesses in the thread.`,
                    thread.id,
                );

                if (!afterSchedule) {
                    const ntFc0 = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, 0, 'namethattune');
                    await interaction
                        .editReply({
                            content: `✅ Started! **Listen:** <#${voiceChannel.id}> · **Guess in thread:** <#${thread.id}>${ntFc0}`,
                        })
                        .catch(() => {});
                    await tryHostPremiumNudge(interaction, tuneHost, {
                        gameType: 'NameThatTune',
                        supportsRepeatHrs: false,
                        supportsPremiumCaps: true,
                    }).catch(() => {});
                    await sendPremiumBoostSessionHint(thread, tuneHost.isPremium === true, {
                        guildId,
                        hostUserId: interaction.user.id,
                        gameType: 'NameThatTune',
                        sessionId: thread.id,
                        hasAura: false,
                    }).catch(() => {});
                }
            } catch (err) {
                console.error('Error starting iTunes Tune Game:', err);
                try {
                    connection?.destroy();
                } catch (_) {
                    /* ignore */
                }
                try {
                    player.stop();
                } catch (_) {
                    /* ignore */
                }
                if (thread?.id) {
                    activeTunes.delete(thread.id);
                    await endActiveGame(thread.id, client).catch(() => {});
                    await thread.delete().catch(() => {});
                }
                await tellUser(`❌ Could not start Name That Tune: ${err.message || 'Unknown error'}`);
            }
        };

        if (delay > 0) {
            const sid = await scheduleGame(guildId, 'Name That Tune', parentChannelId, delay, start);
            const ntFc = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, delay, 'namethattune');
            await interaction.editReply({ content: `Scheduled! (ID: \`${sid}\`)${ntFc}` });
            announceScheduledGame(client, guildId, 'Name That Tune', delay);
        } else {
            await start();
        }
    }
    if (interaction.commandName === 'caption') {
        const dur = interaction.options.getInteger('duration') || 10;
        const threadName = interaction.options.getString('thread_name') || defaultGameThreadName('Caption Contest');
        const ptsOpt = interaction.options.getString('points') || DEFAULT_SINGLE_WINNER_POINTS;
        const delay = getSlashScheduleDelayMs(interaction);
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const capHost = await getUser(guildId, interaction.user.id);
        const capHostPremium = capHost.isPremium === true;

        const start = async () => {
            throwIfImmediateGameStartBlockedByMaintenance(Date.now(), dur * 60000);
            let imageUrl = '';
            try {
                const apiChoice = Math.random();
                if (apiChoice < 0.20) { imageUrl = (await axios.get('https://api.thecatapi.com/v1/images/search')).data[0].url; }
                else if (apiChoice < 0.40) { imageUrl = (await axios.get('https://dog.ceo/api/breeds/image/random')).data.message; }
                else if (apiChoice < 0.60) { const res = await axios.get('https://api.bunnies.io/v2/loop/random/?media=gif,png'); imageUrl = res.data.media.gif || res.data.media.poster; }
                else if (apiChoice < 0.80) { imageUrl = (await axios.get('https://randomfox.ca/floof/')).data.image; }
                else { imageUrl = `https://loremflickr.com/800/600/squirrel?lock=${Math.floor(Math.random()*1000)}`; }
            } catch (e) { imageUrl = 'https://cataas.com/cat'; }

            const embed = new EmbedBuilder()
                .setColor('#FF4500')
                .setTitle('🖼️ Caption Contest!')
                .setDescription(`Reply in the thread below with your best caption for this image.\n\nContest ends in **${dur} minutes**.`)
                .setImage(imageUrl);

            try {
                const thread = await createHostedGamePublicThread(interaction.channel, threadName);
                await thread.send({ embeds: [makeGameFlairEmbed('caption'), embed], components: [auraBoostRow(thread.id)] });
                const game_state_caption = { participants: [], pointValues: parsePointValues(ptsOpt, DEFAULT_SINGLE_WINNER_POINTS) };
                await createActiveGame(guildId, interaction.channelId, thread.id, 'CaptionContest', game_state_caption, dur, capHostPremium);
                activeCaptions.set(thread.id, { guildId, channelId: interaction.channelId, threadId: thread.id, participants: new Set(), pointValues: parsePointValues(ptsOpt, DEFAULT_SINGLE_WINNER_POINTS), hostIsPremium: capHostPremium, premiumAuraBoost: false, timeoutHandle: setTimeout(() => triggerCaptionEnd(thread.id), dur * 60000) });
                registerAuraBoostTarget(thread.id, () => {
                    const cap = activeCaptions.get(thread.id);
                    if (cap) cap.premiumAuraBoost = true;
                });
                activeCaptions.get(thread.id).announcementMessage = await sendGlobalAnnouncement(client, guildId, `A Caption Contest has started in <#${interaction.channelId}>! Ends in **${dur} minutes**.`, thread.id);
                return thread.id;
            } catch (error) {
                console.error('CRITICAL: Thread creation failed:', error);
                return null;
            }
        };

        if (delay > 0) { 
            const sid = await scheduleGame(guildId, 'Caption Contest', interaction.channelId, delay, start);
            const capFc = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, delay, 'caption');
            await interaction.editReply({ content: `Scheduled! (ID: \`${sid}\`)${capFc}` });
            announceScheduledGame(client, guildId, 'Caption Contest', delay); 
        }
        else {
            const capTid = await start();
            const capFc0 = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, 0, 'caption');
            await interaction.editReply({ content: `Caption contest started!${capFc0}` });
            if (capTid) {
                const capTh = await client.channels.fetch(capTid).catch(() => null);
                if (capTh) {
                    await tryHostPremiumNudge(interaction, capHost, {
                        gameType: 'CaptionContest',
                        supportsRepeatHrs: false,
                        supportsPremiumCaps: false,
                    }).catch(() => {});
                    await sendPremiumBoostSessionHint(capTh, capHostPremium, {
                        guildId,
                        hostUserId: interaction.user.id,
                        gameType: 'CaptionContest',
                        sessionId: capTh.id,
                        hasAura: false,
                    }).catch(() => {});
                }
            }
        }
        }
    if (interaction.commandName === 'triviasprint') {
        const dur = interaction.options.getInteger('duration');
        const diff = interaction.options.getString('difficulty') || 'any';
        const cat = interaction.options.getString('category') || 'any';
        const pts = interaction.options.getString('points') || DEFAULT_PLACEMENT_POINTS;
        const threadName = interaction.options.getString('thread_name') || defaultGameThreadName('Trivia Sprint');
        const delay = getSlashScheduleDelayMs(interaction);
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const sprintHost = await getUser(guildId, interaction.user.id);
        const qCount = clampHostGameInt(interaction.options.getInteger('questions') || 15, sprintHost.isPremium, 'sprintQuestions');

        const start = async () => {
            let questions;
            try {
                questions = await fetchOpenTdbMultipleChoice(qCount, { category: cat, difficulty: diff });
            } catch (e) {
                console.error('[interactionCreate triviasprint] OpenTDB fetch failed', e);
                return;
            }
            if (!questions || questions.length === 0) return;

            throwIfImmediateGameStartBlockedByMaintenance(Date.now(), dur * 60000);
            const thread = await createHostedGamePublicThread(interaction.channel, threadName);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('sprint_start').setLabel('🏃 Start Sprint').setStyle(ButtonStyle.Success));
            await thread.send({
                content: `🏃 **Trivia Sprint Started!**\nAnswer ${qCount} questions as fast as possible!\nYou have **${dur} minutes** to finish.`,
                embeds: [makeGameFlairEmbed('triviasprint')],
                components: [row, auraBoostRow(thread.id)],
            });
            
            const game_state_sprint = { questions, targetScore: qCount, pointValues: parsePointValues(pts, DEFAULT_PLACEMENT_POINTS), players: {} };
            await createActiveGame(guildId, interaction.channelId, thread.id, 'TriviaSprint', game_state_sprint, dur, sprintHost.isPremium === true);
            activeSprints.set(thread.id, { guildId, channelId: interaction.channelId, threadId: thread.id, questions, targetScore: qCount, pointValues: parsePointValues(pts, DEFAULT_PLACEMENT_POINTS), players: {}, hostIsPremium: sprintHost.isPremium === true, premiumAuraBoost: false, timeoutHandle: setTimeout(() => triggerTriviaSprintEnd(thread.id), dur * 60000) });
            registerAuraBoostTarget(thread.id, () => {
                const sp = activeSprints.get(thread.id);
                if (sp) sp.premiumAuraBoost = true;
            });
            activeSprints.get(thread.id).announcementMessage = await sendGlobalAnnouncement(client, guildId, `A Trivia Sprint has started in <#${interaction.channelId}>! Ends in **${dur} minutes**.`, thread.id);
            return thread.id;
        };

        if (delay > 0) {
            const sid = await scheduleGame(guildId, 'Trivia Sprint', interaction.channelId, delay, start);
            const spFc = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, delay, 'triviasprint');
            await interaction.editReply({ content: `Scheduled! (ID: \`${sid}\`)${spFc}` });
            announceScheduledGame(client, guildId, 'Trivia Sprint', delay); 
        }
        else {
            const threadId = await start();
            if (threadId && activeSprints.has(threadId)) {
                const spFc0 = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, 0, 'triviasprint');
                await interaction.editReply({ content: `Sprint started!${spFc0}` });
                const spTh = await client.channels.fetch(threadId).catch(() => null);
                if (spTh) {
                    await tryHostPremiumNudge(interaction, sprintHost, {
                        gameType: 'TriviaSprint',
                        supportsRepeatHrs: false,
                        supportsPremiumCaps: true,
                    }).catch(() => {});
                    await sendPremiumBoostSessionHint(spTh, sprintHost.isPremium === true, {
                        guildId,
                        hostUserId: interaction.user.id,
                        gameType: 'TriviaSprint',
                        sessionId: spTh.id,
                        hasAura: false,
                    }).catch(() => {});
                }
            } else {
                await interaction.editReply({ content: "Failed to fetch questions. Try again later." });
            }
        }
    }

    if (interaction.commandName === 'unscramble') {
        const threadName = interaction.options.getString('thread_name') || defaultGameThreadName('Unscramble Sprint');
        const pts = interaction.options.getString('points') || DEFAULT_PLACEMENT_POINTS;
        const delay = getSlashScheduleDelayMs(interaction);
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const unscrambleHost = await getUser(guildId, interaction.user.id);
        const rounds = clampHostGameInt(interaction.options.getInteger('rounds') || 5, unscrambleHost.isPremium, 'unscrambleRounds');
        const durationMinOpt = interaction.options.getInteger('duration_minutes');
        const unscrambleSessionMinutes =
            durationMinOpt == null ? rounds + 1 : Math.max(1, Math.min(durationMinOpt, 24 * 60));

        const start = async () => {
            throwIfImmediateGameStartBlockedByMaintenance(Date.now(), unscrambleSessionMinutes * 60000);
            const phrases = await buildUnscramblePhrasesForGame(rounds);

            const thread = await createHostedGamePublicThread(interaction.channel, threadName);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('unscramble_start').setLabel('🏃 Start Unscramble').setStyle(ButtonStyle.Success));
            await thread.send({
                content: `📝 **Unscramble Sprint!**\nUnscramble ${rounds} phrases as fast as possible!\nYou have **${unscrambleSessionMinutes} minute${unscrambleSessionMinutes === 1 ? '' : 's'}** to finish.`,
                embeds: [makeGameFlairEmbed('unscramble')],
                components: [row, auraBoostRow(thread.id)],
            });
            
            const game_state_unscramble = { phrases, totalRounds: rounds, pointValues: parsePointValues(pts, DEFAULT_PLACEMENT_POINTS), players: {} };
            await createActiveGame(
                guildId,
                interaction.channelId,
                thread.id,
                'UnscrambleSprint',
                game_state_unscramble,
                unscrambleSessionMinutes,
                unscrambleHost.isPremium === true,
            );
            activeUnscrambles.set(thread.id, {
                guildId,
                parentChannelId: interaction.channelId,
                threadId: thread.id,
                totalRounds: rounds,
                phrases: phrases,
                players: {},
                pointValues: parsePointValues(pts, DEFAULT_PLACEMENT_POINTS),
                hostIsPremium: unscrambleHost.isPremium === true,
                premiumAuraBoost: false,
                timeoutHandle: setTimeout(() => triggerUnscrambleEnd(thread.id), unscrambleSessionMinutes * 60000),
            });
            registerAuraBoostTarget(thread.id, () => {
                const u = activeUnscrambles.get(thread.id);
                if (u) u.premiumAuraBoost = true;
            });
            activeUnscrambles.get(thread.id).announcementMessage = await sendGlobalAnnouncement(
                client,
                guildId,
                `An Unscramble Sprint has started in <#${interaction.channelId}>! Ends in **${unscrambleSessionMinutes} minute${unscrambleSessionMinutes === 1 ? '' : 's'}**.`,
                thread.id,
            );
            return thread.id;
        };
        if (delay > 0) {
            const sid = await scheduleGame(guildId, 'Unscramble', interaction.channelId, delay, start);
            const unFc = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, delay, 'unscramble');
            await interaction.editReply({ content: `Scheduled! (ID: \`${sid}\`)${unFc}` });
            announceScheduledGame(client, guildId, 'Unscramble', delay);
        } else {
            const unscrambleTid = await start();
            const unFc0 = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, 0, 'unscramble');
            await interaction.editReply({ content: `Unscramble Sprint started!${unFc0}` });
            if (unscrambleTid) {
                const unscTh = await client.channels.fetch(unscrambleTid).catch(() => null);
                if (unscTh) {
                    await tryHostPremiumNudge(interaction, unscrambleHost, {
                        gameType: 'UnscrambleSprint',
                        supportsRepeatHrs: false,
                        supportsPremiumCaps: true,
                    }).catch(() => {});
                    await sendPremiumBoostSessionHint(unscTh, unscrambleHost.isPremium === true, {
                        guildId,
                        hostUserId: interaction.user.id,
                        gameType: 'UnscrambleSprint',
                        sessionId: unscTh.id,
                        hasAura: false,
                    }).catch(() => {});
                }
            }
        }
    }
    } catch (error) {
        const interactionCtx = interactionLogContext(interaction);
        if (error instanceof GameSchedulingBlockedError) {
            logOpsEvent('command_denied', {
                ...interactionCtx,
                reason: 'maintenance_window',
                errorCode: error.code || null,
                errorMessage: error.userMessage || error.message,
            });
            const m = error.userMessage || error.message;
            if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: m, flags: [MessageFlags.Ephemeral] }).catch(() => null);
            } else if (interaction.deferred) {
                await interaction.editReply({ content: m }).catch(() => null);
            }
            return;
        }
        const cmdName = interactionCtx.commandName || interactionCtx.customId || 'unknown';
        const guildCtx = interactionCtx.guildId || 'dm_or_unknown_guild';
        const userCtx = interactionCtx.userId || 'unknown_user';
        const channelCtx = interactionCtx.channelId || 'unknown_channel';
        const subCtx = interactionCtx.subcommand || null;
        const ctxMsg =
            `[InteractionError] guild=${guildCtx} user=${userCtx} channel=${channelCtx} ` +
            `name=${cmdName}${subCtx ? ` subcommand=${subCtx}` : ''} ` +
            `type=${interaction.type}`;
        logOpsEvent('interaction_error', {
            ...interactionCtx,
            errorName: error?.name || null,
            errorMessage: error?.message || String(error),
            errorStack: error?.stack || null,
        });
        console.error(ctxMsg);
        console.error(error?.stack || error);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
            interaction.reply({ content: 'An internal error occurred while processing this command.', ephemeral: true }).catch(()=>null);
        } else if (interaction.deferred) {
            interaction.editReply({ content: 'An internal error occurred while processing this command.' }).catch(()=>null);
        }
    }
    });
    });
}

module.exports = { registerInteractionCreate };
