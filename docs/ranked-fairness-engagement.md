# Ranked fairness & the engagement layer

This note summarizes how PlayBound’s missions, featured rotation, and war phases stay consistent with **official ranked faction war** rules.

## What still defines “official” war credit

- Only **ranked-eligible `/playgame` platform tags** can add to the war ledger on **ranked** challenges. Hosted slash games and non-ranked platform tags remain excluded by `evaluateFactionWarCreditEligibility` and friends (`lib/gameClassification.js`).
- **Personal economy multipliers** (Premium, streak, host aura, double-points pass, consumables) apply only to **Credits** in `addScore`. The value passed into `recordFactionChallengePoints` is **`factionChallengeBasePoints`**: the **capped mini-game base** (see `lib/gamePlatform/scoring.js` + `lib/db.js`).
- **Casual featured bonus** (`featuredTag` + `featuredCasualBonusPct`) is **not** applied during war sessions (`isWarSession`), so it never enters the war ledger.

## Optional ranked featured bonus (capped, base-only)

- When a player is enrolled in an active war (`isWarSession`), **`rankedFeaturedTags`** (from `GamePlatformDay`, 1–2 deterministic picks from `featuredEligible` + `rankedEligible` tags) can add a **small extra** to the **base** sent to the war ledger.
- The bonus is **`floor(10% × base)`** capped by **`rankedFeaturedWarBonusCap`** on `GamePlatformSettings` (default **3**). It is logged as `[ranked-featured-war-bonus]` via `playboundDebugLog`.

## Ledger, prep, and final hour

- Each credited war award appends one row to **`warPointLedger`**: `at`, `userId`, `gameTag`, **`counted`** (post–per-tag cap), **`raw`** (session base before cap).
- During **`prep`**, `recordFactionChallengePoints` returns **`PREP_WINDOW`** — no ledger rows, no `scoresByUser` changes.
- If **`finalHourMode` ≠ `none`** and the ledger is non-empty, **`computeTeamValues`** uses a **deterministic split**:
  - **Pre–final-hour** slice: ledger rows with `at < finalHourStartsAt`, aggregated with the challenge’s normal `scoringMode` / `topN`.
  - **Final-hour** slice: rows with `at ≥ finalHourStartsAt`, then **`top5_only`**, **`weighted_top5`**, or **`featured_only`** (only tags in `warFeaturedTags`) as implemented in `lib/engagement/warScoring.js`.
- Team value is **`preAggregate + fhAggregate`** so earlier work still matters; the final-hour rule only changes how the **last window** is aggregated.

## Missions & seasons

- Mission rewards are **Credits**, **season XP**, or **cosmetic currency** only (`MissionDefinition` / `EngagementProfile`). They do **not** write uncapped war score.
- Mission progress for platform games uses **`missionEligible`** from `GAME_REGISTRY` unless a definition sets **`allowBroaderPool`** (default missions stay ranked-pool-only).

## Duel rating

- Trivia duel outcomes update **`DuelProfile`** (wins/losses/streak/Elo). This is **separate** from faction war score; war credit still flows only through the platform **base** pipeline above.

## Single source of truth

- **`GAME_REGISTRY`** (plus DB overrides via `mergeGameWithOverrides`) defines **`rankedEligible`**, **`missionEligible`**, **`featuredEligible`**, **`duelEligible`**, **`seasonalPoolEligible`**, and war-scoring flags. Admin previews: `/engagement_admin ranked_tags` and related subcommands.
