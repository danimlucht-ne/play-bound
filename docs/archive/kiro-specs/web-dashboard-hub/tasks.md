# Implementation Plan: Web Dashboard Hub

## Overview

Transform the PlayBound website from a marketing landing page into a full authenticated web dashboard. Backend work adds new Express route modules in `src/server/api/` registered in `src/server/webhook.js`. Frontend work adds new tab sections and cards to the existing vanilla JS single-page app at `lucht-applications/play-bound/index.html`. Pure logic functions are extracted into testable modules for property-based testing with `fast-check`.

## Tasks

- [ ] 1. Backend API — Personal Stats & Faction Endpoints
  - [ ] 1.1 Create `src/server/api/meStatsRoutes.js` with `GET /api/me/stats`
    - Export `createMeStatsRouter()` returning an Express Router
    - Use `User.aggregate` with `$match` on userId (excluding `PUBLIC_STATS_EXCLUDE_GUILD_IDS`), `$group` to sum each `stats.*Wins` field, and count distinct guilds with any win > 0
    - Wrap in `mongoRouter.runWithForcedModels(getModelsProd(), ...)`
    - Return 401 with `login_required` if no `req.pbSession`
    - Response shape: `{ totalGamesWon, perGame: { trivia, serverdle, unscramble, tune, caption, sprint, guess }, serverCount, cachedAt }`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ] 1.2 Create `src/server/api/meFactionRoutes.js` with `GET /api/me/faction`
    - Export `createMeFactionRouter()` returning an Express Router
    - Find user's faction from any non-excluded User doc
    - Look up Faction standings via `getGlobalFactionStandingsFromUsers()` to compute rank
    - Count FactionChallenge docs where userId appears in `participantsA`, `participantsB`, or any value array in `participantsByFaction`
    - Fetch last 10 ended challenges where user participated, sorted by `endedAt` desc
    - Return `{ faction: null }` with 200 if no faction
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ] 1.3 Create `src/server/api/meAchievementsRoutes.js` with `GET /api/me/achievements`
    - Export `createMeAchievementsRouter()` returning an Express Router
    - Fetch all User docs for userId, collect `achievements` arrays, deduplicate with `Set`
    - Resolve each key using `resolveAchievementMeta(key, cfg)` from `lib/achievements.js` (built-in ACHIEVEMENTS first, then each guild's `customAchievements`)
    - If key unresolvable: name = raw key, desc = null
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 1.4 Write unit tests for stats, faction, and achievements routes
    - Create `tests/meStatsRoutes.test.js` using `node:test` + `routerTestUtils` pattern
    - Create `tests/meFactionRoutes.test.js` — test response shape, no-faction case, 401
    - Create `tests/meAchievementsRoutes.test.js` — test deduplication, resolution, unresolvable keys
    - _Requirements: 1.1, 1.4, 6.1, 6.4, 8.1, 8.3_

  - [ ]* 1.5 Write property tests for stats aggregation and faction logic
    - **Property 1: Stats aggregation with guild exclusion** — verify per-game sums and server count exclude excluded guilds
    - **Validates: Requirements 1.1, 1.2, 1.5**
    - **Property 6: Faction rank computation** — verify rank = 1 + count of factions with strictly higher matchPoints
    - **Validates: Requirements 6.1**
    - **Property 7: Challenge participation count** — verify count matches docs where userId in participantsA/B/participantsByFaction
    - **Validates: Requirements 6.2**
    - **Property 8: War history recency** — verify at most 10 entries sorted by endedAt desc, omitted entries are older
    - **Validates: Requirements 6.3**

- [ ] 2. Backend API — Shop Endpoints
  - [ ] 2.1 Create `src/server/api/shopRoutes.js` with `GET /api/shop`
    - Export `createShopRouter()` returning an Express Router
    - Fetch global `ShopItem.find({})`, optionally merge server-specific `SystemConfig.shopItems` if `guildId` provided
    - If authenticated, compute `owned` and `equipped` flags from user's `inventory` and `currentCosmetics`
    - If unauthenticated, omit `owned`/`equipped` fields
    - Each item includes: id, name, price, desc, type, premiumOnly, source ("global" | "server")
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ] 2.2 Create `src/server/api/adminShopRoutes.js` with POST/PUT/DELETE `/api/admin/shop`
    - Export `createAdminShopRouter()` returning an Express Router
    - Use `requireAdminSession` + `requireGuildAccess` middleware from `adminAuth.js`
    - POST appends to `SystemConfig.shopItems` via `$push`
    - PUT uses positional update at `:itemIndex`
    - DELETE uses `$unset` + `$pull` at `:itemIndex`
    - Return 404 `item_not_found` if index out of bounds, 403 if no guild access
    - Validate: name non-empty, price positive integer — return 400 on invalid
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 11.6_

  - [ ]* 2.3 Write unit tests for shop routes
    - Create `tests/shopRoutes.test.js` — test merge logic, owned/equipped flags, unauthenticated response, missing guildId
    - Create `tests/adminShopRoutes.test.js` — test CRUD operations, index bounds, auth, validation
    - _Requirements: 3.1, 3.3, 3.6, 12.1, 12.4, 12.5_

  - [ ]* 2.4 Write property tests for shop logic
    - **Property 3: Shop item merge completeness** — verify merged response contains every item from both sources with required fields
    - **Validates: Requirements 3.1, 3.2**
    - **Property 4: Shop ownership flag correctness** — verify owned/equipped flags match inventory and currentCosmetics
    - **Validates: Requirements 3.3, 3.4**
    - **Property 11: Shop item validation rejects invalid inputs** — verify empty name or non-positive price rejected
    - **Validates: Requirements 11.6**

