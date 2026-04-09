# PlayBound Phase 2 — gated admin panel (full specification)

**Depends on:** [PLAYBOUND_SINGLE_PAGE_LANDING_SPEC.md](./PLAYBOUND_SINGLE_PAGE_LANDING_SPEC.md) (Phase 1 — public single-screen marketing).  
**UI repo:** `lucht_applications`  
**Backend repo:** `discord-bot-games`

Phase 2 adds a **full admin control surface** that **does not replace** the public landing. Public visitors see marketing only; eligible users open the panel as an **overlay, drawer, or distinct in-page mode** (tabs/sections inside that shell are fine).

---

## 1. Product principles

| Principle | Requirement |
|-----------|-------------|
| **Separation** | Landing layout, copy, and primary CTAs remain the default view. Admin UI is opt-in behind **Open Admin Panel**. |
| **Gating** | No admin URL that works without auth; no admin chrome for ineligible users. |
| **Visibility first** | Each section: **read-only metrics and lists** before **actions**. |
| **Single source of truth** | POST actions **call shared service functions** used by slash commands—**no duplicated business rules** (especially scoring). |
| **Safety** | Destructive or irreversible actions require **explicit confirmation** in UI; server validates **guild + permission** again. |

---

## 2. Access control

### 2.1 Who may use the admin panel

Allow **Open Admin Panel** (and all `/api/admin/*` routes) only if **either**:

1. **`user.id === process.env.DEVELOPER_ID`** (same variable as the bot), or  
2. The authenticated Discord user has **Administrator** (`0x8` permission bit) in **at least one guild** where the PlayBound bot is present.

**Bot presence check:** Use the running bot client’s `guilds.cache` keys (or equivalent) intersected with OAuth `guilds` payload. If the user is admin in guilds the bot has left, those guilds **must not** appear in selectors or receive actions.

### 2.2 UI entry

- **Placement:** Top-right (or consistent header area) on the **Phase 1** shell: button **Open Admin Panel**.
- **If ineligible:** **Do not render** the button (no disabled teaser that hints hidden features).

### 2.3 Guild context (required)

Most data and actions are **per-guild**. The panel **must** include a **Guild selector** (dropdown) listing eligible guilds:

- For **normal admins:** guilds where user is Administrator **and** bot is in guild.  
- For **developer:** all guild ids the bot is in (optional filter: “my admin guilds only” toggle).

All section APIs take **`guildId`** as query param or path segment unless the route is explicitly global (e.g. developer-only global overview).

**Query param convention (recommended):** `?guildId=<snowflake>` on GET; `guildId` in JSON body on POST.

---

## 3. Panel shell and navigation

### 3.1 Presentation

Choose one (product decision):

- **Modal overlay** (full-screen on mobile), or  
- **Side drawer** (desktop), or  
- **Expandable “admin mode”** that replaces main scroll with admin layout **but** preserves a persistent **Back to landing** control.

**Required:** One-click **Close / Back to PlayBound** returns to the public view without full page reload if the stack allows.

### 3.2 Internal structure (tabs or segments)

Eight top-level areas (order fixed):

1. **Overview**  
2. **Games**  
3. **Economy**  
4. **Factions**  
5. **Referrals**  
6. **Automation**  
7. **Roles**  
8. **Audit**

Use **tabs**, **segmented control**, or **collapsible nav**; avoid nested routing URLs (SPA path `/admin/...` optional; not required).

---

## 4. Section specifications

### 4.1 Overview

**Purpose:** Operational heartbeat for the **selected guild** (and optional global row for developer).

**Metrics (guild-scoped):**

