# Requirements Document — Faction War v2

## Introduction

Faction War v2 redesigns the ranked faction challenge system for the PlayBound Discord bot. The current system allows unlimited game grinding during wars with no time cap and uses roster caps that are unnecessary given top-5 averaging. This redesign transforms ranked wars into tight 30-minute tournament-style events where each player plays each selected game exactly once, scores are summed from base points only, and results are posted automatically when the timer expires. Unranked/casual wars retain the old behavior unchanged.

## Glossary

- **War_Host**: The Discord user who creates a faction war via `/faction_challenge create`.
- **War**: A single ranked faction challenge instance with a fixed 30-minute duration and 1–3 selected platform games.
- **Participant**: A Discord user who has joined an active War via `/faction_challenge join` and belongs to one of the competing factions.
- **War_Ledger**: The per-war data structure tracking each Participant's base-point scores per game tag.
- **Game_Tag**: A unique identifier for a platform mini-game (e.g., `risk_roll`, `multi_step_trivia`) as defined in the Game Registry.
- **Base_Points**: The raw point value awarded by a platform game session before any streak, premium, pass, or host-aura multipliers are applied.
- **Session_Cap_Faction**: The per-game maximum Base_Points a single session can contribute to the War_Ledger, as defined in each game's `balancingConfig.sessionCapFaction`.
- **Faction_Score**: The average of the top 5 Participants' total War scores for a given faction.
- **Match_Points**: Global standings currency awarded per War result: win = +3, tie = +1, loss = +0.
- **Daily_War_Cap**: The maximum number of Wars that can be created in a single server per UTC day (6).
- **Daily_Play_Limit**: The maximum number of `/playgame` sessions a user can start per UTC day per server outside of active Wars (5).
- **War_Timer**: The fixed 30-minute countdown that begins when a War transitions to active status.
- **Results_Embed**: The Discord embed posted in the originating channel when a War ends, showing all participant scores, top-5 highlights, faction averages, and the winner announcement.
- **Join_Briefing**: The ephemeral message sent to a Participant upon joining a War, listing available games, brief rules, time remaining, and instructions.
- **Game_Registry**: The canonical catalog of platform mini-games defined in `lib/gamePlatform/registry.js`.
- **FactionChallenge_Model**: The Mongoose schema for faction challenges defined in `models.js`.

## Requirements

### Requirement 1: War Creation with Multi-Faction and Multi-Game Selection

**User Story:** As a War_Host, I want to create a ranked war selecting 2–6 factions and 1–3 ranked-eligible platform games, so that wars support flexible faction combinations and curated game pools.

#### Acceptance Criteria

1. WHEN the War_Host invokes `/faction_challenge create` with a `challenge_mode` of `ranked`, THE War_Creation_Handler SHALL accept a faction selection of 2 to 6 factions from the 6 global factions (Phoenixes, Unicorns, Fireflies, Dragons, Wolves, Eagles).
2. WHEN the War_Host invokes `/faction_challenge create` with a `challenge_mode` of `ranked`, THE War_Creation_Handler SHALL accept a game selection of 1 to 3 Game_Tags where each tag has `rankedEligible: true` and `warScoringEligible: true` in the Game_Registry.
3. IF the War_Host selects a Game_Tag that is not ranked-eligible or not war-scoring-eligible, THEN THE War_Creation_Handler SHALL reject the creation and return a message identifying the ineligible game.
4. IF the War_Host selects fewer than 2 factions or more than 6 factions, THEN THE War_Creation_Handler SHALL reject the creation and return a message stating the valid faction count range.
5. IF the War_Host selects more than 3 games, THEN THE War_Creation_Handler SHALL reject the creation and return a message stating the maximum of 3 games per war.

### Requirement 2: Fixed 30-Minute War Duration with Auto-End

**User Story:** As a server member, I want ranked wars to have a fixed 30-minute duration that auto-ends, so that wars are tight tournament-style events with a clear endpoint.

#### Acceptance Criteria

1. WHEN a ranked War is created, THE War_Creation_Handler SHALL set the War_Timer to exactly 30 minutes from the moment the War becomes active.
2. WHEN the War_Timer reaches zero, THE War_Lifecycle_Manager SHALL set the War status to `ended`, record `endedAt`, compute the winner, and apply global standings updates.
3. WHILE a ranked War is active, THE War_Lifecycle_Manager SHALL reject any `/faction_challenge end` manual-end command for that War and return a message stating ranked wars end automatically after 30 minutes.
4. WHEN the War_Timer reaches zero, THE Command_Handler SHALL block any further `/playgame` sessions that would credit the ended War's War_Ledger.

### Requirement 3: Scheduled (Delayed) Wars with Overlap Prevention

**User Story:** As a War_Host, I want to schedule a war for a later time while preventing overlapping wars for the same factions, so that faction members are not split across concurrent wars.

#### Acceptance Criteria