- [ ] 3. Backend API — Admin Channel & Challenge Endpoints
  - [ ] 3.1 Create `src/server/api/adminChannelRoutes.js` with GET/PATCH `/api/admin/channels`
    - Export `createAdminChannelRouter()` returning an Express Router
    - GET reads guild channels from `client.guilds.cache.get(guildId).channels.cache` filtered to text channels, plus current SystemConfig assignments
    - PATCH validates each channelId exists in the guild before updating SystemConfig
    - Return 400 `invalid_channel` if channelId not in guild
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [ ]* 3.2 Write unit tests for admin channel routes
    - Create `tests/adminChannelRoutes.test.js` — test channel list, PATCH validation, invalid channel rejection, auth
    - _Requirements: 14.1, 14.4_

- [ ] 4. Backend wiring — Register all new routes in `src/server/webhook.js`
  - Import and mount all new route factories:
    - `app.use('/api/me/stats', loadSessionMiddleware, createMeStatsRouter())`
    - `app.use('/api/me/faction', loadSessionMiddleware, createMeFactionRouter())`
    - `app.use('/api/me/achievements', loadSessionMiddleware, createMeAchievementsRouter())`
    - `app.use('/api/shop', loadSessionMiddleware, createShopRouter())` (session optional inside handler)
    - `app.use('/api/admin/shop', loadSessionMiddleware, createAdminShopRouter())`
    - `app.use('/api/admin/channels', loadSessionMiddleware, createAdminChannelRouter())`
  - Update CORS `Access-Control-Allow-Methods` to include PUT, DELETE, PATCH
  - _Requirements: 1.1, 3.1, 6.1, 8.1, 12.1, 14.1_

- [ ] 5. Checkpoint — Backend API complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Frontend — My Dashboard Tab & Stats Card
  - [ ] 6.1 Add "My Dashboard" tab to the existing navigation bar
    - Only visible when user is logged in (check existing auth state)
    - Tab switching follows existing pattern (show/hide sections by id)
    - Preserve existing profile strip for logged-in users
    - _Requirements: 20.1, 20.2, 20.4_

  - [ ] 6.2 Create Stats Card section in My Dashboard
    - Fetch `GET /api/me/stats` on tab activation
    - Display total games won and per-game-type win counts (trivia, serverdle, unscramble, tune, caption, sprint, guess)
    - Format: "{N} wins across {M} servers"
    - Show zero for game types with no wins
    - Loading skeleton while fetching, inline error + retry button on failure
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 6.3 Write property test for stats display format
    - **Property 2: Stats display format** — verify format function produces `"{N} wins across {M} servers"` for any non-negative N and positive M
    - **Validates: Requirements 2.2**

- [ ] 7. Frontend — Shop Browser & Faction Profile
  - [ ] 7.1 Create Shop Browser section in My Dashboard
    - Fetch `GET /api/shop?guildId=X` on tab activation
    - Display items grouped by type (consumable, cosmetic, badge, color, role)
    - Show "Owned" badge on owned items, "Equipped" indicator on equipped items
    - Show premium indicator (lock icon + "Premium Only" label) on premiumOnly items; hide lock for premium users
    - Server selector dropdown triggers data reload for selected guild
    - Display each item's name, price, description, and type
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 17.1, 17.2, 17.3_

  - [ ]* 7.2 Write property test for shop item rendering
    - **Property 5: Shop item rendering completeness** — verify rendered HTML contains item name, price, description, and type
    - **Validates: Requirements 4.6**

  - [ ] 7.3 Create Faction Profile Card section in My Dashboard
    - Fetch `GET /api/me/faction` on tab activation
    - Display faction name, emoji, match points, global rank, war count
    - Show "no faction" message with Discord join prompt if `faction: null`
    - Inline error + retry button on failure
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ] 7.4 Create Achievement Showcase section in My Dashboard
    - Fetch `GET /api/me/achievements` on tab activation
    - Display all achievements with resolved name and description
    - Show "no achievements" message with guidance if empty
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]* 7.5 Write property tests for achievement logic
    - **Property 9: Achievement deduplication across guilds** — verify returned list is set-union with no duplicates
    - **Validates: Requirements 7.3, 8.1**
    - **Property 10: Achievement key resolution** — verify built-in keys resolve to built-in entry, custom keys to custom entry, unknown keys to raw key + null desc
    - **Validates: Requirements 7.2, 8.2, 8.3**

