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

test.describe("PlayBound smoke coverage", () => {
  test("guest landing page loads branded assets with aligned hero steps", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await mockPlayBoundApi(page, { loggedIn: false });
    await page.goto("/");

    await expect(page.locator(".wordmark__icon")).toBeVisible();
    await expect(page.locator(".hero-banner")).toBeVisible();

    const icon = page.locator(".wordmark__icon");
    await expect(icon).toHaveJSProperty("naturalWidth", 1024);

    const banner = page.locator(".hero-banner");
    await expect(banner).toHaveJSProperty("naturalWidth", 1536);

    const cards = page.locator(".hero-how__step");
    await expect(cards).toHaveCount(4);

    const boxes = await cards.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          top: Math.round(rect.top),
          height: Math.round(rect.height),
          width: Math.round(rect.width),
        };
      }),
    );

    const viewport = page.viewportSize();
    const firstTop = boxes[0].top;
    const firstHeight = boxes[0].height;
    boxes.forEach((box) => {
      if ((viewport?.width || 0) > 620) {
        if (box.top !== firstTop) throw new Error(`Step boxes are misaligned: ${JSON.stringify(boxes)}`);
      }
      if (Math.abs(box.height - firstHeight) > 2) {
        throw new Error(`Step boxes have inconsistent heights: ${JSON.stringify(boxes)}`);
      }
      if (box.width < 80) throw new Error(`Step box too narrow: ${JSON.stringify(boxes)}`);
    });

    await expect(page.locator("#cta-add-nav")).toHaveAttribute("href", /discord\.com/);
    await expect(page.locator("#cta-support")).toHaveAttribute("href", /discord\.gg/);
    expect(pageErrors, `Unexpected page errors: ${pageErrors.join("\n")}`).toEqual([]);
  });

  test("logged-in state exposes dashboard and onboarding affordances", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: true });
    await page.goto("/");

    await expect(page.locator("#auth-user")).toBeVisible();
    await expect(page.locator("#auth-guest")).toBeHidden();
    await expect(page.locator("#nav-dash-top")).toBeVisible();
    await expect(page.locator("#hero-dashboard")).toBeVisible();
    await expect(page.locator("#hero-logged-in")).toContainText("PlayBound User");
    await expect(page.locator("#pb-onboarding-overlay")).toBeVisible();
    await expect(page.locator("[data-pb-ob-main]")).toContainText(/welcome|setup|play/i);
  });

  test("today's game hub renders the current games contract", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: false });
    await page.goto("/");

    await expect(page.locator("#play-hub")).toBeVisible();
    await expect(page.locator("#pb-games-grid .pb-game-card")).toHaveCount(3);
    await expect(page.locator("#pb-games-grid")).toContainText("Risk Roll");
    await expect(page.locator("#pb-games-grid")).toContainText("Daily Duel");
    await expect(page.locator("#hero-play-hint")).toContainText("Risk Roll");
    await expect(page.locator("#play-hub")).toContainText("/playgame");
    await expect(page.locator("#pb-quick-row")).toContainText("Log in");
  });

  test("leaderboard copy keeps factions distinct from player boards", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: false });
    await page.goto("/");

    await expect(page.locator("#leaderboards")).toContainText("Factions");
    await expect(page.locator("#leaderboards")).toContainText("Players");
    await expect(page.locator("#lb-factions-body")).toContainText("Dragons");
    await expect(page.locator("#lb-players-body")).toContainText("PlayBound User");
  });

  test("API failures surface an explicit error instead of a silent broken page", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: false, failPath: "/api/leaderboard/players" });
    await page.goto("/");

    await expect(page.locator("#lb-players-body")).toContainText(/leaderboard temporarily unavailable/i);
    await expect(page.locator("#lb-err")).not.toHaveClass(/hidden/);
  });

  test("deep links and legal pages are reachable in the local rewrite server", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: false });

    await page.goto("/leaderboards");
    await expect(page.locator("#leaderboards")).toBeVisible();

    await page.goto("/terms.html");
    await expect(page.locator("body")).toContainText(/terms/i);

    await page.goto("/privacy.html");
    await expect(page.locator("body")).toContainText(/privacy/i);
  });

  test("public asset routes resolve with the expected content types", async ({ request }) => {
    const icon = await request.get("/playbound_icon.png");
    expect(icon.ok()).toBeTruthy();
    expect(icon.headers()["content-type"]).toContain("image/png");

    const banner = await request.get("/playbound_banner.png");
    expect(banner.ok()).toBeTruthy();
    expect(banner.headers()["content-type"]).toContain("image/png");

    const legacyBanner = await request.get("/playbound-banner.png", { maxRedirects: 0 });
    expect(legacyBanner.status()).toBe(307);
    expect(legacyBanner.headers()["location"]).toBe("/playbound_banner.svg");
  });
});
