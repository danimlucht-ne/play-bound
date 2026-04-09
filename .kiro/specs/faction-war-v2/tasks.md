# Implementation Plan: Faction War v2

## Overview

Layer v2 ranked war mechanics on top of the existing faction challenge system. Schema changes first, then core logic (validation, one-play enforcement, scoring, auto-end), then command handlers (create, join, end-blocking, playgame integration), then daily limits, results embed, and finally tests. All changes are additive — unranked/casual wars remain untouched.

## Tasks

- [x] 1. Schema extensions and model changes
  - [x] 1.1 Add v2 fields to FactionChallengeSchema in `models.js`
    - Add `warVersion` (Number, default 1)
    - Add `warGames` ([String], default [])
    - Add `completedGamesByUser` (Map of [String], default empty Map)
    - Add `warDurationMinutes` (Number, default 30)
    - Add `channelId` (String, default null) for results embed posting
    - All fields must have defaults so existing v1 documents remain valid
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 15.3_

  - [x] 1.2 Add `dailyPlaygameSessions` field to UserSchema in `models.js`
    - Add `dailyPlaygameSessions` (Map of Number, default empty Map)
    - Keys are UTC date strings (YYYY-MM-DD), values are session counts
    - _Requirements: 13.1_

  - [ ]* 1.3 Write property tests for schema defaults (Property 4 subset)
    - **Property 4: One-play-per-game enforcement (completedGamesByUser subset invariant)**
    - Verify that `completedGamesByUser` for any user is always a subset of `warGames`
    - **Validates: Requirements 16.3, 7.3**

- [x] 2. Daily war cap and faction concurrency logic
  - [x] 2.1 Update daily war cap from 3 to 6 in `lib/factionChallengeDailyLimits.js`
    - Add exported constant `DAILY_FACTION_CHALLENGE_CAP = 6`
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 2.2 Add faction concurrency check in `lib/factionChallenge.js`
    - Implement `checkFactionOverlap(guildId, factionNames)` that queries active/scheduled wars and returns conflict info when any faction in the selection is already in an active war
    - Export the new function
    - _Requirements: 3.2, 3.3, 12.1, 12.2_

  - [ ]* 2.3 Write property test for faction concurrency (Property 3)
    - **Property 3: Faction concurrency enforcement**
    - For any two faction sets A and B, creation succeeds iff intersection is empty
    - Use fast-check to generate random faction set pairs from the 6 global factions
    - **Validates: Requirements 3.2, 3.3, 12.1, 12.2**

- [x] 3. War creation validation and ranked war parameter changes
  - [x] 3.1 Update `validateChallengeCreateParams` in `lib/rankedFactionWar.js` to skip roster cap requirement for v2
    - Accept a `warVersion` parameter; when `warVersion === 2`, do not require `maxPerTeam`
    - _Requirements: 5.1, 5.3_

  - [x] 3.2 Add v2 war creation validation functions in `lib/rankedFactionWar.js`
    - `validateV2FactionSelection(factions)` — accepts 2–6 from GLOBAL_FACTION_KEYS, rejects duplicates, returns errors
    - `validateV2GameSelection(gameTags, settings)` — accepts 1–3 tags, each must be rankedEligible + warScoringEligible, returns errors
    - Export both functions
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 3.3 Write property test for faction count validation (Property 1)
    - **Property 1: Faction count validation**
    - Generate random subsets of GLOBAL_FACTION_KEYS, verify acceptance iff size 2–6
    - **Validates: Requirements 1.1, 1.4**

  - [ ]* 3.4 Write property test for game selection validation (Property 2)
    - **Property 2: Game selection validation**
    - Generate random subsets of PLATFORM_GAME_TAGS + ineligible tags, verify acceptance rules
    - **Validates: Requirements 1.2, 1.3, 1.5**

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. One-play-per-game enforcement and war scoring
  - [x] 5.1 Add `checkWarGameCompletion` function in `lib/factionChallenge.js`
    - Given guildId, userId, gameTag: find active v2 war, check if user already completed that game
    - Return `{ blocked, message, warChallenge }` — blocked if game already in completedGamesByUser
    - Export the function
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 5.2 Update `recordFactionChallengePoints` in `lib/factionChallenge.js` for v2 wars
    - For v2 wars: track game completion in `completedGamesByUser` after scoring
    - For v2 wars: enforce `sessionCapFaction` from game registry as the per-game cap on base points credited to war ledger
    - Ensure only base points (no multipliers) are credited to the war ledger (existing behavior — verify)
    - _Requirements: 9.1, 9.2, 9.3, 7.3, 16.3_

  - [ ]* 5.3 Write property test for one-play-per-game enforcement (Property 4)
    - **Property 4: One-play-per-game enforcement**
    - Generate random play sequences against a v2 war, verify blocking and tracking
    - **Validates: Requirements 7.1, 7.2, 7.3, 16.3**

  - [ ]* 5.4 Write property test for base-points-only war scoring (Property 5)
    - **Property 5: Base-points-only war scoring with session cap**
    - Generate random sessions with various multiplier states, verify war ledger only gets min(basePoints, sessionCapFaction)
    - **Validates: Requirements 9.1, 9.2, 9.3**

