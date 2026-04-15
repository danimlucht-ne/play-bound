const mongoose = require('mongoose');

const FactionGuildSlotSchema = new mongoose.Schema(
    {
        Phoenixes: { type: String, default: null },
        Unicorns: { type: String, default: null },
        Fireflies: { type: String, default: null },
        Dragons: { type: String, default: null },
        Wolves: { type: String, default: null },
        Eagles: { type: String, default: null },
    },
    { _id: false },
);

const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    guildId: { type: String, required: true },
    points: { type: Number, default: 0 },
    /**
     * Mini-game score only (addScore with a game tag). Personal / server Arena boards — not affected by
     * /adjustpoints, referral payouts, daily, pay, duels, etc. Global faction standings use challenge results only.
     */
    competitivePoints: { type: Number, default: 0 },
    weeklyPoints: { type: Number, default: 0 },
    /**
     * Personal Credits already granted from **war** `/playgame` on `warPlaygamePersonalDay` (UTC `YYYY-MM-DD`).
     * Resets when the calendar day changes; cap per day in `db` (`WAR_PLAYGAME_PERSONAL_CREDITS_CAP`). War **ledger** is uncapped.
     */
    warPlaygamePersonalPoints: { type: Number, default: 0 },
    /** UTC date (`YYYY-MM-DD`) for which `warPlaygamePersonalPoints` applies; null until first war playgame grant. */
    warPlaygamePersonalDay: { type: String, default: null },
    /** Resets 1st of month (same schedule as monthly recap). Used when guild cadence is `monthly`. */
    monthlyPoints: { type: Number, default: 0 },
    faction: { type: String, default: null }, // Global Faction Name (e.g. 'Dragons')
    /** Last successful `/faction switch` (Premium); ms since epoch */
    lastFactionSwitchAt: { type: Number, default: null },
    /** Last `/faction leave` (free path); used to enforce re-join cooldown for non-Premium */
    lastFactionLeaveAt: { type: Number, default: null },
    birthday: { type: String, default: null },
    lastBirthdayClaim: { type: Number, default: null },
    lastDailyClaim: { type: Number, default: null },
    currentStreak: { type: Number, default: 0 },
    lastActiveDate: { type: String, default: null }, // MM-DD-YYYY
    inventory: { type: [String], default: [] },
    currentCosmetics: { type: Map, of: String, default: {} },
    achievements: { type: [String], default: [] },
    isPremium: { type: Boolean, default: false },
    premiumSource: { type: String, default: null }, // 'discord', 'stripe', or null
    isBlacklisted: { type: Boolean, default: false },
    blacklistReason: { type: String, default: null },
    agreedTermsVersion: { type: String, default: '0' },
    agreedTermsAt: { type: Date, default: null },
    agreedPrivacyVersion: { type: String, default: '0' },
    agreedPrivacyAt: { type: Date, default: null },
    /** Rate-limits soft Premium upsell messages */
    lastPremiumPromptAt: { type: Date, default: null },
    /** Daily /playgame session counts outside wars. Keys: UTC date string (YYYY-MM-DD), values: count. Old keys cleaned lazily. */
    dailyPlaygameSessions: { type: Map, of: Number, default: () => new Map() },
    /** Last N point grants (newest first); optional for older DB documents */
    pointLedger: {
        type: [{
            at: { type: Date, default: Date.now },
            amount: { type: Number, required: true },
            label: { type: String, default: 'points' },
            /** Set for `/adjustpoints` (web + Discord audit). */
            reason: { type: String, default: null },
        }],
        default: [],
    },
    stats: {
        gamesWon: { type: Number, default: 0 },
        wordlesSolved: { type: Number, default: 0 },
        messagesSent: { type: Number, default: 0 },
        giveawaysEntered: { type: Number, default: 0 },
        lastGiveawayWin: { type: Number, default: null },
        triviaWins: { type: Number, default: 0 },
        serverdleWins: { type: Number, default: 0 },
        unscrambleWins: { type: Number, default: 0 },
        tuneWins: { type: Number, default: 0 },
        captionWins: { type: Number, default: 0 },
        sprintWins: { type: Number, default: 0 },
        guessWins: { type: Number, default: 0 }
    }
});

UserSchema.index({ userId: 1, guildId: 1 }, { unique: true });

const FactionSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    emoji: { type: String, required: true },
    /**
     * Legacy: raw challenge totals merged before match-point standings. No longer incremented for new ranked wars.
     * Kept for history and secondary display.
     */
    totalPoints: { type: Number, default: 0 },
    /** Official global standings: win = 3, tie = 1, loss = 0 per ranked war. */
    matchPoints: { type: Number, default: 0 },
    rankedWins: { type: Number, default: 0 },
    rankedLosses: { type: Number, default: 0 },
    rankedTies: { type: Number, default: 0 },
    /** Sum of per-war raw enrolled totals from ranked wars (secondary stat). */
    rawWarContributionTotal: { type: Number, default: 0 },
    /** Shown on /factions while current (quarterly champion highlight). */
    seasonHighlightLabel: { type: String, default: null },
    seasonHighlightUntil: { type: Date, default: null },
    /** Completed quarter season keys won (e.g. "2026-Q1"). */
    seasonQuarterWins: { type: [String], default: [] },
    /** Calendar years won as yearly faction champion. */
    seasonYearWins: { type: [Number], default: [] },
    members: { type: Number, default: 0 },
    desc: { type: String, required: true }
});

const SystemSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    announceChannel: { type: String, default: null },
    /**
     * When true, game start & winner lines in announceChannel include @everyone.
     * When false, same posts go there without a server ping.
     * Unset (legacy documents): treated as true so existing servers keep prior behavior until an admin turns it off.
     */
    announcePingEveryone: { type: Boolean },
    /**
     * When false, skip automated channel posts: announcement-channel game/winner lines, weekly/monthly recaps
     * there, leaderboard channel refresh, achievement channel, welcome/birthday channel messages, faction war reminder.
     * Slash `/leaderboard` and in-thread game messages still work. Unset = on (legacy).
     */
    automatedServerPostsEnabled: { type: Boolean },
    welcomeChannel: { type: String, default: null },
    birthdayChannel: { type: String, default: null },
    achievementChannel: { type: String, default: null },
    leaderboardChannel: { type: String, default: null },
    storyChannel: { type: String, default: null },
    /** Join/leave audit log (text channel id); posts only when automated posts are on. */
    memberLogChannel: { type: String, default: null },
    managerRoleId: { type: String, default: null },
    /** When true, any member may use listed game slash commands (not only Admin / Manager). */
    allowMemberHostedGames: { type: Boolean, default: false },
    autoRoleId: { type: String, default: null },
    welcomeMessage: { type: String, default: null },
    welcomeMessages: { type: [String], default: [
        "Welcome {user}! 🎮 Can you climb to the top of the /leaderboard?",
        "Player {user} has entered the arena! ⚔️ Type /help to gear up!",
        "Welcome {user}! 🌟 We've started you off with 5 points!"
    ] },
    birthdayMessage: { type: String, default: null },
    birthdayMessages: { type: [String], default: [
        "Level Up! 🎂 Happy Birthday {user}! Enjoy your +5 point gift!",
        "Happy Birthday {user}! 🎈 Another year in the simulation survived! (+5 pts)"
    ] },
    leaderboardMessageId: { type: String, default: null },
    /** Posted `/leaderboard` + channel board: all_time (points), weekly (weeklyPoints), monthly (monthlyPoints). */
    leaderboardCadence: { type: String, enum: ['all_time', 'weekly', 'monthly'], default: 'all_time' },
    roleRewards: { type: Map, of: String, default: {} }, // achievementKey -> roleId
    shopItems: { type: [mongoose.Schema.Types.Mixed], default: [] },
    redirects: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    /** Guild-defined achievements (keys must be CUSTOM_*); merged with built-in ACHIEVEMENTS at runtime */
    customAchievements: {
        type: [{
            key: { type: String, required: true },
            name: { type: String, required: true },
            desc: { type: String, required: true },
            /** Optional: Unicode emoji or Discord <:name:id> / <a:name:id> */
            emoji: { type: String, default: null },
        }],
        default: [],
    },
    /** Weekly Sunday ping after recap: “start a faction war” */
    factionWarReminderChannelId: { type: String, default: null },
    /** Granted to enrolled members of the winning faction when a challenge ends (manual or point goal). */
    factionVictoryRoleId: { type: String, default: null },
    /** Members with this role may create / end faction challenges (not full Bot Manager). */
    factionLeaderRoleId: { type: String, default: null },
    /** Discord role id per global faction (optional). */
    factionRoleMap: { type: FactionGuildSlotSchema, default: () => ({}) },
    /** Display-only renames for global factions in this server (one slot per official team). */
    factionDisplayNames: { type: FactionGuildSlotSchema, default: () => ({}) },
    /** Display-only emoji overrides (Unicode or <:id> custom) for global factions in this server. */
    factionDisplayEmojis: { type: FactionGuildSlotSchema, default: () => ({}) },
    /** Defaults when managers omit options on `/faction_challenge create` (null = built-in default). */
    factionChallengeDefaultGameType: { type: String, default: null },
    factionChallengeDefaultScoringMode: { type: String, default: null },
    factionChallengeDefaultTopN: { type: Number, default: null },
    /** Default roster cap when starting an official ranked war without `max_per_team` (1–25). */
    factionRankedDefaultRosterCap: { type: Number, default: null },
    /** Optional per–game-tag caps on counted war score during ranked wars, e.g. { trivia: 500 }. */
    factionRankedContributionCapsByTag: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Discord user id of the referrer (from `/claim_referral` in this guild). OAuth install does not preserve custom query params reliably. */
    referralReferredByUserId: { type: String, default: null },
    referralClaimedAt: { type: Date, default: null },
    /** Denormalized: true after first qualifying game referral payout for this guild */
    referralFirstGameRewardGranted: { type: Boolean, default: false },
    /** Throttle short post-game `/invite` nudges (see lib/referrals.js). */
    lastInviteViralNudgeAt: { type: Date, default: null },
});

const GameSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    channelId: { type: String, required: true },
    threadId: { type: String },
    type: { type: String, required: true }, // 'GuessTheNumber', 'Trivia', 'Serverdle', etc.
    status: { type: String, default: 'active' }, // 'active', 'ended'
    hostIsPremium: { type: Boolean, default: false },
    /** Premium member clicked "session aura" in thread (same multiplier as host Premium). */
    premiumAuraBoost: { type: Boolean, default: false },
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date },
    state: { type: mongoose.Schema.Types.Mixed, default: {} } // Flexible object for each game's data
});

// Auto-delete ended games after 30 days
GameSchema.index({ endTime: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60, partialFilterExpression: { status: 'ended' } });

/** Audit + idempotency anchor when a bot restart ends an active game that could not be resumed (see lib/interruptedGameCompensation.js). */
const InterruptedGameLogSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    channelId: { type: String, default: null },
    threadId: { type: String, default: null },
    gameType: { type: String, required: true },
    gameMongoId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    /** e.g. bot_restart_unresumable */
    reason: { type: String, default: 'bot_restart_unresumable' },
    /** Best-effort Discord user ids found in persisted Game.state (may be empty). */
    participantIds: { type: [String], default: [] },
    pointsGrantedPerUser: { type: Number, default: 0 },
    usersCompensated: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
}, { collection: 'interruptedgamelogs' });

InterruptedGameLogSchema.index({ guildId: 1, createdAt: -1 });

/** Idempotency: one advance maintenance embed per guild per scheduled window (see lib/maintenanceBroadcast.js). */
const MaintenanceBroadcastLogSchema = new mongoose.Schema(
    {
        guildId: { type: String, required: true },
        windowStartMs: { type: Number, required: true },
        windowEndMs: { type: Number, required: true },
        phase: { type: String, required: true, enum: ['advance'], default: 'advance' },
        sentAt: { type: Date, default: Date.now },
    },
    { collection: 'maintenancebroadcastlogs' },
);

MaintenanceBroadcastLogSchema.index(
    { guildId: 1, windowStartMs: 1, windowEndMs: 1, phase: 1 },
    { unique: true },
);

const WordSchema = new mongoose.Schema({
    word: { type: String, required: true, unique: true },
    /** Optional hint for `/spellingbee`; Serverdle ignores this field. */
    definition: { type: String, default: null },
});

const PhraseSchema = new mongoose.Schema({
    phrase: { type: String, required: true, unique: true },
    clue: { type: String }
});