1. WHEN the War_Host provides a `delay` parameter on `/faction_challenge create`, THE War_Creation_Handler SHALL schedule the War to become active after the specified delay.
2. IF a scheduled or active War already exists in the same server involving any overlapping faction from the new War's faction selection, THEN THE War_Creation_Handler SHALL reject the creation and return a message identifying the conflicting faction and existing War.
3. THE War_Creation_Handler SHALL allow simultaneous Wars in the same server when the faction selections have zero overlap (e.g., Dragons vs Wolves and Eagles vs Phoenixes at the same time).

### Requirement 4: Daily War Cap of 6 Per Server

**User Story:** As a server administrator, I want a daily cap of 6 wars per server per UTC day, so that war frequency is controlled while accommodating all 6 factions.

#### Acceptance Criteria

1. THE War_Creation_Handler SHALL enforce a maximum of 6 ranked Wars created per server per UTC day.
2. IF the server has already created 6 Wars in the current UTC day, THEN THE War_Creation_Handler SHALL reject the creation and return a message stating the daily limit has been reached.
3. WHEN a new UTC day begins (00:00 UTC), THE Daily_Limit_Tracker SHALL reset the war count for each server to zero.

### Requirement 5: Remove Roster Caps for Ranked Wars

**User Story:** As a faction member, I want to join any ranked war my faction is participating in without being blocked by a roster cap, so that participation is open to all faction members.

#### Acceptance Criteria

1. WHEN a ranked War is created, THE War_Creation_Handler SHALL not set or enforce a `maxPerTeam` roster cap.
2. WHILE a ranked War is active, THE Join_Handler SHALL allow any user whose faction is in the War's faction selection to join, regardless of how many members of that faction have already joined.
3. THE War_Creation_Handler SHALL ignore the `max_per_team` slash command option for ranked Wars and not store a `maxPerTeam` value on the FactionChallenge_Model document.

### Requirement 6: Player Join Flow with Ephemeral Briefing

**User Story:** As a Participant, I want to receive a briefing when I join a war listing the available games, rules, time remaining, and how to play, so that I understand the war format immediately.

#### Acceptance Criteria

1. WHEN a user invokes `/faction_challenge join` for an active ranked War, THE Join_Handler SHALL send an ephemeral message to the user containing: the list of Game_Tags selected for the War with display names, a brief rule summary for each game, the time remaining on the War_Timer, and instructions to use `/playgame` to play each listed game.
2. IF the user is not a member of any faction participating in the War, THEN THE Join_Handler SHALL reject the join and return a message stating the user's faction is not in this War.
3. IF the user does not have permission to use the `/playgame` command in the server, THEN THE Join_Handler SHALL reject the join and return a message explaining the user needs `/playgame` command permission to participate.

### Requirement 7: One Attempt Per Game Per Player Per War

**User Story:** As a Participant, I want to play each war game exactly once, so that wars test skill across games rather than rewarding grinding.

#### Acceptance Criteria

1. THE War_Session_Handler SHALL allow each Participant to complete exactly 1 session of each Game_Tag selected for the active ranked War.
2. IF a Participant attempts to start a `/playgame` session for a Game_Tag the Participant has already completed in the current War, THEN THE War_Session_Handler SHALL block the session and return a message stating the Participant has already played that game in this War.
3. THE War_Ledger SHALL track which Game_Tags each Participant has completed during the War.

### Requirement 8: Between-Game Score Feedback

**User Story:** As a Participant, I want to see my running score and remaining games after each game, so that I can track my progress during the war.

#### Acceptance Criteria

1. WHEN a Participant completes a game session during an active ranked War, THE Score_Feedback_Handler SHALL send the Participant a message containing: the Base_Points scored on the completed game, the Participant's cumulative War score, and the number of remaining unplayed games in the War.
2. WHEN a Participant completes all games in the War (or the War ends), THE Score_Feedback_Handler SHALL send the Participant a message containing: the Participant's total War score and the Participant's rank among all Participants in the War.

### Requirement 9: Base-Points-Only War Scoring

**User Story:** As a competitive player, I want war scoring to use only base game points without multipliers, so that wars are fair regardless of premium status or streaks.

#### Acceptance Criteria

1. WHEN a Participant completes a game session during an active ranked War, THE War_Scoring_Engine SHALL credit only the Base_Points value to the War_Ledger, excluding streak bonus, premium multiplier, double-points pass, host-aura multiplier, and featured bonus.
2. THE War_Scoring_Engine SHALL enforce the Session_Cap_Faction for each Game_Tag, capping the Base_Points credited to the War_Ledger at the `balancingConfig.sessionCapFaction` value defined in the Game_Registry for that game.
3. THE War_Scoring_Engine SHALL compute each Participant's total War score as the sum of Base_Points across all played Game_Tags in the War.

### Requirement 10: Faction Score Calculation (Top 5 Average)

**User Story:** As a faction leader, I want the faction score to be the average of the top 5 players' total scores, so that scoring rewards quality over quantity.

#### Acceptance Criteria