| Metric | Source / notes |
|--------|----------------|
| Active games | `Game.find({ guildId, status: 'active' })` + in-memory maps for sessions not persisted the same way (see §7.2). |
| Scheduled (pending) | `Game.find({ guildId, status: 'scheduled' })` **and** entries in `state.scheduledGames` for this `guildId` (dedupe by `state.sid`). |
| Recurring games | `RecurringGame.find({ guildId })`. |
| Players (24h) | **Gap:** same as Phase 1 — needs `lastActivityAt` on `User` or heuristic; until then show **“—”** or omit. |
| Points (24h) | Sum of **positive** `pointLedger.amount` for `User` in guild with `at` in window (label breakdown optional). |
| Total servers (global) | `SystemConfig.countDocuments()` — **developer** or small badge only; optional on guild overview. |

**Warnings (optional, boolean chips):**

- Active faction challenge exists (`FactionChallenge` active for guild).  
- Suspicious activity — **only if** fraud API exists (else omit).  

**Quick actions (navigate within panel):**

- View Active Games → **Games** tab, filter active.  
- View Audit → **Audit** tab.  
- View Referrals → **Referrals** tab.  

**Empty states:** Copy like “No active games in this server.”

---

### 4.2 Games

**Lists (guild-scoped):**

1. **Active** — DB `Game` `status: 'active'`; display: `type`, channel/thread id → resolve name via Discord API, `startTime`, `status`.  
2. **Scheduled** — DB `status: 'scheduled'` (`type` often `Scheduled_*`); `startTime`; payload in `state` (announcement text, hosted game options, etc.) — **truncate** in UI.  
3. **Recurring** — `RecurringGame`: `type`, `intervalHours`, `nextRun`, `channelId`.

**Actions (POST):**

| Action | Behavior | Backend alignment |
|--------|----------|-------------------|
| **End active game** | Resolve thread/message id; call same path as Discord `endgame` + `endgame_select` **active** branch: `endActiveGame` + per-game `forceEnd` / trigger ends. | Mirror `interactionCreate.js` (`endgame`, `endgame_select` type `active`). |
| **Cancel scheduled** | Clear in-memory timeout if present (`scheduledGames`), mark DB `Game` ended by `state.sid`. | Mirror **sched** branch. |
| **Remove recurring** | `RecurringGame.findByIdAndDelete`. | Mirror **recur** branch. **Note:** There is **no** “pause recurring” in codebase — UI says **Delete recurring** or **Stop** (= delete). |

**Important:** Cancelling a scheduled item that only exists in DB after restart must still work: `resumeScheduledGames` rehydrates `scheduledGames`; if API runs **in bot process**, schedule map is available. If API is separate, you **must** forward commands to bot (see §7.1).

**Confirmation:** End/cancel/delete → modal “Are you sure?”

---

### 4.3 Economy

**Read-only:**

- **Top players** — top N by `User.points` for `guildId` (same as leaderboard sort for all-time).  
- **Points issued 24h / 7d** — aggregate `pointLedger` for users in guild (define: sum of **all** ledger amounts vs **positive only** — recommend **positive only** for “issued”, separate line for “net”).  
- **Recent manual adjustments** — ledger entries where `label` matches `/^admin_adjust:/`, newest first, limit 20.

**Actions:**

| Action | Rules |
|--------|--------|
| **Adjust points** | **Only** via `addManualPointAdjustment(client, guildId, targetUserId, delta, label)` with `label = admin_adjust:<actorDiscordId>`. **Never** `addScore`. Validation: non-zero integer, **[-5000, 5000]**, reason **required**, reason length **5–180** (match slash). Enforce **faction challenge** rule: positive adjust blocked for faction members while active challenge exists unless actor is developer (`isBotDeveloper`). Negative allowed for correction. |
| **Wipe leaderboard** | Reuse `User.updateMany({ guildId }, { $set: { points: 0, weeklyPoints: 0, monthlyPoints: 0 } })` + `refreshLeaderboard(client, guildId)`. **Strong confirmation** (type server name or “WIPE”). |

**Inspect user:** Link to **Audit** filtered by target user, or inline expandable **last 25** `pointLedger` entries (read-only).

**Audit note:** Slash `/adjustpoints` logs reason to **console** only today; **ledger does not store reason**. Phase 2 **Audit** filters are still valuable; for full reason history, **schema extension** (recommended follow-up) on `pointLedger` or dedicated `AdminAdjustment` collection.