const MovieQuoteSchema = new mongoose.Schema({
    quote: { type: String, required: true, unique: true },
    /** Film or TV series title (guess target for `/moviequotes`) */
    movie: { type: String, required: true }
});

const AchievementSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    desc: { type: String, required: true }
});

const ShopItemSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    desc: { type: String, required: true },
    type: { type: String, required: true }, // 'consumable', 'cosmetic', 'badge', 'color', 'role'
    premiumOnly: { type: Boolean, default: false },
    /** Hex for profile embed border (type `color`) e.g. #FF4500 */
    profileColorHex: { type: String, default: null },
    /** Single emoji shown on `/leaderboard` & daily board when this badge is equipped */
    leaderboardEmoji: { type: String, default: null },
});

const RecurringGameSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    channelId: { type: String, required: true },
    type: { type: String, required: true },
    /** Whole-day component of repeat interval (use with `intervalHours`). */
    intervalDays: { type: Number, default: 0 },
    intervalHours: { type: Number, required: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    nextRun: { type: Date, required: true }
});

const FactionChallengeSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    /** Official ranked wars update global standings; unranked is local-only. */
    challengeMode: { type: String, enum: ['ranked', 'unranked'], default: 'ranked' },
    /** `duel` (1v1 factions) or `royale` (multi-faction; see `battleFactions`). */
    challengeType: { type: String, enum: ['duel', 'royale'], default: 'duel' },
    factionA: { type: String, required: true },
    factionB: { type: String, required: true },
    /** If set (length ≥ 2), multi-faction royale; use participantsByFaction. Else duel uses participantsA/B. */
    battleFactions: { type: [String], default: null },
    participantsByFaction: { type: Map, of: [String], default: () => new Map() },
    /** Legacy single filter; kept for old rows. Prefer `gameTypes` when set (up to 3 tags, or `all`). */
    gameType: { type: String, default: 'all' },
    /** Which game tags count toward this challenge (max 3). Empty/unset → use `gameType`. */
    gameTypes: { type: [String], default: undefined },
    scoringMode: { type: String, enum: ['total_points', 'avg_points', 'top_n_avg'], default: 'top_n_avg' },
    topN: { type: Number, default: 5 },
    status: { type: String, enum: ['active', 'ended'], default: 'active' },
    createdBy: { type: String, required: true },
    participantsA: { type: [String], default: [] },
    participantsB: { type: [String], default: [] },
    /** Counted toward official scoring (after per-tag caps on ranked wars). */
    scoresByUser: { type: Map, of: Number, default: {} },
    /** Full enrolled war total (base points) before caps — recaps and raw side-by-side display. */
    rawScoresByUser: { type: Map, of: Number, default: {} },
    /** Keys `userId::gameTag` → counted points toward that tag (for cap enforcement). */
    countedPointsByUserTag: { type: Map, of: Number, default: {} },
    createdAt: { type: Date, default: Date.now },
    endAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    winnerFaction: { type: String, default: null },
    /** One-time flat personal Credits after end (`grantWarEndPersonalCredits`). */
    warEconomyPayoutApplied: { type: Boolean, default: false },
    /** If set, challenge can end early when a team’s enrolled raw point sum reaches this (see factionChallenge.js). */
    pointCap: { type: Number, default: null },
    /** If set, only the first N `/faction_challenge join` per faction get roster spots (duel: per side; royale: per team). */
    maxPerTeam: { type: Number, default: null },
    /** After end: enrolled raw sums per faction (for history / per-server breakdown). */
    finalRawTotalsByFaction: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Official normalized score per faction at end (same metric as winner). */
    officialScoreByFaction: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Enrolled roster size per faction at end. */
    countedPlayersByFaction: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Match points credited per faction (win 3 / tie 1 / loss 0). */
    matchPointsAwarded: { type: mongoose.Schema.Types.Mixed, default: null },
    rankedResultSummary: { type: String, default: null },
    scoringSummary: { type: String, default: null },
    /** Snapshot of rules at creation (ranked fairness audit). */
    rankedRulesSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Per–game-tag counted caps for this challenge (ranked). */
    contributionCapsByTag: { type: mongoose.Schema.Types.Mixed, default: null },
    /**
     * True after global standings processing (ranked: match points + secondary totals; unranked: marked done only).
     * Idempotent.
     */
    globalTotalsApplied: { type: Boolean, default: false },
    /** v2 war format: 1 = legacy, 2 = 30-min tournament with one-play-per-game. */
    warVersion: { type: Number, default: 1 },
    /** Game tags selected for this v2 war (1–3 ranked-eligible tags). Empty for v1. */
    warGames: { type: [String], default: [] },
    /** Per-user game completion tracking for v2 wars. Keys: userId, values: array of completed game tags. */
    completedGamesByUser: { type: Map, of: [String], default: () => new Map() },
    /** Fixed war duration in minutes for v2 ranked wars. */
    warDurationMinutes: { type: Number, default: 30 },
    /** Channel where the war was created — used for posting results embed at war end. */
    channelId: { type: String, default: null },
});

