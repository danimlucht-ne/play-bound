# Launch phase 2 — additions backlog

Short-term roadmap items to revisit after go-live. Not committed work; prioritize in your issue tracker.

---

## 1. Future games (keep engagement fresh)

### Already in the platform catalog

These exist in `lib/gamePlatform/registry.js` — value is in **rotation, `/help`, faction defaults, and war filters** so they feel seen: Risk Roll, Target 21, Dice Duel, King of the Hill, High Card Blitz, Push Luck Deck, Combo Builder, Five Card Draw, Reaction Rush, Closest Guess, Last Man Standing, Pattern Memory, Logic Grid Mini, Multi-step Trivia, Lie Detector, Vote the Winner, Sabotage Mode.

### Extensions (moderate product/engineering)

- **Speed ladder** — same mini, shorter timer, optional weekly board.
- **Team relay** — war scoring that weights contributions across enrolled members (rules on top of existing caps).
- **Blitz week** — featured tag + messaging (and optional economy multiplier), minimal code if config-driven.
- **Prediction / pick’em** — text-based picks for war or `/playgame` outcomes (social; can stay lightweight).
- **Boss raid** — server-wide score target over N days from platform games only.

### Hosted-style (larger lifts)

New thread-based experiences: extra word/phrase modes, richer music rounds, drawing/guess, one-prompt async party games.

**Guideline:** Prefer **one** new platform tag **or** one new hosted loop per quarter so `/playgame` and faction filters stay understandable.

---

## 2. Future shop items

Shop item `type` values today: `consumable`, `badge`, `color`, `role` (see `models.js` / `seed-shop.js` for patterns and pricing notes).

### Ideas

| Idea | Type | Notes |
|------|------|--------|
| Season contender / champion frame | `badge` or `consumable` | Tie to `seasonKey` or quarter in copy. |
| Faction pennant (per global faction) | `badge` | Use `leaderboardEmoji` for board flair. |
| Gradient / second accent | `color` or new field later | Today: single `profileColorHex`. |
| Reroll token (one extra `/playgame` pull) | `consumable` | Price high or Premium-gated if desired. |
| Guild celebration consumable | `consumable` | Flavor + sink. |
| Server-specific flair | via `/server_shop_add` | No deploy for one-off items. |

**Sinks:** stackable collectibles, mystery box follow-through (seed copy references a future inventory action).

**Roles:** map rare achievements to roles via `/set_role_reward` where the grant path supports it (see §3 on season bulk grants).

---

## 3. Seasons — what exists & how to incentivize

### Implemented (reference: `lib/factionSeasons.js`, `lib/achievements.js`, `models.js`)

- **Quarterly UTC seasons** (`Season` `type: 'quarter'`, e.g. `2026-Q1`). Stats accrue from **ranked** wars when global totals apply (`recordRankedWarSeasonStats`).
- **Automation:** `processSeasonBoundaries` (hourly) finalizes quarters past `endAt`.
- **Quarter rewards** (when `seasonRewardsEnabled()` — default on unless `SEASON_REWARDS_ENABLED=0`):
  - Winning **global faction:** `seasonQuarterWins`, `seasonHighlightLabel` / `seasonHighlightUntil` on `Faction`, achievement `SEASON_Q{n}_{year}_FACTION_CHAMP` for all members of that faction.
  - **#1 server (quarter):** achievement `SEASON_Q{n}_{year}_TOP_SERVER` for all users in that guild.
  - **Faction MVP (quarter):** one user on winning faction (highest max `competitivePoints` across guild rows): `SEASON_Q{n}_{year}_FACTION_MVP`.
- **Year-end (after Q4):** `finalizeYearSeason` — yearly faction champion, `seasonYearWins`, `SEASON_YEAR_{year}_FACTION_CHAMP`; server/MVP year achievements gated by `yearlySeasonRewardsEnabled()` (default on unless `YEARLY_SEASON_REWARDS_ENABLED=0`).
- **Env toggles:** `SEASON_AUTOMATION_ENABLED`, `SEASON_REWARDS_ENABLED`, `YEARLY_SEASON_REWARDS_ENABLED` (see `factionSeasons.js`).

**`rewardMeta` on `Season`:** audit/history metadata — not automatic Credits.

**Achievement display:** dynamic names/descriptions for season keys in `resolveSeasonAchievementMeta` (`achievements.js`).

**Note:** Bulk season grants use `User.updateMany` / `Faction.updateOne` — they do **not** go through `awardAchievement`, so **no automatic achievement-channel embed or role-from-`roleRewards`** for those keys unless you add a follow-up hook or grant manually.

### Incentivize players (near-term, mostly ops + small code)

| Approach | Effort |
|----------|--------|
| Announce quarter boundaries and prizes (Credits, Premium, shop codes) in Discord | Ops |
| Point players at **`/season`** and `/factions` highlights | Ops |
| Manual **`/achievement grant`** or Credit script for documented prizes | Ops |
| Wire finalize to **`awardAchievement`** or a shared helper so **`achievementChannel`** + **`roleRewards`** apply | Code |
| Optional **Credit** grant in `finalizeQuarterSeason` / `finalizeYearSeason` | Code |
| Limited-time **`/server_shop_add`** items per season | Ops |

---

## 4. Cross-links

| Topic | Location |
|--------|----------|
| Go-live runbook | `docs/GO_LIVE_CHECKLIST.md` |
| Shop seed / pricing anchor | `seed-shop.js` |
| Platform game definitions | `lib/gamePlatform/registry.js` |
| Season logic | `lib/factionSeasons.js` |
| Season achievement copy | `lib/achievements.js` → `resolveSeasonAchievementMeta` |

---

*Last updated: working doc for post-launch planning.*
