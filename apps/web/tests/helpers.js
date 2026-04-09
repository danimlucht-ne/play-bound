import { createApiMock } from "./fixtures/mock-api.js";

export async function mockPlayBoundApi(page, options = {}) {
  const data = createApiMock(options);
  const failPath = options.failPath || null;

  await page.route("https://api.play-bound.com/**", async (route) => {
    const url = route.request().url();
    const parsed = new URL(url);
    const apiPath = parsed.pathname + parsed.search;

    if (failPath && apiPath.startsWith(failPath)) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "forced failure" }),
      });
      return;
    }

    const responses = [
      ["/api/public-config", data.publicConfig],
      ["/api/stats/global", data.statsGlobal],
      ["/api/leaderboard/players", data.players],
      ["/api/leaderboard/factions", data.factions],
      ["/api/leaderboard/recruiters", data.recruiters],
      ["/api/me/stats", data.meStats],
      ["/api/me/faction", data.meFaction],
      ["/api/me/achievements", data.meAchievements],
      ["/api/me/onboarding", { onboarding: data.me.onboarding || null }],
      ["/api/me", data.me],
      ["/api/shop", data.shop],
      ["/api/admin/channels", data.adminChannels],
      ["/api/admin/shop", data.adminShop],
      ["/api/admin/guilds", data.adminGuilds],
      ["/api/admin/overview", data.adminOverview],
      ["/api/admin/games", data.adminGames],
      ["/api/admin/economy", data.adminEconomy],
      ["/api/admin/factions", data.adminFactions],
      ["/api/admin/referrals", data.adminReferrals],
      ["/api/admin/automation", data.adminAutomation],
      ["/api/admin/roles", data.adminRoles],
      ["/api/admin/audit", data.adminAudit],
      ["/api/admin/legal-policy", data.adminLegalPolicy],
      ["/api/admin/runtime-logs", data.adminRuntimeLogs],
      ["/api/admin/guild-installs", data.adminGuildInstalls],
      ["/api/seasons/current", data.seasonCurrent],
      ["/api/seasons/hall", data.seasonHall],
      ["/api/games/today", data.gamesToday],
      ["/api/auth/logout", { ok: true }],
    ];

    const match = responses.find(([prefix]) => apiPath.startsWith(prefix));
    if (!match) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: `No mock for ${apiPath}` }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(match[1]),
    });
  });
}

export async function dismissOnboarding(page) {
  const xBtn = page.locator('[data-pb-ob-close]:not(.pb-ob-backdrop)').first();
  try {
    await xBtn.waitFor({ state: "visible", timeout: 3000 });
    await xBtn.click({ force: true });
    await page.locator("#pb-onboarding-overlay.hidden").waitFor({ state: "attached", timeout: 2000 });
  } catch (e) {
    // Overlay may not appear in all test scenarios.
  }
  await page.waitForTimeout(200);
}