FactionChallengeSchema.index({ guildId: 1, status: 1 });

/** UTC quarter (Q1–Q4) or calendar year aggregate championship. */
const SeasonSchema = new mongoose.Schema({
    seasonKey: { type: String, required: true, unique: true },
    type: { type: String, enum: ['quarter', 'year'], required: true },
    year: { type: Number, required: true },
    quarter: { type: Number, default: null },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    status: { type: String, enum: ['active', 'completed'], default: 'active' },
    finalizedAt: { type: Date, default: null },
    winningFactionName: { type: String, default: null },
    topFactionNames: { type: [String], default: [] },
    winningGuildId: { type: String, default: null },
    topGuildIds: { type: [String], default: [] },
    rewardMeta: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Year-type only: aggregated faction rows at finalize. */
    yearFactionSnapshot: { type: [mongoose.Schema.Types.Mixed], default: [] },
});

SeasonSchema.index({ type: 1, status: 1, endAt: 1 });

/** Per-faction stats for one quarter season (from ranked wars only). */
const FactionSeasonStatsSchema = new mongoose.Schema({
    seasonKey: { type: String, required: true },
    factionName: { type: String, required: true },
    matchPoints: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    ties: { type: Number, default: 0 },
    officialScoreTotal: { type: Number, default: 0 },
    rawContributionTotal: { type: Number, default: 0 },
    rank: { type: Number, default: null },
    finalized: { type: Boolean, default: false },
    compositeScore: { type: Number, default: null },
});

FactionSeasonStatsSchema.index({ seasonKey: 1, factionName: 1 }, { unique: true });
FactionSeasonStatsSchema.index({ seasonKey: 1, matchPoints: -1 });

/** Per-server stats for one quarter season. */
const ServerSeasonStatsSchema = new mongoose.Schema({
    seasonKey: { type: String, required: true },
    guildId: { type: String, required: true },
    rankedWarsHosted: { type: Number, default: 0 },
    /** Ranked wars that ended with a single winner (not a full tie). */
    warsWon: { type: Number, default: 0 },
    warsTied: { type: Number, default: 0 },
    totalRawContribution: { type: Number, default: 0 },
    sumOfficialTop: { type: Number, default: 0 },
    countOfficialTop: { type: Number, default: 0 },
    serverCompositeScore: { type: Number, default: null },
    rank: { type: Number, default: null },
    finalized: { type: Boolean, default: false },
});

ServerSeasonStatsSchema.index({ seasonKey: 1, guildId: 1 }, { unique: true });
ServerSeasonStatsSchema.index({ seasonKey: 1, serverCompositeScore: -1 });

const SeasonAuditLogSchema = new mongoose.Schema({
    action: { type: String, required: true },
    detail: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
});

SeasonAuditLogSchema.index({ createdAt: -1 });

/** Saved when weekly/monthly point counters reset so past standings stay queryable. */
const LeaderboardPeriodSnapshotSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    period: { type: String, enum: ['weekly', 'monthly'], required: true },
    endedAt: { type: Date, default: Date.now },
    entries: [{
        userId: { type: String, required: true },
        score: { type: Number, required: true },
        rank: { type: Number, required: true },
    }],
});

LeaderboardPeriodSnapshotSchema.index({ guildId: 1, period: 1, endedAt: -1 });

