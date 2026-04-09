# PlayBound single-page landing — product & technical specification

**UI repository:** `lucht_applications` (under the parent `Programming` folder; add to the workspace when implementing the front end).  
**Backend / data:** `discord-bot-games` (MongoDB models, Express in `src/server/webhook.js`, bot process).

This document is the **requirements spec** for extending the existing **single-screen, scrollable** PlayBound marketing + light-control surface. It maps each UI section to **data sources**, **API contracts**, **auth**, and **known gaps** in today’s schema.

---

## 1. Goals and non-goals

### Goals

- **Conversion:** Every section should answer “why install?” and drive **Add to Discord**.
- **Social proof:** Real or honestly labeled aggregates (leaderboards, usage stats).
- **Light admin trust:** Small audit snapshot for people who manage servers—not a full dashboard.
- **Single page:** One vertical scroll; **no client-side routing / multi-page nav**. Internal toggles (tabs) are allowed.

### Non-goals

- Full admin panel, filters, or CRUD in the web UI.
- Replacing Discord for authoritative moderation or audit trails.
- Building fraud investigation tooling in the browser (optional stub only).

---

## 2. Architecture overview

| Layer | Responsibility |
|--------|----------------|
| **Web app** (`lucht_applications`) | Static/SSR shell, Discord OAuth, calls JSON APIs, renders sections. |
| **API** (extend bot’s Express app) | Public cached aggregates; authenticated admin + “me” endpoints. |
| **MongoDB** | `User`, `Game`, `Faction`, `SystemConfig`, `ReferralProfile`, `ReferralFirstGamePayout`, etc. |
| **Discord REST** (server-side) | Resolve usernames for leaderboard rows; verify OAuth user + guild admin (optional enrichment). |

**Recommendation:** Mount new routes on the **same Express instance** as the Stripe webhook (`src/server/webhook.js`), or extract `createApiRouter()` shared by `index.js` startup. Use a **path prefix** e.g. `/api/` for all new JSON endpoints so `/webhook` and `/health` stay unchanged.

---

## 3. Authentication & session

### 3.1 Public endpoints

No auth required:

- `GET /api/stats/global`
- `GET /api/leaderboard/players`
- `GET /api/leaderboard/factions`
- `GET /api/leaderboard/recruiters`

Rate-limit per IP (stricter than static assets).

### 3.2 Authenticated “me” (growth section)

Required for **referral code**, **“You’ve invited X servers”**, and optional username display:

- User completes **Discord OAuth2** (Authorization Code + PKCE in browser; **client secret on server only**).
- Scopes minimum: `identify`. For **admin guild detection**, also `guilds` (or guilds.members.read if you later need precision—start with `guilds`).
- Server stores **session** (signed cookie or server-side session id); stores `discordUserId`, `accessToken` (encrypted/at rest policy TBD), `refreshToken` if using offline access.

Endpoints (examples):

- `GET /api/me/referral` — returns `{ referralCode, successfulServerCount, ... }` for `session.userId`.
- `POST /api/me/referral/copy` — optional analytics only; client can copy from `GET` payload.

### 3.3 Admin eligibility (Server Insights section)

Show **🔧 Server Insights** only if **either**:

1. **`userId === process.env.DEVELOPER_ID`** (same env as bot), or  
2. OAuth user has **Administrator** in **at least one guild** that the bot is in.

**Implementation note:** With only OAuth `guilds`, you get guild ids + permission bits; compare `permissions & 0x8` (Administrator) or `MANAGE_GUILD` if product prefers. Cross-check **bot shared guilds**: either cache `client.guilds.cache` keys in API process (requires sharing bot client with HTTP layer) or maintain a lightweight `BotGuildSnapshot` collection updated on `guildCreate`/`guildDelete`—**spec the approach in implementation**; simplest MVP is **in-process** access to the Discord client from the same Node process as the bot.

If admin check cannot be performed (no token, API error), **hide** the admin section (degrade gracefully).

