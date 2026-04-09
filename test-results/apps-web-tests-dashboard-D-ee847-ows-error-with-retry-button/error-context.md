# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: apps\web\tests\dashboard.spec.js >> Dashboard smoke tests >> Stats API failure shows error with retry button
- Location: apps\web\tests\dashboard.spec.js:147:3

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/", waiting until "load"

```

# Test source

```ts
  49  |       });
  50  |       return;
  51  |     }
  52  | 
  53  |     await route.fulfill({
  54  |       status: 200,
  55  |       contentType: "application/json",
  56  |       body: JSON.stringify(match[1]),
  57  |     });
  58  |   });
  59  | }
  60  | 
  61  | test.describe("Dashboard smoke tests", () => {
  62  |   async function dismissOnboarding(page) {
  63  |     // The onboarding overlay opens for logged-in users and blocks nav clicks.
  64  |     // Wait for it to appear, then close it via the X button.
  65  |     const xBtn = page.locator('[data-pb-ob-close]:not(.pb-ob-backdrop)').first();
  66  |     try {
  67  |       await xBtn.waitFor({ state: 'visible', timeout: 3000 });
  68  |       await xBtn.click({ force: true });
  69  |       // Wait for overlay to actually hide
  70  |       await page.locator('#pb-onboarding-overlay.hidden').waitFor({ state: 'attached', timeout: 2000 });
  71  |     } catch (e) {
  72  |       // Overlay may not appear in all test scenarios
  73  |     }
  74  |     await page.waitForTimeout(200);
  75  |   }
  76  | 
  77  |   test("My Dashboard tab is visible for logged-in users", async ({ page }) => {
  78  |     await mockPlayBoundApi(page, { loggedIn: true });
  79  |     await page.goto("/");
  80  |     await dismissOnboarding(page);
  81  |     await expect(page.locator("#nav-dash-top")).toBeVisible();
  82  |   });
  83  | 
  84  |   test("My Dashboard tab is hidden for guests", async ({ page }) => {
  85  |     await mockPlayBoundApi(page, { loggedIn: false });
  86  |     await page.goto("/");
  87  |     await expect(page.locator("#nav-dash-top")).toBeHidden();
  88  |   });
  89  | 
  90  |   test("Stats card renders with mock data when dashboard tab is activated", async ({ page }) => {
  91  |     await mockPlayBoundApi(page, { loggedIn: true });
  92  |     await page.goto("/");
  93  |     await dismissOnboarding(page);
  94  |     await page.locator("#nav-dash-top").click();
  95  |     await expect(page.locator("#pb-dash-stats")).toContainText("Game Stats");
  96  |     await expect(page.locator("#pb-dash-stats")).toContainText("42");
  97  |   });
  98  | 
  99  |   test("Faction card lists all per-server enrollments from API", async ({ page }) => {
  100 |     await mockPlayBoundApi(page, { loggedIn: true });
  101 |     await page.goto("/");
  102 |     await dismissOnboarding(page);
  103 |     await page.locator("#nav-dash-top").click();
  104 |     await expect(page.locator("#pb-dash-faction")).toContainText("Factions");
  105 |     await expect(page.locator("#pb-dash-faction")).toContainText("111111111111111111");
  106 |     await expect(page.locator("#pb-dash-faction")).toContainText("Wolves");
  107 |   });
  108 | 
  109 |   test("Shop browser renders items grouped by type", async ({ page }) => {
  110 |     await mockPlayBoundApi(page, { loggedIn: true });
  111 |     await page.goto("/");
  112 |     await dismissOnboarding(page);
  113 |     await page.locator("#nav-dash-top").click();
  114 |     await expect(page.locator("#pb-dash-shop")).toContainText("Shop");
  115 |     await expect(page.locator("#pb-dash-shop")).toContainText("Star Badge");
  116 |     await expect(page.locator("#pb-dash-shop")).toContainText("Owned");
  117 |   });
  118 | 
  119 |   test("Admin drawer opens for eligible admins and lists drawer sections", async ({ page }) => {
  120 |     await mockPlayBoundApi(page, { loggedIn: true });
  121 |     await page.goto("/");
  122 |     await dismissOnboarding(page);
  123 |     await page.locator("#user-menu-toggle").click();
  124 |     await expect(page.locator("#btn-admin-panel")).toBeVisible();
  125 |     await page.locator("#btn-admin-panel").click();
  126 |     await expect(page.locator("#admin-drawer")).toHaveClass(/open/);
  127 |     await expect(page.locator("#admin-drawer-title")).toContainText("Admin panel");
  128 |     await expect(page.locator(".admin-tabbar")).toContainText("Shop");
  129 |     await expect(page.locator(".admin-tabbar")).toContainText("Channels");
  130 |   });
  131 | 
  132 |   test("Mobile viewport stacks dashboard cards vertically", async ({ page }) => {
  133 |     await page.setViewportSize({ width: 375, height: 812 });
  134 |     await mockPlayBoundApi(page, { loggedIn: true });
  135 |     await page.goto("/");
  136 |     await dismissOnboarding(page);
  137 |     await page.locator("#nav-dash-top").click();
  138 |     await expect(page.locator("#pb-dash-detail-grid .pb-dash-tabs")).toBeVisible();
  139 |     await page.locator('.pb-dash-tabs button[data-dash-tab="premium"]').click();
  140 |     const premiumPanel = page.locator("#pb-dash-tab-premium.active");
  141 |     await expect(premiumPanel).toBeVisible();
  142 |     const style = await premiumPanel.evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  143 |     // Premium tab holds two cards; on mobile should be single column
  144 |     expect(style).not.toContain("1fr 1fr");
  145 |   });
  146 | 
  147 |   test("Stats API failure shows error with retry button", async ({ page }) => {
  148 |     await mockPlayBoundApi(page, { loggedIn: true, failPath: "/api/me/stats" });
> 149 |     await page.goto("/");
      |                ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  150 |     await dismissOnboarding(page);
  151 |     await page.locator("#nav-dash-top").click();
  152 |     await expect(page.locator("#pb-dash-stats")).toContainText("Could not load stats");
  153 |     await expect(page.locator("#pb-dash-stats button")).toBeVisible();
  154 |   });
  155 | });
  156 | 
```