/** Global tuning + overrides for the unified mini-game platform (rotation, featured, caps). */
const GamePlatformSettingsSchema = new mongoose.Schema({
    _id: { type: String, default: 'global' },
    /** tag -> partial override merged with code registry */
    gameOverrides: { type: Map, of: mongoose.Schema.Types.Mixed, default: () => new Map() },
    featuredCasualBonusPct: { type: Number, default: 0.15 },
    autoFeatured: { type: Boolean, default: true },
    /** When set (and autoFeatured false), pinned featured tag for current UTC day until cleared */
    manualFeaturedTag: { type: String, default: null },
    /** When non-empty, replaces auto-computed rotation pool until cleared */
    manualActiveTags: { type: [String], default: [] },
    poolSizeMin: { type: Number, default: 4 },
    poolSizeMax: { type: Number, default: 6 },
    /** Minimum category coverage when picking the daily pool */
    categoryMins: {
        type: {
            fast: { type: Number, default: 1 },
            skill: { type: Number, default: 1 },
            luck: { type: Number, default: 1 },
            social: { type: Number, default: 0 },
        },
        default: () => ({ fast: 1, skill: 1, luck: 1, social: 0 }),
    },
    /** Allow lie_detector / vote / sabotage in ranked wars when true */
    socialGamesRankedAllowed: { type: Boolean, default: false },
    /** Recent tag -> last featured dayUtc (cooldown hints) */
    lastFeaturedByTag: { type: Map, of: String, default: () => new Map() },
    updatedAt: { type: Date, default: Date.now },
}, { collection: 'gameplatformsettings' });

/** One row per UTC calendar day: active rotation + featured game. */
const GamePlatformDaySchema = new mongoose.Schema({
    dayUtc: { type: String, required: true, unique: true },
    activeTags: { type: [String], default: [] },
    featuredTag: { type: String, default: null },
    /** tag -> count appearances in last N days (denormalized at compute time) */
    cooldownSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    computedAt: { type: Date, default: Date.now },
}, { collection: 'gameplatformdays' });

/** Aggregated telemetry per UTC day for balancing dashboards. */
const GamePlatformDailyStatsSchema = new mongoose.Schema({
    dayUtc: { type: String, required: true, unique: true },
    /** tag -> { started, completed, abandoned, sumFactionBase, sumCasualTotal } */
    byTag: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    updatedAt: { type: Date, default: Date.now },
}, { collection: 'gameplatformdailystats' });

const GamePlatformAuditLogSchema = new mongoose.Schema({
    action: { type: String, required: true },
    actorId: { type: String, default: null },
    detail: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
}, { collection: 'gameplatformauditlogs' });

GamePlatformAuditLogSchema.index({ createdAt: -1 });

/** Global per-Discord-user: referral codes, stats, faction-recruit counters. */
const ReferralProfileSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    /** Shown in `/invite`; matched by `/claim_referral` (e.g. PBXXXXXXXX). */
    referralCode: { type: String, required: true, unique: true },
    /** Guild where referral economy points are credited (`/invite` locks this). */
    referralRewardsGuildId: { type: String, default: null },
    /** Guild ids that completed first-game referral payout for this referrer */
    referralCompletedGuildIds: { type: [String], default: [] },
    referralSuccessfulCount: { type: Number, default: 0 },
    referralServerPointsEarned: { type: Number, default: 0 },
    factionRecruitSuccessCount: { type: Number, default: 0 },
    /** How many “every 5 recruits” milestone bonuses have been paid */
    factionRecruitMilestoneBlocksPaid: { type: Number, default: 0 },
    referralFactionPointsEarned: { type: Number, default: 0 },
    /** First-time onboarding (global per Discord user; Discord + web share state). */
    onboardingStep: { type: Number, default: 0 },
    /** 1–7 map to product steps; 0 = show welcome. */
    onboardingSkippedAt: { type: Date, default: null },
    onboardingCompletedAt: { type: Date, default: null },
    hasJoinedFaction: { type: Boolean, default: false },
    hasPlayedFirstGame: { type: Boolean, default: false },
    hasSeenChallenge: { type: Boolean, default: false },
    /** Set once when onboarding state is first evaluated (legacy vs new player). */
    onboardingBootstrappedAt: { type: Date, default: null },
});

/** Idempotent: one first-game referral payout per guild ever. */
const ReferralFirstGamePayoutSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    referrerUserId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
});

