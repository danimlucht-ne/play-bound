# PlayBound (Discord bot)

PlayBound is a **multi-server Discord bot** for community games, a **Credits** economy, **Arena score** (competitive ledger), **global factions**, **ranked and casual faction wars**, **referrals**, **Premium** perks, shops, scheduled content, and a companion **HTTP API** (Stripe webhooks, public stats, Discord OAuth session for the website).

---

## Contents

1. [Requirements](#requirements)
2. [Quick start](#quick-start)
3. [Scripts](#scripts)
4. [Architecture](#architecture)
5. [Environment variables](#environment-variables)
6. [Core product rules](#core-product-rules)
7. [HTTP API (summary)](#http-api-summary)
8. [Slash commands](#slash-commands)
9. [Permissions](#permissions)
10. [Premium (summary)](#premium-summary)
11. [Operations](#operations)
12. [Further reading](#further-reading)

---

## Requirements

- **Node.js** (LTS recommended)
- **MongoDB** (Atlas or self-hosted)
- **Discord application** with bot token and **application ID** (`CLIENT_ID`) for slash registration
- Optional: **Stripe** for Premium checkout webhooks; support-server env vars for `/ticket` and `/setup_panels`

---

## Quick start

1. `npm install`
2. Copy `.env.example` → `.env` and set at least `DISCORD_TOKEN`, `CLIENT_ID`, `MONGO_URI`.
3. Seed content: `node seed-expanded.js` and `node seed-shop.js` (and optionally `npm run build:seed-words` then re-run `seed-expanded` for a larger Serverdle word bank).
4. Register slash commands: **`npm run deploy:commands`** — **re-run whenever command names, descriptions, or options change** (Discord caches command metadata).
5. Start the bot: `npm start` (`node index.js`).

The process loads **Discord**, **MongoDB**, and an **Express** app (Stripe webhook + `/api/*` + optional static files via `PUBLIC_DIR`).

---

## Scripts

| Script | Purpose |
|--------|---------|
| `npm start` | Run the bot + HTTP server |
| `npm test` | Node test runner (`tests/**/*.test.js`) |
| `npm run deploy:commands` | Register/update global slash commands |
| `npm run check:syntax` | `node --check` on main entrypoints and libraries |
| `npm run build:seed-words` | Build Serverdle word bank file for seeds |
| `node scripts/regenerate-slash-readme.js` | Regenerate [Full slash command option reference](#full-slash-command-option-reference) from `deploy-commands.js` |
| `node scripts/generate-slash-readme-tables.js` | Print the same tables to stdout (for piping or review) |

---

## Architecture

| Area | Path (indicative) |
|------|-------------------|
| Entry | `index.js` — client, Mongo connect, schedule, HTTP listen |
| Interactions | `src/events/interactionCreate.js` — slash commands, buttons, modals |
| Messages | `src/events/messageCreate.js` |
| Lifecycle | `src/events/ready.js`, `src/events/guildEvents.js` |
| HTTP | `src/server/webhook.js` — Stripe, `/api/*` routers |
| Economy / config | `lib/db.js`, `models.js` |
| Faction wars | `lib/factionChallenge.js`, `lib/rankedFactionWar.js`, `lib/factionChallengeDailyLimits.js`, … |
| Platform mini-games | `games/platformPlay.js`, `lib/gamePlatform/*` |
| Referrals & onboarding | `lib/referrals.js`, `lib/onboardingService.js`, `lib/onboardingDiscord.js`, `lib/officialFactionJoin.js` |
| Slash definitions | `deploy-commands.js` (source of truth for **what** is registered) |

---

## Environment variables

Set these in `.env` (see `.env.example` for the full list and comments).

| Variable | Role |
|----------|------|
| `DISCORD_TOKEN` | Bot login |
| `CLIENT_ID` | Slash command registration |
| `MONGO_URI` | Database |
| `DEVELOPER_ID` | Restricts dev-only commands (`/broadcast`, `/admin_premium`, …) |
| `STRIPE_*`, `PAYMENT_PROVIDER` | Checkout + webhooks when using Stripe |
| `PORT` | HTTP server port (default commonly `3000`) |
| `PUBLIC_DIR` | Optional: serve static site (e.g. PlayBound marketing UI) from disk |
| Support server / channel IDs | For `/ticket`, `/setup_panels`, etc. |

---

## Core product rules

### Credits vs Arena score

- **Credits** (`points`, weekly/monthly counters): general economy — shop, dailies, most casual rewards. Explained in **`/help`**.
- **Arena score** (`competitivePoints`): competitive ledger from **tagged** minigames (see scoring helpers). Used for server boards and profile; distinct from **global faction match points** (below).

### Official Faction Rankings vs server activity

- **`/factions`**: **Official Faction Rankings** — **match points** from **ranked** faction wars (wins / ties / losses), not raw Credit grind.
- **`/leaderboard`**: **Server activity** in **this** guild (Manager/Admin to run); different from the global faction board.

### Faction wars (UTC cadence)

- Each server may run up to **2 duels** and **1 royale** per **UTC day** (see `lib/factionChallengeDailyLimits.js` and `/faction_challenge` replies).
- **`/faction_challenge create` / `create_royale`**: **Premium** plus **Administrator**, **Bot Manager**, or **Faction Leader** (where configured).
- Wars may be **ranked** (global match points) or **casual / unranked** (local only). Players must **`/faction_challenge join`** while a war is active to contribute; only **allowed game types** count.

### Platform mini-games (`/playgame`)

- Games follow a **daily UTC rotation** and config (`lib/gamePlatform/rotation.js`, `configStore`).
- Threads host button-based sessions; scores flow through **`awardPlatformGameScore`** / **`addScore`** with game tags. Featured-day bonuses are **casual** only (see in-bot copy).

### Referrals & onboarding

- Referral codes and payouts: **`lib/referrals.js`** (`/invite`, `/claim_referral`, first-game milestones, `/faction_recruit`, `/faction_redeem`). OAuth invite links do **not** reliably preserve query params; codes are authoritative after install.
- **Onboarding** (global per Discord user, stored on **`ReferralProfile`**): `/onboarding` with optional `skip` / `resume`; tracks faction join, first game, challenge intro, completion. The **website** uses `GET /api/me` → `onboarding` and `POST /api/me/onboarding` with the same logical steps.

---

## HTTP API (summary)

Mounted from `src/server/webhook.js` (exact paths live under `src/server/api/*`):

- **Discovery**: `GET /api` — JSON with `service: "playbound-api"` and a list of public `GET` paths (use this to confirm the running build is current; if it 404s, the host is not this router or is an old deploy).
- **Stripe**: `POST /webhook` (raw body) for subscription events.
- **Public**: e.g. `/api/public-config`, `/api/stats/global`, `/api/leaderboard/*`, `/api/games/today`, `/api/seasons/*` — used by [play-bound.com](https://play-bound.com).
- **Auth**: `/api/auth/*` — Discord OAuth for the site.
- **Session**: `/api/me`, `/api/me/onboarding` — logged-in user + onboarding state.
- **Admin** (session + role checks): `/api/admin/*` — adjustments, panel data.

CORS must allow your web origins if the browser calls the API.

---

## Slash commands

> Descriptions below are summaries. **Authoritative names and options** are in `deploy-commands.js`. Per-option tables (type, required, min/max, choices) are in [Full slash command option reference](#full-slash-command-option-reference) below; refresh that section with `node scripts/regenerate-slash-readme.js` after editing `deploy-commands.js`.

### Onboarding & help

- **`/onboarding`** — Short first-time tour (`skip`, `resume` booleans).
- **`/help`** — Bot guide embed.
- **`/support`**, **`/ticket`** — Support server / ticket thread.
- **`/premium`** — Premium benefits and checkout links.

### Profile & server activity boards

- **`/profile`** — Stats; optional user peek (**Premium**).
- **`/leaderboard`** — Server activity rankings (**Administrator** or **Bot Manager**).
- **`/leaderboard_history`** — Saved weekly/monthly snapshots.

### Economy & shop

- **`/daily`**, **`/pay`**, **`/shop`**, **`/buy`**, **`/inventory`**, **`/equip`**
- **`/server_shop_add`**, **`/server_shop_remove`** — Server shop items (**Premium** host tools; see command text for gates).

### Classic hosted games (usually Manager/Admin host unless member hosting is enabled)

- **`/trivia`**, **`/triviasprint`**, **`/startserverdle`**, **`/guessthenumber`**, **`/moviequotes`**, **`/namethattune`**, **`/spellingbee`**, **`/caption`**, **`/unscramble`**, **`/giveaway`**, **`/tournament`**
- Many support delayed start (`delay_hrs` / `delay_days`); several support **`repeat_hrs`** (**Premium** host) — see README Premium section and `interactionCreate` handlers.

### Platform rotation mini-games

- **`/playgame`** — Start a **thread** for today’s pool tag (see choices in deploy). Optional thread name.

### Duels

- **`/duel`** — 1v1 trivia stake duel.

### Global factions & wars

- **`/faction`** — `join`, `leave`, `switch` (**Premium**), `server`, stats, etc.
- **`/factions`**, **`/season`** — Global standings and seasonal info.
- **`/faction_challenge`** — `create`, `create_royale`, `join`, `status`, `end`, `history`, … (**create** / **end**: **Premium** + staff as per command).
- **`/faction_role_link`**, **`/faction_rename`**, **`/faction_emoji`**, **`/faction_balance`** — Setup and display overrides (staff-gated where noted).

### Growth

- **`/invite`**, **`/invites`**, **`/claim_referral`** (guild **Administrator** default), **`/invite_leaderboard`**
- **`/faction_recruit`**, **`/faction_redeem`**

### Server configuration & automation (Manager/Admin unless noted)

Channel and behavior setup, including:

- **`/set_announcement_channel`**, **`/set_announce_everyone`**, **`/set_automated_posts`**
- Welcome / birthday / achievement / leaderboard / story / faction nudge / victory role / faction leader & challenge defaults & ranked rules
- **`/set_manager_role`**, **`/set_member_game_hosts`**, **`/set_auto_role`**, **`/remove_auto_role`**, **`/sync_auto_role`** (**Premium**), **`/strip_role`** (**Premium**)
- **`/schedule_announcement`** (**Premium**)
- **`/add_redirect`** (**Premium**) / **`/remove_redirect`**
- **`/adjustpoints`**, **`/wipe_leaderboard`**, **`/endgame`**, **`/listgames`** (listgames: any member)
- **`/set_role_reward`**, **`/achievement`**
- **`/setup_panels`** (support server + env channels)

### Developer / admin only

- **`/broadcast`**, **`/admin_premium`**, **`/premium_analytics`**, **`/dev_points`** — `DEVELOPER_ID` (or as documented per command).
- **`/blacklist`**, **`/unblacklist`** — **Administrator** (or developer).

---

## Permissions

- **Default:** Most game starters and server config require **Administrator** or the **Bot Manager** role from **`/set_manager_role`**.
- **`/set_member_game_hosts`:** When enabled, **members** may start a **limited** set of games (`/giveaway`, `/guessthenumber`, `/playgame`, `/startserverdle`, `/trivia`, `/triviasprint`, `/namethattune`, `/spellingbee`, `/moviequotes`, `/caption`, `/unscramble`) without Manager/Admin — see `interactionCreate.js` (`MEMBER_HOSTABLE_GAME_COMMANDS`).
- **Faction challenges:** Creating/ending requires **Premium** plus staff (or **Faction Leader** where configured). **`/faction_challenge join`** and **`status`** are broadly available to eligible members.
- **Exact gates** change over time; **`deploy-commands.js`** descriptions and **`interactionCreate.js`** checks are authoritative.

---

## Premium (summary)

Premium is **per Discord user**, not per server. Highlights:

- **2×** multipliers on eligible score events, higher streak cap, better **`/daily`**, exclusive shop cosmetics, **host aura** and **Boost session** in threads, higher host caps on several games, **`repeat_hrs`** autopilot on supported games, many manager tools (`/schedule_announcement`, `/add_redirect`, `/strip_role`, `/sync_auto_role`, faction challenge **create**/**end**, …).

Full tables lived in older README revisions; the **code** enforces rules in `lib/premiumPerks.js`, `lib/db.js` (`addScore`), and command guards in **`interactionCreate.js`**.

---

## Operations

- **PM2 (example):** `npx pm2 start index.js --name playbound --update-env`
- **Database backups:** see `scripts/backup.sh` and comments in the previous README revision if you still use `mongodump`.
- **After pulling code:** `npm install` if deps changed, then **`npm run deploy:commands`** if `deploy-commands.js` changed.

---

## Further reading

- **Faction wars (detailed):** `docs/factioninstructions.md`
- **Marketing / web onboarding UI:** `lucht-applications/play-bound/README.md` (sibling path from this monorepo layout)

---

*Command and behavior drift: this file is maintained for orientation. When in doubt, read **`deploy-commands.js`** and the matching branch in **`src/events/interactionCreate.js`**. After changing slash definitions, run **`npm run docs:slash-readme`** (or `node scripts/regenerate-slash-readme.js`) so the option tables stay accurate.*
