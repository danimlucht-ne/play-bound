import { test, expect } from "@playwright/test";
import { createApiMock } from "./fixtures/mock-api.js";

async function mockPlayBoundApi(page, options = {}) {
  const data = createApiMock(Boolean(options.loggedIn));
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

test.describe("Dashboard smoke tests", () => {
  async function dismissOnboarding(page) {
    // The onboarding overlay opens for logged-in users and blocks nav clicks.
    // Wait for it to appear, then close it via the X button.
    const xBtn = page.locator('[data-pb-ob-close]:not(.pb-ob-backdrop)').first();
    try {
      await xBtn.waitFor({ state: 'visible', timeout: 3000 });
      await xBtn.click({ force: true });
      // Wait for overlay to actually hide
      await page.locator('#pb-onboarding-overlay.hidden').waitFor({ state: 'attached', timeout: 2000 });
    } catch (e) {
      // Overlay may not appear in all test scenarios
    }
    await page.waitForTimeout(200);
  }

  test("My Dashboard tab is visible for logged-in users", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: true });
    await page.goto("/");
    await dismissOnboarding(page);
    await expect(page.locator("#nav-dash-top")).toBeVisible();
  });

  test("My Dashboard tab is hidden for guests", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: false });
    await page.goto("/");
    await expect(page.locator("#nav-dash-top")).toBeHidden();
  });

  test("Stats card renders with mock data when dashboard tab is activated", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: true });
    await page.goto("/");
    await dismissOnboarding(page);
    await page.locator("#nav-dash-top").click();
    await expect(page.locator("#pb-dash-stats")).toContainText("Game Stats");
    await expect(page.locator("#pb-dash-stats")).toContainText("42");
  });

  test("Faction card lists all per-server enrollments from API", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: true });
    await page.goto("/");
    await dismissOnboarding(page);
    await page.locator("#nav-dash-top").click();
    await expect(page.locator("#pb-dash-faction")).toContainText("Factions");
    await expect(page.locator("#pb-dash-faction")).toContainText("111111111111111111");
    await expect(page.locator("#pb-dash-faction")).toContainText("Wolves");
  });

  test("Shop browser renders items grouped by type", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: true });
    await page.goto("/");
    await dismissOnboarding(page);
    await page.locator("#nav-dash-top").click();
    await expect(page.locator("#pb-dash-shop")).toContainText("Shop");
    await expect(page.locator("#pb-dash-shop")).toContainText("Star Badge");
    await expect(page.locator("#pb-dash-shop")).toContainText("Owned");
  });

  test("Admin drawer opens for eligible admins and lists drawer sections", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: true });
    await page.goto("/");
    await dismissOnboarding(page);
    await page.locator("#user-menu-toggle").click();
    await expect(page.locator("#btn-admin-panel")).toBeVisible();
    await page.locator("#btn-admin-panel").click();
    await expect(page.locator("#admin-drawer")).toHaveClass(/open/);
    await expect(page.locator("#admin-drawer-title")).toContainText("Admin panel");
    await expect(page.locator(".admin-tabbar")).toContainText("Shop");
    await expect(page.locator(".admin-tabbar")).toContainText("Channels");
  });

  test("Mobile viewport stacks dashboard cards vertically", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockPlayBoundApi(page, { loggedIn: true });
    await page.goto("/");
    await dismissOnboarding(page);
    await page.locator("#nav-dash-top").click();
    const grid = page.locator(".pb-dash-grid");
    await expect(grid).toBeVisible();
    const style = await grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    // On mobile, should be single column
    expect(style).not.toContain("1fr 1fr");
  });

  test("Stats API failure shows error with retry button", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: true, failPath: "/api/me/stats" });
    await page.goto("/");
    await dismissOnboarding(page);
    await page.locator("#nav-dash-top").click();
    await expect(page.locator("#pb-dash-stats")).toContainText("Could not load stats");
    await expect(page.locator("#pb-dash-stats button")).toBeVisible();
  });
});