/** Short-lived faction recruit token from `/faction_recruit`. */
const FactionRecruitTokenSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    recruiterUserId: { type: String, required: true },
    factionName: { type: String, required: true },
    sourceGuildId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
});

FactionRecruitTokenSchema.index({ createdAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 });

/** One recruiter→recruit faction reward per pair (globally). */
const FactionRecruitRewardSchema = new mongoose.Schema({
    recruiterUserId: { type: String, required: true },
    recruitUserId: { type: String, required: true },
    factionName: { type: String, required: true },
    guildId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
});

FactionRecruitRewardSchema.index({ recruiterUserId: 1, recruitUserId: 1 }, { unique: true });

/** Singleton (`_id` = `global`): overrides `src/bot/constants` for Discord agreement gating when present (prod DB). */
const LegalPolicyConfigSchema = new mongoose.Schema(
    {
        _id: { type: String, default: 'global' },
        termsVersion: { type: String, required: true },
        privacyVersion: { type: String, required: true },
        updatedByDiscordUserId: { type: String, default: null },
    },
    { collection: 'legal_policy_config', timestamps: true },
);

const { PremiumPromptEventSchema } = require('./models/PremiumPromptEvent');

/**
 * Register all Mongoose models on a connection (prod/test or default for scripts).
 * @param {import('mongoose').Connection} connection
 */
function registerModels(connection) {
    return {
        ReferralProfile: connection.model('ReferralProfile', ReferralProfileSchema),
        ReferralFirstGamePayout: connection.model('ReferralFirstGamePayout', ReferralFirstGamePayoutSchema),
        FactionRecruitToken: connection.model('FactionRecruitToken', FactionRecruitTokenSchema),
        FactionRecruitReward: connection.model('FactionRecruitReward', FactionRecruitRewardSchema),
        User: connection.model('User', UserSchema),
        SystemConfig: connection.model('SystemConfig', SystemSchema),
        Game: connection.model('Game', GameSchema),
        InterruptedGameLog: connection.model('InterruptedGameLog', InterruptedGameLogSchema),
        MaintenanceBroadcastLog: connection.model('MaintenanceBroadcastLog', MaintenanceBroadcastLogSchema),
        Word: connection.model('Word', WordSchema),
        Phrase: connection.model('Phrase', PhraseSchema),
        MovieQuote: connection.model('MovieQuote', MovieQuoteSchema),
        Achievement: connection.model('Achievement', AchievementSchema),
        ShopItem: connection.model('ShopItem', ShopItemSchema),
        Faction: connection.model('Faction', FactionSchema),
        RecurringGame: connection.model('RecurringGame', RecurringGameSchema),
        FactionChallenge: connection.model('FactionChallenge', FactionChallengeSchema),
        Season: connection.model('Season', SeasonSchema),
        FactionSeasonStats: connection.model('FactionSeasonStats', FactionSeasonStatsSchema),
        ServerSeasonStats: connection.model('ServerSeasonStats', ServerSeasonStatsSchema),
        SeasonAuditLog: connection.model('SeasonAuditLog', SeasonAuditLogSchema),
        LeaderboardPeriodSnapshot: connection.model('LeaderboardPeriodSnapshot', LeaderboardPeriodSnapshotSchema),
        GamePlatformSettings: connection.model('GamePlatformSettings', GamePlatformSettingsSchema),
        GamePlatformDay: connection.model('GamePlatformDay', GamePlatformDaySchema),
        GamePlatformDailyStats: connection.model('GamePlatformDailyStats', GamePlatformDailyStatsSchema),
        GamePlatformAuditLog: connection.model('GamePlatformAuditLog', GamePlatformAuditLogSchema),
        PremiumPromptEvent: connection.model('PremiumPromptEvent', PremiumPromptEventSchema),
        LegalPolicyConfig: connection.model('LegalPolicyConfig', LegalPolicyConfigSchema),
    };
}

const baseExports = { registerModels };

const modelProxy = new Proxy(baseExports, {
    get(target, prop) {
        if (Object.prototype.hasOwnProperty.call(target, prop)) {
            return target[prop];
        }
        const mongoRouter = require('./lib/mongoRouter');
        const bag = mongoRouter.getModelsForGuild(undefined);
        if (bag[prop] === undefined) {
            return undefined;
        }
        return bag[prop];
    },
});

module.exports = modelProxy;