---

### 4.4 Factions

**Read-only (guild + global):**

- **Global standings** — `Faction` sorted by `totalPoints` (Dragons / Wolves / Eagles + any custom factions from `Faction` collection).  
- **Member distribution** — count `User` per `faction` for `guildId` (group aggregation).  
- **Active challenges** — `FactionChallenge.find({ guildId, status: 'active' })`.  
- **Live scores** — from `scoresByUser` + participant maps; show per-team aggregates (reuse `factionChallenge` helpers for totals if exported).

**Actions:**

- **Create challenge** — equivalent to `/faction_challenge create` validation (factions, duration, modes, caps). Prefer POST that calls **same** creation path as slash (immediate start).  
- **End challenge** — same as `/faction_challenge end` (or admin end path).  

**Order:** Show read-only cards first; actions in secondary row or accordion.

---

### 4.5 Referrals

**Read-only:**

- **Successful server referrals** — for guild: `SystemConfig.referralFirstGameRewardGranted` / `ReferralFirstGamePayout` rows involving this guild; globally: top `ReferralProfile.referralSuccessfulCount`.  
- **Pending** — guilds with `referralReferredByUserId` set but `referralFirstGameRewardGranted` false (interpretation: claimed, not yet completed milestone).  
- **Faction recruit counts** — `ReferralProfile.factionRecruitSuccessCount`, `FactionRecruitReward` stats if exposed.  
- **Recruiter leaderboard** — top `ReferralProfile` by `referralSuccessfulCount`.  
- **Rewards paid** — aggregate from ledger / referral lib economics if tracked; else show counts from `referralServerPointsEarned` / faction referral fields on `ReferralProfile`.

**Actions:**

- Copy **referral code** / **invite link** (from `ReferralProfile` for logged-in user; guild-scoped rewards guild from profile).  
- **Inspect history** — list `ReferralFirstGamePayout` for guild (referrer, createdAt).  

**Note:** Premium multiplier copy only if accurate per `lib/referrals.js`; otherwise omit.

---

### 4.6 Automation

**Display** `SystemConfig` for selected guild:

- `announceChannel`  
- `announcePingEveryone` (treat unset as legacy default per bot code)  
- `automatedServerPostsEnabled` (unset = on)  
- Scheduled announcements: from `Game` `Scheduled_Announcement` + `scheduledGames` map  
- `RecurringGame` list (overlap with Games tab — cross-link)

**Actions (POST):**

- Set announcement channel — same as `/set_announcement_channel`.  
- Toggle announce everyone — `/set_announce_everyone`.  
- Toggle automated posts — `/set_automated_posts`.  
- Create scheduled announcement — same validation as `/schedule_announcement` (message, time, channel).  

All must go through **`updateSystemConfig`** / existing helpers, not raw partial updates that skip invariants.

---

### 4.7 Roles

**Display:**

- `managerRoleId`  
- `autoRoleId`  
- `roleRewards` map (achievement key → role id) merged display with achievement names from `ACHIEVEMENTS` + custom achievements.

**Actions:**

- Set manager role — `/set_manager_role`.  
- Set/remove auto role — `/set_auto_role`, `/remove_auto_role`.  
- Sync auto role — `/sync_auto_role`.  
- Strip role — `/strip_role` (user + role).  
- Set role reward — `/set_role_reward`.  

**UX:** If Discord API returns hierarchy error, show the same user-facing guidance as slash commands (“move PlayBound role above …”).

---

### 4.8 Audit (high priority)

**Purpose:** Trust and accountability for manual economy changes.

**Data source:** `User.pointLedger` entries with `label` matching `admin_adjust:<actorId>`. For **reason** and **filter-by-reason**, schema extension recommended.

**Views:**