1. WHEN a ranked War ends, THE Faction_Score_Calculator SHALL compute each faction's Faction_Score as the arithmetic mean of the top 5 Participants' total War scores, sorted descending.
2. IF a faction has fewer than 5 Participants with scores greater than zero, THEN THE Faction_Score_Calculator SHALL average only those Participants who have scores greater than zero.
3. THE Faction_Score_Calculator SHALL determine the winner as the faction with the highest Faction_Score, awarding +3 Match_Points to the winner, +1 to each faction in a tie, and +0 to each losing faction.

### Requirement 11: War Results Embed

**User Story:** As a server member, I want to see a results embed in the channel when a war ends, so that everyone can see the outcome and individual performances.

#### Acceptance Criteria

1. WHEN a ranked War ends, THE Results_Embed_Builder SHALL post a Results_Embed in the channel where the War was created.
2. THE Results_Embed SHALL contain: all Participants ranked by total War score in descending order, the top 5 Participants per faction highlighted with their individual scores, the Faction_Score (top 5 average) for each participating faction, and the winner announcement with Match_Points awarded.
3. IF the War ends in a tie, THEN THE Results_Embed SHALL display the tie result and the +1 Match_Points awarded to each tied faction.

### Requirement 12: Faction Concurrency Enforcement

**User Story:** As a server administrator, I want to prevent a faction from being in two active wars simultaneously in the same server, so that faction members are not forced to split attention.

#### Acceptance Criteria

1. IF a War_Host attempts to create a War involving a faction that is already in an active or scheduled War in the same server, THEN THE War_Creation_Handler SHALL reject the creation and return a message identifying the conflicting faction and the existing War's end time.
2. THE War_Creation_Handler SHALL allow creation of a War involving factions that are not in any active or scheduled War in the same server, even if other factions in the same server have active Wars.

### Requirement 13: Daily /playgame Limit Outside Wars

**User Story:** As a server administrator, I want to limit casual `/playgame` usage to 5 sessions per user per UTC day per server outside of wars, so that leaderboard grinding is controlled while casual play remains available.

#### Acceptance Criteria

1. WHILE no active ranked War includes the user as a Participant for the game being played, THE Daily_Play_Limiter SHALL enforce a maximum of 5 `/playgame` sessions per user per UTC day per server.
2. IF a user has reached the Daily_Play_Limit, THEN THE Daily_Play_Limiter SHALL block the session and return a message stating the limit and when it resets (next UTC midnight).
3. WHEN a Participant plays a `/playgame` session that credits an active ranked War's War_Ledger, THE Daily_Play_Limiter SHALL not count that session toward the user's Daily_Play_Limit.
4. WHEN a user starts a `/playgame` session outside of a War context, THE Daily_Play_Limiter SHALL display the remaining daily plays (e.g., "You have 3/5 daily plays remaining").

### Requirement 14: Permission Check on War Enrollment

**User Story:** As a Participant, I want to be blocked from joining a war if I lack `/playgame` permissions, so that I am not enrolled in a war I cannot play.

#### Acceptance Criteria

1. WHEN a user invokes `/faction_challenge join`, THE Join_Handler SHALL verify the user has permission to use the `/playgame` command in the current server.
2. IF the user does not have `/playgame` command permission, THEN THE Join_Handler SHALL reject the join and return a message explaining the user needs `/playgame` permission to participate in faction wars.

### Requirement 15: Backward Compatibility for Unranked Wars

**User Story:** As a server administrator, I want unranked/casual wars to keep the old behavior, so that casual events are not affected by the v2 ranked war changes.

#### Acceptance Criteria

1. WHILE a War has `challengeMode` set to `unranked`, THE War_Lifecycle_Manager SHALL not enforce the 30-minute fixed duration, the one-play-per-game restriction, or the removal of roster caps.
2. WHILE a War has `challengeMode` set to `unranked`, THE War_Scoring_Engine SHALL allow unlimited game sessions per Participant per Game_Tag.
3. THE FactionChallenge_Model SHALL extend existing schema fields (adding new fields for v2 tracking) rather than replacing or removing existing fields, preserving backward compatibility with existing unranked challenge documents.

### Requirement 16: FactionChallenge Model Extensions

**User Story:** As a developer, I want the FactionChallenge model to track v2 war state (per-user game completions, war game list, war version) without breaking existing documents, so that the data layer supports the new war format.

#### Acceptance Criteria

1. THE FactionChallenge_Model SHALL include a `warVersion` field (Number, default `1`) to distinguish v1 and v2 war documents.
2. THE FactionChallenge_Model SHALL include a `warGames` field (array of String Game_Tags) storing the 1–3 games selected for a v2 ranked War.
3. THE FactionChallenge_Model SHALL include a `completedGamesByUser` field (Map of userId to array of Game_Tags) tracking which games each Participant has completed.
4. THE FactionChallenge_Model SHALL include a `warDurationMinutes` field (Number, default `30`) storing the fixed war duration for v2 ranked Wars.
5. THE FactionChallenge_Model SHALL default all new fields so that existing v1 documents remain valid and functional without migration.
