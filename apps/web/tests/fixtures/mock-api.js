export function createApiMock(loggedIn = false) {
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
        { id: "server_item_1", name: "Server Boost", price: 50, desc: "A server-specific item", type: "consumable", premiumOnly: false, source: "server", owned: false, equipped: false },
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
    adminGuilds: { guilds: [{ id: "987654321", name: "Test Server" }] },
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
          admin: { eligible: true },
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