- [x] 6. Top-5 average scoring and winner determination
  - [x] 6.1 Verify and update `computeTeamValues` / `pickChallengeWinner` in `lib/factionChallenge.js`
    - Ensure top-5 average logic handles fewer than 5 participants (average only those with scores > 0)
    - Ensure match points: win = +3, tie = +1, loss = +0 in `buildEndgameGlobalMergePayload`
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 6.2 Write property test for top-5 average and winner determination (Property 6)
    - **Property 6: Top-5 average faction scoring and winner determination**
    - Generate random score distributions per faction, verify average and winner
    - **Validates: Requirements 10.1, 10.2, 10.3**

- [x] 7. Slash command registration and create handler
  - [x] 7.1 Update `/faction_challenge create` in `deploy-commands.js`
    - Add `faction_1` through `faction_6` string options (autocomplete from GLOBAL_FACTION_KEYS) for v2 ranked wars
    - Add `games` string option (comma-separated game tags, 1–3)
    - Keep existing `faction_a`/`faction_b` for backward compat with unranked duels
    - _Requirements: 1.1, 1.2_

  - [x] 7.2 Update create handler in `src/events/interactionCreate.js` for v2 ranked wars
    - When `challenge_mode` is ranked and ≥2 faction options provided: run v2 validation flow
    - Check daily war cap (6), validate factions (2–6), validate games (1–3, ranked+warScoring eligible), check faction concurrency
    - Ignore `max_per_team` for ranked v2 (no roster cap)
    - Set `warVersion: 2`, `warGames`, `warDurationMinutes: 30`, `channelId`, `endAt = now + 30min` (or + delay + 30min)
    - Schedule auto-end timer via setTimeout
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 3.1, 4.1, 4.2, 5.1, 5.3, 12.1_

- [x] 8. Join handler with ephemeral briefing and permission check
  - [x] 8.1 Update join handler in `src/events/interactionCreate.js` for v2 wars
    - Verify user's faction is in the war's faction list
    - Verify user has `/playgame` command permission (check channel permissions)
    - No roster cap check for v2 ranked wars
    - Send ephemeral briefing: game list with display names, brief rules, time remaining, `/playgame` instructions
    - _Requirements: 6.1, 6.2, 6.3, 14.1, 14.2, 5.2_

- [x] 9. Block manual end for v2 ranked wars and auto-end logic
  - [x] 9.1 Block `/faction_challenge end` for v2 ranked wars in `src/events/interactionCreate.js`
    - If active war is v2 ranked, reject manual end with message about 30-minute auto-end
    - _Requirements: 2.3_

  - [x] 9.2 Implement auto-end and results posting in `lib/factionChallenge.js`
    - Update `expireStaleChallenges` to call `postWarResultsEmbed` for v2 wars that just ended
    - Add bot restart recovery: re-schedule timers for active v2 wars, post results for any that ended while bot was down
    - _Requirements: 2.2, 2.4_

  - [x] 9.3 Implement `postWarResultsEmbed` in `lib/factionChallenge.js`
    - Build Discord embed with: all participants ranked by score, top 5 per faction highlighted, faction scores (top-5 avg), winner announcement with match points
    - Handle tie display (+1 each)
    - Post to the channel stored in `channelId`
    - _Requirements: 11.1, 11.2, 11.3_

- [x] 10. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. `/playgame` integration: war game check, replay blocking, and between-game feedback
  - [x] 11.1 Add war game completion check to `games/platformPlay.js`
    - Before launching a `/playgame` session, call `checkWarGameCompletion`
    - If blocked (already played that game in war), return ephemeral error with remaining games list
    - _Requirements: 7.1, 7.2_

  - [x] 11.2 Add between-game score feedback in `games/platformPlay.js`
    - After `finishSession` for a v2 war participant: send ephemeral message with base points scored, cumulative war score, remaining unplayed games count
    - When all games complete: show total score and rank among all participants
    - _Requirements: 8.1, 8.2_

  - [ ]* 11.3 Write property test for between-game feedback accuracy (Property 8)
    - **Property 8: Between-game score feedback accuracy**
    - Generate random war states, verify feedback values (base points, cumulative score, remaining count, rank)
    - **Validates: Requirements 8.1, 8.2**

- [x] 12. Daily `/playgame` limit outside wars
  - [x] 12.1 Implement `checkAndIncrementDailyPlaygame` in `lib/db.js`
    - War sessions exempt (don't count toward limit)
    - Non-war sessions: enforce 5 per user per UTC day per server
    - Return remaining count for display
    - Clean old date keys lazily
    - Export the function and `DAILY_PLAYGAME_LIMIT` constant
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 12.2 Wire daily limit check into `games/platformPlay.js`
    - Before launching session: determine if this is a war session (user enrolled in active v2 war for this game tag)
    - Call `checkAndIncrementDailyPlaygame`; block if limit reached
    - Display remaining plays in session start message for non-war sessions
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [ ]* 12.3 Write property test for daily playgame limit (Property 7)
    - **Property 7: Daily playgame limit with war exemption**
    - Generate random session sequences (war + non-war), verify counting and blocking
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4**

- [x] 13. Backward compatibility verification
  - [x] 13.1 Verify unranked wars are unaffected
    - Ensure v2 code paths only activate when `warVersion === 2` and `challengeMode === 'ranked'`
    - Unranked wars: no 30-min fixed duration, no one-play-per-game, no roster cap removal
    - Unranked wars: unlimited game sessions per participant per game tag
    - _Requirements: 15.1, 15.2, 15.3_

- [x] 14. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design (8 properties across 8 PBT sub-tasks)
- Unit tests validate specific examples and edge cases
- All code uses JavaScript (Node.js) matching the existing codebase
- fast-check is used for property-based tests