---

## 4. Caching

| Endpoint group | TTL (suggested) | Invalidation |
|----------------|-----------------|--------------|
| `/api/stats/global` | 60–300 s | time-based |
| Leaderboards | 60–180 s | time-based |
| Admin recent/summary | 30–120 s | time-based or shorter if low traffic |

Use in-memory cache (per process) for MVP; document that **multi-instance** deploys need Redis later.

Response headers optional: `Cache-Control: public, max-age=60` for public aggregates.

---

## 5. Section-by-section requirements

### 5.1 Hero (existing — copy update)

**Content**

- Title: **PlayBound**
- Subtitle: **Turn your Discord into a full game night**
- Primary CTA: **Add to Discord** (OAuth install URL from env, e.g. `BOT_INVITE_URL` or built from `CLIENT_ID`)
- Secondary CTA: **Join Support Server** (`SUPPORT_SERVER_INVITE` or equivalent)

**Stat line (optional, if API returns data)**

- `Used in **X** servers` → map from `totalServers` (see §6.1).
- `**Y** games played` → map from `gamesPlayedAllTime` or rolling window (see §6.1—define which in API contract).

If stats missing or API fails, **omit the line** (no placeholders like “—”).

---

### 5.2 Quick stats bar (new)

**UI:** Horizontal strip (responsive wrap on small screens): four metrics.

| Label | Field | Source (see §6.1) |
|--------|--------|-------------------|
| Active games (24h) | `gamesLast24h` | `Game` |
| Total players (24h) | `playersLast24h` | See **data gap** |
| Total points (24h) | `pointsLast24h` | `User.pointLedger` aggregation |
| Total servers | `totalServers` | `SystemConfig` count |

**Empty state:** Show `0` or hide the bar if the whole `/api/stats/global` fails (product choice: prefer showing bar with “—” only on failed cells).

---

### 5.3 Feature cards (keep, cleanup)

Exactly **four** cards: **Games**, **Progression**, **Factions**, **Premium**.

Each: **one title**, **one short line**, optional icon. **No extra body copy.**

---

### 5.4 Leaderboards — “🏆 Live Leaderboards”

**UI:** Tab/toggle (plain buttons, same page): **Players** | **Factions** | **Recruiters**.

Default tab: **Players** or **Factions** (product pick; factions are always cheap to query).

**Limits:** Top **5** (spec allows up to 10 in API; UI shows 5).

#### 5.4a Players

- Columns: **username** (or “Unknown user” if unresolved), **points**, **streak** optional (`User.currentStreak` max across guilds or streak on primary row—see §6.2).
- Query: **global** sum of `points` grouped by `userId` (see §6.2).

#### 5.4b Factions

- Rows: **Dragons / Wolves / Eagles** (from `Faction` collection), **totalPoints**.
- Visually highlight rank 1 (badge, border, or subtle background).

#### 5.4c Recruiters

- Rows: top by **`ReferralProfile.referralSuccessfulCount`** (completed server referrals).
- Show **username** + **successful referrals** count.

**Degradation:** If a tab’s request fails, show one line: “Leaderboard temporarily unavailable.”

---

### 5.5 Admin / audit snapshot — “🔧 Server Insights”

**Visibility:** Only if §3.3 passes.

**NOT** a dashboard: fixed small widgets + one Discord CTA.

#### A) Recent adjustments (last 5)

- Fields: **target user** (display), **±points**, **reason** — **problem:** today’s `User.pointLedger` stores `{ at, amount, label }` where **`label` is `admin_adjust:<actorId>`**, not the human **reason** from `/adjustpoints` (reason is not persisted in schema).

**Requirement (data):** Either:

- **MVP:** Show **target**, **amount**, **date**, **actor id** from ledger entries where `label` matches `/^admin_adjust:/`, aggregated across `User` docs in guilds the viewer admins; **reason** omitted or “see Discord”, **or**
- **Preferred:** Extend `pointLedger` entries (or new `AdminAdjustment` collection) to persist **`reason`** and **`actorUserId`** on each admin adjust—then UI shows truncated reason (50 chars).

