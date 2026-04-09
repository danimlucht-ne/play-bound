export function createApiMock(options = {}) {
  const normalized = typeof options === "boolean" ? { loggedIn: options } : options;
  const loggedIn = Boolean(normalized.loggedIn);
  const adminEligible = loggedIn && normalized.adminEligible !== false;
  const isDeveloper = loggedIn && Boolean(normalized.isDeveloper);

  const user = loggedIn
    ? {
        id: "123",
        username: "playbound-user",
        displayName: "PlayBound User",
      }
    : null;

  return {
    publicConfig: {
      botInviteUrl: "https://discord.com/oauth2/authorize?client_id=test",
      supportServerInvite: "https://discord.gg/test-support",
      premiumMonthlyUrl: "https://buy.stripe.com/test-monthly",
      premiumYearlyUrl: "https://buy.stripe.com/test-yearly",
    },
    statsGlobal: {
      gamesLast24h: 26,
      playersLast24h: 143,
      pointsLast24h: 9182,
      totalServers: 12,
      gamesPlayedAllTime: 1402,
      referralMilestonesLast7d: 3,
    },
    players: {
      entries: [
        { userId: "123", displayName: "PlayBound User", total: 950, rank: 1 },
        { userId: "456", displayName: "Rival", total: 810, rank: 2 },
      ],
    },
    factions: {
      entries: [
        { name: "Dragons", emoji: "🐉", matchPoints: 842 },
        { name: "Phoenixes", emoji: "🔥", matchPoints: 819 },
        { name: "Wolves", emoji: "🐺", matchPoints: 801 },
        { name: "Eagles", emoji: "🦅", matchPoints: 776 },
        { name: "Unicorns", emoji: "🦄", matchPoints: 754 },
        { name: "Fireflies", emoji: "✨", matchPoints: 731 },
      ],
    },
    recruiters: {
      entries: [
        { userId: "123", displayName: "PlayBound User", successfulReferrals: 7 },
        { userId: "456", displayName: "Rival", successfulReferrals: 4 },
      ],
    },
    meStats: {
      totalGamesWon: 42,
      perGame: {
        trivia: 12,
        serverdle: 8,
        unscramble: 6,
        tune: 5,
        caption: 4,
        sprint: 4,
        guess: 3,
      },
      serverCount: 3,
      cachedAt: new Date().toISOString(),
    },
    meFaction: {
      factions: [
        { guildId: "111111111111111111", name: "Dragons", emoji: "🐉", matchPoints: 842, rank: 1 },
        { guildId: "222222222222222222", name: "Wolves", emoji: "🐺", matchPoints: 801, rank: 3 },
      ],
      faction: {
        name: "Dragons",
        emoji: "🐉",
        matchPoints: 842,
        rank: 1,
      },
      warCount: 15,
      recentWars: [
        { challengeId: "w1", winnerFaction: "Dragons", userFaction: "Dragons", endedAt: new Date().toISOString() },
      ],
      cachedAt: new Date().toISOString(),
    },
    meAchievements: {
      achievements: [
        { key: "FIRST_WIN", name: "First Class", desc: "Win your very first game or giveaway!" },
        { key: "TRIVIA_ROOKIE", name: "Trivia Rookie", desc: "Win 1 Trivia match." },
      ],
      cachedAt: new Date().toISOString(),
    },
    shop: {
      items: [
        { id: "badge_star", name: "Star Badge", price: 100, desc: "A shiny star", type: "badge", premiumOnly: false, source: "global", owned: true, equipped: false },
        { id: "color_red", name: "Red Profile", price: 200, desc: "Red border color", type: "color", premiumOnly: true, source: "global", owned: false, equipped: false },
        { id: "server_item_1", name: "Server Boost", price: 50, desc: "A server-specific item", type: "consumable", premiumOnly: false, source: "server", owned: false, equipped: false, serverShopIndex: 0 },
      ],
      cachedAt: new Date().toISOString(),
    },
    adminChannels: {
      channels: [
        { id: "ch1", name: "general" },
        { id: "ch2", name: "announcements" },
        { id: "ch3", name: "bot-games" },
      ],
      assignments: {
        announceChannel: "ch2",
        welcomeChannel: null,
        birthdayChannel: null,
        achievementChannel: null,
        leaderboardChannel: null,
        storyChannel: null,
      },
      cachedAt: new Date().toISOString(),
    },
    adminShop: { ok: true },
    adminGuilds: {
      eligible: adminEligible,
      isDeveloper,
      guilds: adminEligible ? [{ id: "987654321", name: "Test Server" }] : [],
    },
    adminOverview: {
      guildId: "987654321",
      activeGamesDb: 2,
      inMemorySessions: 1,
      scheduledGamesDb: 3,
      scheduledInMemory: 1,
      recurringGames: 2,
      activeFactionChallenge: true,
      pointsIssued24h: 1540,
      players24h: 17,
      totalServersGlobal: isDeveloper ? 12 : null,
    },
    adminGames: {
      active: [{ id: "g1", type: "Trivia", threadId: "thread-1" }],
      scheduled: [{ sid: "sched-1", type: "Unscramble", inMemory: true }],
      recurring: [{ id: "rec-1", type: "Caption", intervalHours: 24, nextRun: "2026-04-17T12:00:00.000Z" }],
    },
    adminEconomy: {
      ledger24h: { positiveOnly: 1250, net: 1180 },
      ledger7d: { positiveOnly: 7520, net: 7010 },
      topPlayers: [
        { displayName: "PlayBound User", points: 2300 },
        { displayName: "Rival", points: 1800 },
      ],
      recentManualAdjustments: [
        { targetUsername: "PlayBound User", amount: 50, actorUsername: "Mod Jane" },
      ],
    },
    adminFactions: {
      dailyLimits: { duelsUsed: 1, duelsMax: 2, royalesUsed: 0, royalesMax: 1 },
      recentCompletedChallenges: [
        {
          matchup: "Dragons vs Wolves",
          winnerFaction: "Dragons",
          ranked: true,
          globalMergeDone: true,
          endedAt: "2026-04-16T18:30:00.000Z",
        },
      ],
      globalStandings: [
        { name: "Dragons", emoji: "🐉", matchPoints: 842, rankedWins: 6, rankedLosses: 1, rankedTies: 0, rawWarContributionTotal: 2200, legacyChallengePoints: 120 },
        { name: "Phoenixes", emoji: "🔥", matchPoints: 819, rankedWins: 5, rankedLosses: 2, rankedTies: 1, rawWarContributionTotal: 2050, legacyChallengePoints: 110 },
      ],
      memberDistribution: [
        { faction: "Dragons", members: 12 },
        { faction: "Wolves", members: 9 },
      ],
      activeChallenges: [
        { factionA: "Dragons", factionB: "Wolves", ranked: true, endAt: "2026-04-16T21:00:00.000Z" },
      ],
    },
    adminReferrals: {
      thisGuild: { firstGameRewardGranted: true, referredByUserId: "456" },
      firstGamePayouts: [{ createdAt: "2026-04-15T14:00:00.000Z", referrerUserId: "456" }],
      topReferrers: [{ displayName: "PlayBound User", successfulCount: 7 }],
    },
    adminAutomation: {
      automatedServerPostsEnabled: true,
      announceChannel: "ch2",
      announcePingEveryone: false,
      scheduledAnnouncementsInDb: [
        { sid: "ann-1", startTime: "2026-04-16T20:00:00.000Z", preview: "Tonight at 8" },
      ],
    },
    adminRoles: {
      managerRoleId: "role-manager",
      factionLeaderRoleId: "role-faction",
      autoRoleId: "role-auto",
      builtInAchievementKeys: ["FIRST_WIN", "TRIVIA_ROOKIE"],
      roleRewards: [{ achievementName: "First Class", achievementKey: "FIRST_WIN", roleId: "role-first" }],
    },
    adminAudit: {
      summary: { count: 3, net: 75 },
      window: "7d",
      entries: [
        { at: "2026-04-16T12:00:00.000Z", targetUsername: "PlayBound User", amount: 50, actorUsername: "Mod Jane" },
      ],
    },
    adminLegalPolicy: {
      effective: { termsVersion: "2026-04-06", privacyVersion: "2026-04-06", source: "database" },
      constants: { termsVersion: "2026-03-01", privacyVersion: "2026-03-01" },
      database: { updatedAt: "2026-04-06T10:00:00.000Z", updatedByDiscordUserId: "123" },
      staticPublishAvailable: true,
    },
    adminRuntimeLogs: {
      pid: 4242,
      processUptimeSec: 120,
      totalBuffered: 3,
      newestSeq: 3,
      lines: [
        { seq: 1, level: "info", at: "2026-04-16T19:00:00.000Z", message: "Boot complete" },
        { seq: 2, level: "warn", at: "2026-04-16T19:00:02.000Z", message: "Cache warm" },
        { seq: 3, level: "info", at: "2026-04-16T19:00:05.000Z", message: "Guild sync ok" },
      ],
    },
    adminGuildInstalls: {
      entries: [
        { kind: "join", guildId: "987654321", guildName: "Test Server", memberCount: 42, ownerId: "999", at: "2026-04-15T10:00:00.000Z" },
      ],
    },
    me: loggedIn
      ? {
          loggedIn: true,
          user,
          profile: {
            factionName: "Dragons",
            arenaPoints: 950,
            credits: 2300,
          },
          referral: {
            code: "PB-TEST-123",
            successfulServerCount: 7,
          },
          admin: {
            eligible: adminEligible,
            isDeveloper,
            guildIds: isDeveloper ? [] : (adminEligible ? ["987654321"] : []),
          },
          onboarding: {
            active: true,
            skipped: false,
            complete: false,
            step: "welcome",
          },
        }
      : { loggedIn: false },
    seasonCurrent: {
      seasonKey: "2026-Q2",
      daysRemainingApprox: 42,
      topFactions: [{ factionName: "Dragons", matchPoints: 842, wins: 6 }],
      topServers: [{ guildId: "987654321", serverCompositeScore: 11.4, rankedWarsHosted: 5, warsWon: 3 }],
    },
    seasonHall: {
      quarters: [{ seasonKey: "2026-Q1", winningFactionName: "Wolves" }],
      years: [{ year: 2025, winningFactionName: "Dragons" }],
    },
    gamesToday: {
      dayUtc: "2026-04-08",
      featuredTag: "risk-roll",
      featuredDisplayName: "Risk Roll",
      activeGames: [
        {
          tag: "risk-roll",
          displayName: "Risk Roll",
          category: "Trivia",
          rankedEligible: true,
          estimatedMinutes: 2,
        },
        {
          tag: "daily-duel",
          displayName: "Daily Duel",
          category: "Duel",
          rankedEligible: true,
          estimatedMinutes: 3,
        },
        {
          tag: "word-sprint",
          displayName: "Word Sprint",
          category: "Word",
          rankedEligible: false,
          estimatedMinutes: 4,
        },
      ],
      catalogSummary: {
        totalActive: 3,
        categories: [
          { category: "Trivia", count: 1 },
          { category: "Duel", count: 1 },
          { category: "Word", count: 1 },
        ],
      },
      rankedWar: {
        active: true,
        enrolled: true,
        line: "Dragons vs Wolves",
        timeLeft: "42m",
      },
    },
  };
}
