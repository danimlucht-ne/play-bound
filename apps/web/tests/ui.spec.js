import { test, expect } from "@playwright/test";
import { dismissOnboarding, mockPlayBoundApi } from "./helpers.js";

async function openAdminDrawer(page) {
  await page.locator("#user-menu-toggle").click();
  await expect(page.locator("#btn-admin-panel")).toBeVisible();
  await page.locator("#btn-admin-panel").click();
  await expect(page.locator("#admin-drawer")).toHaveClass(/open/);
}

test.describe("PlayBound UI coverage", () => {
  test("header section tabs swap the main visible panel", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: false });
    await page.goto("/");

    await expect(page.locator("#start-here")).toBeVisible();
    await page.locator('.nav-main a[data-section-tab="factions"]').click();
    await expect(page.locator('.nav-main a[data-section-tab="factions"]')).toHaveClass(/active/);
    await expect(page.locator("#factions")).toBeVisible();
    await expect(page.locator("#start-here")).toBeHidden();

    await page.locator('.nav-main a[data-section-tab="leaderboards"]').click();
    await expect(page.locator('.nav-main a[data-section-tab="leaderboards"]')).toHaveClass(/active/);
    await expect(page.locator("#leaderboards")).toBeVisible();
    await expect(page.locator("#factions")).toBeHidden();
  });

  test("factions and leaderboard panels surface the full six-faction UI", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: false });
    await page.goto("/");

    await page.locator('.nav-main a[data-section-tab="factions"]').click();
    const pills = page.locator("#factions .faction-pill");
    await expect(pills).toHaveCount(6);
    await expect(page.locator("#factions")).toContainText("Phoenixes");
    await expect(page.locator("#factions")).toContainText("Unicorns");
    await expect(page.locator("#factions")).toContainText("Fireflies");
    await expect(page.locator("#factions")).toContainText("Dragons");
    await expect(page.locator("#factions")).toContainText("Wolves");
    await expect(page.locator("#factions")).toContainText("Eagles");

    await page.locator('.nav-main a[data-section-tab="leaderboards"]').click();
    await page.locator('#leaderboards button[data-tab="factions"]').click();
    await expect(page.locator("#lb-factions.active")).toContainText("Phoenixes");
    await expect(page.locator("#lb-factions.active")).toContainText("Unicorns");
  });

  test("leaderboard inner tabs switch between players, factions, seasons, and recruiters", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: false });
    await page.goto("/");

    await page.locator('.nav-main a[data-section-tab="leaderboards"]').click();
    await expect(page.locator("#lb-players.active")).toContainText("PlayBound User");

    await page.locator('#leaderboards button[data-tab="factions"]').click();
    await expect(page.locator("#lb-factions.active")).toContainText("Official Faction Rankings");

    await page.locator('#leaderboards button[data-tab="seasons"]').click();
    await expect(page.locator("#lb-seasons.active")).toContainText("2026-Q2");

    await page.locator('#leaderboards button[data-tab="recruiters"]').click();
    await expect(page.locator("#lb-recruiters.active")).toContainText("Invite leaderboard");
    await expect(page.locator("#lb-recruiters.active")).toContainText("PlayBound User");
  });

  test("dashboard tabs render across stats, faction, achievements, shop, and premium", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: true });
    await page.goto("/");
    await dismissOnboarding(page);

    await page.locator("#nav-dash-top").click();
    await expect(page.locator("#pb-dash-tab-stats.active")).toContainText("Game Stats");

    await page.locator('.pb-dash-tabs button[data-dash-tab="faction"]').click();
    await expect(page.locator("#pb-dash-tab-faction.active")).toContainText("Wolves");

    await page.locator('.pb-dash-tabs button[data-dash-tab="achievements"]').click();
    await expect(page.locator("#pb-dash-tab-achievements.active")).toContainText("First Class");

    await page.locator('.pb-dash-tabs button[data-dash-tab="shop"]').click();
    await expect(page.locator("#pb-dash-tab-shop.active")).toContainText("Star Badge");

    await page.locator('.pb-dash-tabs button[data-dash-tab="premium"]').click();
    await expect(page.locator("#pb-dash-tab-premium.active")).toContainText(/premium|boost/i);
  });

  test("standard admins can use the full non-developer drawer", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: true, adminEligible: true, isDeveloper: false });
    await page.goto("/");
    await dismissOnboarding(page);
    await openAdminDrawer(page);

    await expect(page.locator("#admin-drawer-title")).toContainText("Admin control room");
    await expect(page.locator("#admin-tab-legal-btn")).toBeHidden();
    await expect(page.locator("#admin-tab-logs-btn")).toBeHidden();
    await expect(page.locator("#admin-tab-servers-btn")).toBeHidden();

    await page.locator('[data-admin-tab="overview"]').click();
    await expect(page.locator("#admin-tab-overview.active")).toContainText("Active games");

    await page.locator('[data-admin-tab="games"]').click();
    await expect(page.locator("#admin-tab-games.active")).toContainText("Trivia");

    await page.locator('[data-admin-tab="economy"]').click();
    await expect(page.locator("#admin-tab-economy.active")).toContainText("Adjust credits");

    await page.locator('[data-admin-tab="factions"]').click();
    await expect(page.locator("#admin-tab-factions.active")).toContainText("Official Faction Rankings");

    await page.locator('[data-admin-tab="shop"]').click();
    await expect(page.locator("#admin-tab-shop.active")).toContainText("Server Boost");

    await page.locator('[data-admin-tab="channels"]').click();
    await expect(page.locator("#admin-tab-channels.active")).toContainText("Save channels");

    await page.locator('[data-admin-tab="automation"]').click();
    await expect(page.locator("#admin-tab-automation.active")).toContainText("Schedule announcement");

    await page.locator('[data-admin-tab="roles"]').click();
    await expect(page.locator("#admin-tab-roles.active")).toContainText("Set manager role");

    await page.locator('[data-admin-tab="audit"]').click();
    await expect(page.locator("#admin-tab-audit.active")).toContainText("Last 7 days");
  });

  test("developer-only admin tabs appear and load content for the developer account", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: true, adminEligible: true, isDeveloper: true });
    await page.goto("/");
    await dismissOnboarding(page);
    await openAdminDrawer(page);

    await expect(page.locator("#admin-tab-legal-btn")).toBeVisible();
    await expect(page.locator("#admin-tab-logs-btn")).toBeVisible();
    await expect(page.locator("#admin-tab-servers-btn")).toBeVisible();

    await page.locator('#admin-tab-legal-btn').click();
    await expect(page.locator("#admin-tab-legal.active")).toContainText("Publish new versions");
    await expect(page.locator("#admin-tab-legal.active")).toContainText("2026-04-06");

    await page.locator('#admin-tab-logs-btn').click();
    await expect(page.locator("#admin-tab-logs.active")).toContainText("Process PID");
    await expect(page.locator("#admin-tab-logs.active")).toContainText("Buffered lines");
    await expect(page.locator("#admin-tab-logs.active")).toContainText("Reload tail");

    await page.locator('#admin-tab-servers-btn').click();
    await expect(page.locator("#admin-tab-servers.active")).toContainText("Test Server");
    await expect(page.locator("#admin-tab-servers.active")).toContainText("Added");
  });

  test("non-admin logged-in users do not get the admin drawer entry", async ({ page }) => {
    await mockPlayBoundApi(page, { loggedIn: true, adminEligible: false, isDeveloper: false });
    await page.goto("/");
    await dismissOnboarding(page);

    await page.locator("#user-menu-toggle").click();
    await expect(page.locator("#btn-admin-panel")).toBeHidden();
  });
});