#### B) Adjustment summary (7d)

- **Total adjustments** (count of admin ledger events in window).
- **Net points added** (sum of amounts).
- **Distinct admins** (count unique actor ids parsed from `label`).

Scope: union of **guild ids** the user is admin in **and** bot is present.

#### C) Optional “⚠️ Suspicious activity”

**Current codebase:** No `fraudScore` or fraud model found.

**Spec:** If `GET /api/admin/fraud/summary` is not implemented, **omit** the indicator. If implemented later, show a single line + link to Discord workflow.

#### Interaction

- Button: **View full audit in Discord** → instructions: use **`/adjustment_history`** (or equivalent).

**Gap:** There is **no** `/adjustment_history` command in the repo today. **Deliverable:** add a **minimal admin slash** that lists recent admin adjustments per guild (or document CTA until shipped). The web spec depends on this for honest UX.

---

### 5.6 Example game night (keep)

Short visual flow: **Trivia → Music → Tournament** (formatting only).

---

### 5.7 Viral / growth — “🚀 Grow Your Server”

Bullets (short):

- Invite rewards  
- Faction recruiting  
- Global competition  

**Dynamic stat (optional):**  
`X servers joined this week via referrals`

**Heuristic (recommended):** Count `ReferralFirstGamePayout` documents with `createdAt >= now - 7d` (each doc = one guild that completed first qualifying referral payout). Label in UI: **“Servers completing referral milestones this week”** if you want to avoid implying “new installs” only.

**CTAs**

- **Invite bot** (same as hero primary).
- **Copy referral code** — requires §3.2; if not logged in, button opens **Log in with Discord** or tooltip “Log in to see your code.”

**Logged-in state**

- Show **referral code** (`ReferralProfile.referralCode`).
- Show **You’ve invited X servers** using `referralSuccessfulCount` (or length of `referralCompletedGuildIds`—align with product definition of “successful”).

---

### 5.8 Premium (keep, tighten)

Short bullets: **2× points**, **Boost sessions**, **Automation tools** (or exact strings from current UI).

Button **View Premium** → Stripe payment link or in-Discord upsell URL (env-driven).

---

### 5.9 Final CTA

- Headline: **Ready to start your game night?**
- Button: **Add PlayBound to Discord** (duplicate hero primary).

---

## 6. Backend: data mapping & aggregation notes

### 6.1 `GET /api/stats/global`

**Proposed JSON**

```json
{
  "totalServers": 0,
  "gamesLast24h": 0,
  "playersLast24h": 0,
  "pointsLast24h": 0,
  "gamesPlayedAllTime": 0
}
```

| Field | Proposed computation |
|--------|----------------------|
| `totalServers` | `SystemConfig.countDocuments({})` — guilds with config rows (proxy for “ever configured”). Optional refinement: intersect with bot guild ids. |
| `gamesLast24h` | `Game.countDocuments({ startTime: { $gte: since } })` **or** ended in window using `endTime`; pick one and document. |
| `gamesPlayedAllTime` | `Game.countDocuments({ status: 'ended' })` (may be heavy—cache aggressively). |
| `pointsLast24h` | Aggregate `User`: unwind `pointLedger`, match `at >= since`, sum `amount`. |
| `playersLast24h` | **Gap:** `User` has no `updatedAt` by default. **Options:** (a) approximate with distinct `userId` from **games started** in 24h (parse `Game.state` is fragile); (b) add **`lastActivityAt`** on `User` updated in `addScore` / key commands; (c) omit field until (b) ships. **Spec:** implement (b) for accuracy **or** return `null` with UI hiding the metric. |

---

### 6.2 `GET /api/leaderboard/players`

- Aggregate `User`: `$group` by `userId`, `totalPoints: { $sum: '$points' }`, `maxStreak: { $max: '$currentStreak' }`, sort, limit 5–10.
- Resolve usernames: `client.users.fetch(id)` batch with rate-limit awareness; cache 5–15 min.