1. **Recent adjustments** — table: `at`, target user, amount, actor (parsed from label), `guildId` (always known from User doc), optional reason column.  
2. **Summary** — **7d** and **30d** toggles: count of events, net sum of amounts, distinct actors.  
3. **Top adjusting admins** — group by actor id, count and net sum.  
4. **Top adjusted users** — group by target `userId`, count and net sum.  
5. **Faction challenge window** (optional) — flag adjustments where `at` falls inside any `FactionChallenge` active period for that guild (requires joining challenge `createdAt`–`endedAt` or `endAt`).

**Filters (Phase 2 scope — keep simple):**

- **Guild** — required via global selector; optional “all my guilds” for developer.  
- **Target user** — snowflake filter.  
- **Acting admin** — snowflake filter.  
- **Time window** — preset: 24h / 7d / 30d / custom from–to.

**Implementation note:** Efficient queries may require MongoDB aggregation with `$unwind` on `pointLedger` and `$match` on label regex; index strategy TBD (`User.guildId` + compound if high volume).

**Export:** Out of scope for Phase 2; link to Discord for detailed review if slash command added later.

---

## 5. API specification

**Base path:** `/api/admin/...` (consistent with Phase 1 `/api/...`).  
**Auth:** Session cookie or `Authorization: Bearer <session>` after Discord OAuth; **CSRF** protection for POST (same-site cookie or double-submit token).

### 5.1 GET endpoints

| Route | Query | Response intent |
|-------|--------|-----------------|
| `GET /api/admin/eligibility` | — | `{ eligible: boolean, guilds: [{ id, name, icon? }] }` |
| `GET /api/admin/overview` | `guildId` | Overview metrics §4.1 |
| `GET /api/admin/games` | `guildId` | `{ active, scheduled, recurring }` arrays |
| `GET /api/admin/economy` | `guildId` | top players, aggregates, recent manual rows |
| `GET /api/admin/factions` | `guildId` | global standings slice, member distribution, active challenges + scores |
| `GET /api/admin/referrals` | `guildId` | referral stats for guild + recruiter snippets |
| `GET /api/admin/automation` | `guildId` | system config automation-related fields + scheduled/recurring summary |
| `GET /api/admin/roles` | `guildId` | manager, auto, roleRewards |
| `GET /api/admin/audit` | `guildId`, optional `targetUserId`, `actorUserId`, `from`, `to` | paginated adjustments + summary blocks |

**Pagination:** `limit` (default 50, max 100), `cursor` optional for Phase 2.1.

### 5.2 POST endpoints (mutations)

All POST bodies include **`guildId`**** and **`actorUserId`**** from session only** (ignore client-supplied actor).

| Route | Body (minimal) | Server must |
|-------|----------------|-------------|
| `POST /api/admin/games/end` | `{ guildId, kind: 'active'\|'scheduled'\|'recurring', id }` | Verify admin; invoke same logic as Discord endgame paths. |
| `POST /api/admin/economy/adjust` | `{ guildId, targetUserId, amount, reason }` | Validate bounds; `addManualPointAdjustment`; log reason (console + future DB). |
| `POST /api/admin/economy/wipe` | `{ guildId, confirmationToken }` | Match confirmation; wipe + refresh leaderboard. |
| `POST /api/admin/factions/challenge` | sub-action: `create` \| `end` + payload | Delegate to faction challenge service used by slash. |
| `POST /api/admin/automation/update` | `{ guildId, patch }` whitelisted keys | Map to discrete handlers (channel id, booleans). |
| `POST /api/admin/roles/update` | `{ guildId, action, ... }` | Map to role commands logic. |

**Idempotency:** Return 409 with clear message if resource already ended/deleted.

**Rate limits:** Stricter per user than public APIs (e.g. 60/min for POST).

---

## 6. Security and safety