- [ ] 8. Frontend — Premium Status Card
  - [ ] 8.1 Create Premium Status Card section in My Dashboard
    - Display "Premium Active" with subscription source for premium users
    - Display subscribe prompt with Stripe links for non-premium users
    - List active perks: 2x multiplier, extended streak cap, faction switch, automation access
    - _Requirements: 16.1, 16.2, 16.3_

- [ ] 9. Frontend — Admin Dashboard Layout
  - [ ] 9.1 Convert admin interface from slide-out drawer to full-width tab
    - Render as full-width page section replacing main content area
    - Organize into sub-tabs: Overview, Games, Economy, Factions, Shop, Channels, Referrals, Automation, Roles, Audit
    - Hide admin tab for non-admin users
    - Server selector loads all sub-tab data for selected guild
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ] 9.2 Create Shop Manager admin sub-tab
    - Display server-specific shop items from SystemConfig `shopItems`
    - "Add Item" form: name, price, description, type dropdown, premiumOnly toggle
    - Edit and delete actions calling PUT/DELETE `/api/admin/shop/:itemIndex`
    - Client-side validation: name non-empty, price positive integer
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ] 9.3 Create Channel Configurator admin sub-tab
    - Display current channel assignments for all 6 channel types
    - Populate dropdowns from guild text channels via `GET /api/admin/channels`
    - Save sends PATCH to update SystemConfig; "None" option sets field to null
    - Error handling: show error and revert dropdown on failure
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [ ] 9.4 Create Challenge Manager admin sub-tab
    - Display active FactionChallenge docs with faction names, scores, end time, mode
    - "End Challenge" button sends POST to `/api/admin/factions/challenge/end`
    - History section: last 12 completed challenges with winner, matchup, scores, match points
    - Permission check: show insufficient permissions message if needed
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

  - [ ] 9.5 Create Game Scheduler in Games admin sub-tab
    - Form: server selector, channel selector (from guild text channels), game type selector (from PLATFORM_GAME_TAGS)
    - "Start Now" sends POST to existing `/api/admin/games`
    - "Schedule" creates RecurringGameSchema with interval
    - Display maintenance denial message if applicable
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [ ] 9.6 Wire Premium Automation Controls in Automation admin sub-tab
    - Display existing recurring games and scheduled announcements for premium admins
    - Create/delete recurring games via RecurringGameSchema
    - Non-premium admins see read-only view with upgrade prompt
    - _Requirements: 18.1, 18.2, 18.3, 18.4_

  - [ ] 9.7 Add Boost Session History to My Dashboard (premium only)
    - Display last 20 boost sessions (game type, guild name, timestamp)
    - Show "no boost sessions" message if empty
    - Hide section for non-premium users
    - _Requirements: 19.1, 19.2, 19.3_

- [ ] 10. Frontend — Responsive Layout & Mobile
  - [ ] 10.1 Implement responsive layout for all new sections
    - Stack all cards vertically in single column below 768px viewport width
    - Use CSS grid with `grid-template-columns: 1fr` for mobile
    - Follow existing card pattern: `.surface-elevated` background, `.border` borders, `border-radius: 14px`
    - _Requirements: 20.5_

- [ ] 11. Checkpoint — Frontend complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Frontend Tests — Playwright Smoke Tests
  - [ ] 12.1 Extend `lucht-applications/play-bound/tests/fixtures/mock-api.js` with new endpoint mocks
    - Add mock responses for `/api/me/stats`, `/api/me/faction`, `/api/me/achievements`, `/api/shop`
    - Add mock responses for admin endpoints: `/api/admin/channels`, `/api/admin/shop`
    - _Requirements: 1.1, 3.1, 6.1, 8.1_

  - [ ]* 12.2 Write Playwright smoke tests for dashboard features
    - Extend `lucht-applications/play-bound/tests/smoke.spec.js` or create new spec file
    - Test "My Dashboard" tab visibility for logged-in vs guest
    - Test stats card renders with mock data
    - Test shop browser renders items grouped by type
    - Test admin tab renders full-width with sub-tabs
    - Test mobile viewport stacks cards vertically
    - Test API failure shows error + retry button
    - _Requirements: 2.1, 4.1, 9.1, 20.1, 20.5_

- [ ] 13. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Backend tests use `node:test` + `routerTestUtils` (existing pattern in `discord-bot/discord-bot-games/tests/`)
- Frontend tests use Playwright (existing pattern in `lucht-applications/play-bound/tests/`)
- Property tests use `fast-check` with minimum 100 iterations per property
- All new route modules follow the `createXRouter()` factory pattern and are registered in `src/server/webhook.js`