**Response shape (example)**

```json
{
  "entries": [
    { "userId": "...", "username": "PlayerOne", "points": 12345, "streak": 7 }
  ],
  "cachedAt": "ISO8601"
}
```

---

### 6.3 `GET /api/leaderboard/factions`

- `Faction.find().sort({ totalPoints: -1 }).limit(10).lean()`
- Map to `{ name, emoji, totalPoints, rank }`.

---

### 6.4 `GET /api/leaderboard/recruiters`

- `ReferralProfile.find().sort({ referralSuccessfulCount: -1 }).limit(10).lean()`
- Attach usernames via Discord API.

---

### 6.5 `GET /api/admin/adjustments/recent`

- **Auth:** session required; §3.3.
- **Query:** For each admin guild id `g`, find `User` with `guildId: g`, unwind `pointLedger`, match `label` /^admin_adjust:/, sort by `at` desc, limit **5** globally across allowed guilds (or per-guild tabs—**out of scope**; MVP global 5).

**Response**

```json
{
  "entries": [
    {
      "at": "ISO8601",
      "guildId": "...",
      "targetUserId": "...",
      "targetUsername": "...",
      "amount": -50,
      "actorUserId": "...",
      "reason": null
    }
  ]
}
```

Populate `reason` when schema supports it.

---

### 6.6 `GET /api/admin/adjustments/summary`

- Window: `now - 7d`.
- Same filter as above; return `{ count, netPoints, distinctAdmins }`.

---

### 6.7 `GET /api/admin/fraud/summary` (optional)

- **Default:** `501 Not Implemented` or omit route until fraud signals exist.
- **Future:** document fields when a model exists.

---

## 7. Security checklist

- Never expose `DISCORD_TOKEN` or `MONGO_URI` to the browser.
- OAuth: use PKCE; validate `state`.
- Admin endpoints: always re-verify session server-side; never trust `guildId` from client for scope.
- Sanitize all user-generated strings in JSON responses for XSS when rendered in React/Vue.
- CORS: allow only the landing origin(s).

---

## 8. UX rules (acceptance)

- No long paragraphs; section headings + short lines + CTAs.
- Clear visual separation between sections (spacing, dividers, or cards).
- **Single scroll**; tabs only swap content in place.
- Loading: skeleton or compact spinner per section—not blocking entire page if possible.
- All new blocks **degrade gracefully** when APIs fail or user is logged out.

---

## 9. Implementation order (suggested)

1. Extract or extend Express router; add **`GET /api/stats/global`** + cache.  
2. Add **`GET /api/leaderboard/factions`** + **players** + **recruiters**.  
3. Wire **Quick stats** + **Leaderboards** in `lucht_applications`.  
4. Discord OAuth + **`GET /api/me/referral`** + **growth** section.  
5. Admin gating + **adjustment** aggregations; persist **reason** if product needs it.  
6. Add **`/adjustment_history`** (or rename) in bot for CTA parity.  
7. Optional: **`lastActivityAt`** on `User` for **playersLast24h**.  
8. Optional: fraud summary stub.

---

## 10. Open questions for product

1. **Hero “games played”:** all-time ended games vs last 7 days?  
2. **Players leaderboard:** global sum of `points` across guilds is the default; confirm no preference for “single home guild.”  
3. **Referral week stat:** OK to tie to `ReferralFirstGamePayout` counts vs marketing language “joined”?  
4. **Admin audit reason:** ship without reasons (MVP) or add schema change first?

---

## 11. Related specifications

- **Phase 2 (gated admin panel):** [PLAYBOUND_PHASE2_ADMIN_PANEL_SPEC.md](./PLAYBOUND_PHASE2_ADMIN_PANEL_SPEC.md)

---

*Document version: 1.0 — aligns with `discord-bot-games` models as of spec date.*