- **Every** `/api/admin/*` handler: resolve session → Discord user id → verify §2.1 → verify **guildId** access.  
- **Developer-only** routes (optional global stats): explicit `DEVELOPER_ID` check.  
- **No** exposure of `DISCORD_TOKEN`, `MONGO_URI`, or other users’ data across guilds.  
- **Adjust points:** Always `addManualPointAdjustment`; never `addScore` for admin UI.  
- **Wipe leaderboard:** Irreversible for that guild’s point counters — require **typed confirmation**.  
- **Role actions:** Respect Discord API errors; do not retry blindly.  
- **Audit:** All successful POST mutations log structured line (guild, actor, action, ids) for ops.

---

## 7. Architecture constraints (from current bot code)

### 7.1 Same process as bot (strongly recommended for Phase 2)

The following rely on **in-memory** `state.scheduledGames` and game **Maps** (`activeGiveaways`, `activeSprints`, etc.):

- Cancelling **scheduled** games with live timeouts.  
- Ending some **active** games consistently with Discord flows.

**Recommendation:** Mount admin API on the **same Node process** as the Discord client so handlers can call `scheduleGame` / `clearTimeout` / `endActiveGame` / game module `forceEnd` with the same `client` and `state` references.

If the API must live on another service, specify an **internal queue** (Redis, HTTP to bot sidecar) for mutations — out of scope for “minimal Phase 2” unless required by hosting.

### 7.2 Active games visibility gap

Some sessions exist primarily in memory until persisted. **Overview/Games** should merge **DB active games** with **best-effort** in-memory enumeration for the selected `guildId` (expose a small `listActiveGamesForGuild(guildId)` helper in bot code).

---

## 8. UX requirements (checklist)

- [ ] Public landing unchanged for anonymous users.  
- [ ] **Open Admin Panel** only for eligible users.  
- [ ] Guild selector always visible in admin shell.  
- [ ] Tabs/sections load independently where possible (lazy fetch per tab).  
- [ ] Compact tables/cards; truncate long text (announcement body, reasons).  
- [ ] Confirm dialogs for POST actions.  
- [ ] Inline error messages from API (`4xx`/`5xx` body `message`).  
- [ ] Empty states per subsection.  

---

## 9. Phased delivery within Phase 2 (recommended)

**2A — Read-only ship**

- Eligibility + guild selector + all **GET** routes + UI tabs populated.  
- No POST except optional **adjust** if time permits.

**2B — Safe actions**

- `games/end` (active + scheduled + recurring delete).  
- `economy/adjust` with full validation.  
- Automation toggles and channel set.

**2C — Higher risk**

- `economy/wipe`.  
- Faction challenge create/end from API.  
- Role mutations.

**2D — Audit polish**

- Filters, top actors/targets, 30d summaries.  
- Schema: persist **adjustment reason** in DB for compliance.

---

## 10. Traceability to existing slash commands

| Area | Primary commands / modules |
|------|----------------------------|
| Games | `/endgame`, `endgame_select`, `lib/db.js` `endActiveGame`, `createActiveGame`, `src/bot/schedule.js`, game `forceEnd` modules |
| Economy | `/adjustpoints`, `addManualPointAdjustment`, `/wipe_leaderboard` |
| Factions | `/faction_challenge`, `lib/factionChallenge.js` |
| Referrals | `lib/referrals.js`, `ReferralProfile`, `ReferralFirstGamePayout`, `SystemConfig` referral fields |
| Automation | `/set_announcement_channel`, `/set_announce_everyone`, `/set_automated_posts`, `/schedule_announcement` |
| Roles | `/set_manager_role`, `/set_auto_role`, `/remove_auto_role`, `/sync_auto_role`, `/strip_role`, `/set_role_reward` |
| Audit | Aggregate `User.pointLedger`; console logs for adjust today |

---

## 11. Non-goals (Phase 2)

- Full Discord permission editor or channel management beyond listed fields.  
- User impersonation or token management.  
- Building a replacement for Discord Audit Log.  
- Real-time WebSocket dashboards (polling 30–60s is enough).  

---

*Document version: 1.0 — aligned with `discord-bot-games` behavior (scheduled games, endgame, adjustpoints, wipe, faction challenge, referrals) as of spec date.*
