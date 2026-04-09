import { test, expect } from "@playwright/test";
import { dismissOnboarding, mockPlayBoundApi } from "./helpers.js";

test.describe("Dashboard smoke tests", () => {
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
    await page.locator('.pb-dash-tabs button[data-dash-tab="faction"]').click();
    await expect(page.locator("#pb-dash-faction")).toContainText("Factions");
    await expect(page.locator("#pb-dash-faction")).toContainText("111111111111111111");
    await expect(page.locator("#pb-dash-faction")).toContainText("Wolves");
  });

  test("Shop browser renders items grouped by type", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: true });
    await page.goto("/");
    await dismissOnboarding(page);
    await page.locator("#nav-dash-top").click();
    await page.locator('.pb-dash-tabs button[data-dash-tab="shop"]').click();
    await expect(page.locator("#pb-dash-shop")).toContainText("Shop");
    await expect(page.locator("#pb-dash-shop")).toContainText("Star Badge");
    await expect(page.locator("#pb-dash-shop")).toContainText("Owned");
  });

  test("Dashboard hash selects tab without clicking section pills", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: true });
    await page.goto("/#dashboard-shop");
    await dismissOnboarding(page);
    await expect(page.locator("#pb-dash-tab-shop.active")).toBeVisible();
    await expect(page.locator("#pb-dash-shop")).toContainText("Star Badge");
  });

  test("Admin drawer opens for eligible admins and lists drawer sections", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: true });
    await page.goto("/");
    await dismissOnboarding(page);
    await page.locator("#user-menu-toggle").click();
    await expect(page.locator("#btn-admin-panel")).toBeVisible();
    await page.locator("#btn-admin-panel").click();
    await expect(page.locator("#admin-drawer")).toHaveClass(/open/);
    await expect(page.locator("#admin-drawer-title")).toContainText("Admin control room");
    await expect(page.locator("#admin-drawer-close")).toBeVisible();
    await expect(page.locator(".admin-drawer-sidebar")).toContainText("Shop");
    await expect(page.locator(".admin-drawer-sidebar")).toContainText("Channels");
  });

  test("Mobile viewport stacks dashboard cards vertically", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await mockPlayBoundApi(page, { loggedIn: true });
    await page.goto("/");
    await dismissOnboarding(page);
    await page.locator("#nav-dash-top").click();
    await expect(page.locator("#pb-dash-detail-grid .pb-dash-tabs")).toBeVisible();
    await page.locator('.pb-dash-tabs button[data-dash-tab="premium"]').click();
    const premiumPanel = page.locator("#pb-dash-tab-premium.active");
    await expect(premiumPanel).toBeVisible();
    const style = await premiumPanel.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    // Premium tab holds two cards; on mobile should be single column
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
