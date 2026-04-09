# Requirements Document

## Introduction

This feature extends the PlayBound Discord bot with two related capabilities: (1) support for multiple concurrent faction wars within a single guild, and (2) automatic creation and management of faction-specific Discord roles and private channels. Currently, a guild can only run one active faction challenge at a time. The new behavior allows multiple wars to run simultaneously as long as each involves different factions. Additionally, when a user joins a faction, the bot automatically provisions a Discord role and a private channel for that faction, replacing the current manual `faction_role_link` workflow.

## Glossary

- **Bot**: The PlayBound Discord bot application
- **Guild**: A Discord server where the Bot is installed
- **Faction**: One of the six global factions defined in GLOBAL_FACTION_KEYS (Phoenixes, Unicorns, Fireflies, Dragons, Wolves, Eagles)
- **War**: A faction challenge (FactionChallenge document) with status `active` — either a duel (two factions) or a royale (three or more factions)
- **Faction_Role**: A Discord role automatically created and managed by the Bot for a specific Faction in a Guild (e.g., UNICORNS_MEMBER)
- **Faction_Channel**: A private Discord text channel accessible only to members with the corresponding Faction_Role
- **Scoring_Pipeline**: The code path from `awardPlatformGameScore` through `addScore` to `recordFactionChallengePoints` that credits war points
- **Challenge_Lookup**: The process of finding the correct active FactionChallenge document for a given user based on their faction membership
- **SystemConfig**: The per-guild configuration document storing channel IDs, role maps, and feature settings

## Requirements

### Requirement 1: Concurrent War Creation

**User Story:** As a server admin, I want to create multiple faction wars at the same time, so that more factions can compete simultaneously without waiting for an existing war to finish.

#### Acceptance Criteria

1. WHEN a user runs `/faction_challenge create` and no active War exists involving any of the specified factions, THE Bot SHALL create a new FactionChallenge document and start the War
2. WHEN a user runs `/faction_challenge create` and an active War already involves one or more of the specified factions, THE Bot SHALL reject the command with a message identifying the conflicting factions and the existing War's end time
3. WHEN multiple Wars are active in the same Guild, THE Bot SHALL maintain independent participant rosters, score maps, and end times for each War
4. THE Bot SHALL enforce that each Faction appears in at most one active War per Guild at any given time

### Requirement 2: Faction-Aware Challenge Lookup

**User Story:** As a player, I want the bot to automatically find the war my faction is in, so that I do not have to specify which war I mean when joining or checking status.

#### Acceptance Criteria

1. WHEN a user runs `/faction_challenge join`, THE Challenge_Lookup SHALL find the active War that includes the user's Faction and enroll the user in that War
2. IF no active War includes the user's Faction, THEN THE Bot SHALL reply with a message stating no active war exists for the user's Faction
3. IF the user has no Faction, THEN THE Bot SHALL reply with a message directing the user to join a Faction first
4. THE Challenge_Lookup SHALL return the correct War for a user's Faction when multiple Wars are active in the same Guild

### Requirement 3: Concurrent War Status Display

**User Story:** As a player, I want to see the status of the war my faction is in, and optionally see all active wars, so that I can track competition across the server.

#### Acceptance Criteria

1. WHEN a user runs `/faction_challenge status` and the user belongs to a Faction in an active War, THE Bot SHALL display the status of that specific War
2. WHEN a user runs `/faction_challenge status` and the user's Faction is not in any active War, THE Bot SHALL display a summary of all active Wars in the Guild
3. WHEN a user runs `/faction_challenge status all`, THE Bot SHALL display a summary of all active Wars in the Guild regardless of the user's Faction membership

### Requirement 4: Targeted War Ending

**User Story:** As a server admin, I want to end a specific war or all wars, so that I have control over which competitions conclude.

#### Acceptance Criteria

1. WHEN a user runs `/faction_challenge end` without specifying a faction, THE Bot SHALL end the War that includes the user's Faction
2. WHEN a user runs `/faction_challenge end` with a faction argument, THE Bot SHALL end the War that includes the specified Faction
3. WHEN a user runs `/faction_challenge end all`, THE Bot SHALL end all active Wars in the Guild
4. IF the specified Faction is not in any active War, THEN THE Bot SHALL reply with a message stating no active war exists for that Faction
5. WHEN a War ends, THE Bot SHALL apply global totals, grant victory roles, and process economy payouts for that specific War independently of other active Wars

### Requirement 5: Concurrent War Scoring

**User Story:** As a player, I want my game scores to credit the correct war for my faction, so that points go to the right competition.

#### Acceptance Criteria

1. WHEN `recordFactionChallengePoints` is called, THE Scoring_Pipeline SHALL find the active War that includes the user's Faction and credit points to that War
2. WHEN multiple Wars are active, THE Scoring_Pipeline SHALL credit points only to the War matching the user's Faction
3. IF the user's Faction is not in any active War, THEN THE Scoring_Pipeline SHALL return a `NO_ACTIVE_CHALLENGE` result
4. WHEN `isUserEnrolledInActiveFactionChallenge` is called, THE Bot SHALL check enrollment across all active Wars for the user's Faction
5. WHEN a War reaches its point cap, THE Bot SHALL finalize only that War and leave other active Wars running

### Requirement 6: Concurrent War Expiration

**User Story:** As a server operator, I want each war to expire independently based on its own end time, so that wars with different durations coexist correctly.

#### Acceptance Criteria

1. WHEN `expireStaleChallenges` runs, THE Bot SHALL independently expire each War whose `endAt` has passed
2. WHEN one War expires, THE Bot SHALL process its global totals, victory roles, and economy payouts without affecting other active Wars
3. THE Bot SHALL correctly pick a winner for each expired War using that War's own participant rosters and score maps

### Requirement 7: Automatic Faction Role Provisioning

**User Story:** As a player, I want to automatically receive a faction-specific Discord role when I join a faction, so that I get access to my faction's private channel without manual admin setup.

#### Acceptance Criteria

1. WHEN a user joins a Faction via `/faction join`, THE Bot SHALL check if a Faction_Role for that Faction exists in the Guild
2. IF the Faction_Role does not exist, THEN THE Bot SHALL create a Discord role named `{FACTION_NAME}_MEMBER` (e.g., `UNICORNS_MEMBER`)
3. WHEN the Faction_Role exists or has been created, THE Bot SHALL assign the Faction_Role to the user
4. WHEN the Bot creates a Faction_Role, THE Bot SHALL store the role ID in the SystemConfig `factionRoleMap` for that Faction
5. IF the Bot lacks permission to create or assign roles, THEN THE Bot SHALL log the error and inform the user that automatic role assignment failed

### Requirement 8: Automatic Faction Channel Provisioning

**User Story:** As a player, I want a private faction channel to exist automatically when I join a faction, so that my faction can communicate privately without admin intervention.

#### Acceptance Criteria

1. WHEN a user joins a Faction and no Faction_Channel exists for that Faction in the Guild, THE Bot SHALL create a private text channel named `{faction-name}-hq` (e.g., `unicorns-hq`)
2. THE Bot SHALL configure the Faction_Channel so that only members with the corresponding Faction_Role and the Bot can view and send messages
3. WHEN the Faction_Channel already exists, THE Bot SHALL not create a duplicate channel
4. WHEN the Bot creates a Faction_Channel, THE Bot SHALL store the channel ID in the SystemConfig for that Faction
5. IF the Bot lacks permission to create channels, THEN THE Bot SHALL log the error and inform the user that automatic channel creation failed

### Requirement 9: Faction Channel War Alerts

**User Story:** As a faction member, I want my faction's private channel to receive alerts when a war involving my faction starts, so that my team is notified directly.

#### Acceptance Criteria

1. WHEN a War is created, THE Bot SHALL send a war announcement embed to the Faction_Channel of each participating Faction
2. WHEN a Faction_Channel does not exist for a participating Faction, THE Bot SHALL fall back to the Guild's configured announcements channel for that Faction's alert
3. THE Bot SHALL continue to send the war announcement to the Guild's announcements channel in addition to the Faction_Channels

### Requirement 10: Faction Role Removal on Leave or Switch

**User Story:** As a player, I want my old faction role removed when I leave or switch factions, so that I lose access to the old faction's private channel automatically.

#### Acceptance Criteria

1. WHEN a user leaves a Faction via `/faction leave`, THE Bot SHALL remove the Faction_Role for that Faction from the user
2. WHEN a user switches Factions via `/faction switch` (Premium), THE Bot SHALL remove the old Faction_Role and assign the new Faction_Role to the user
3. WHEN a Faction_Role is removed from a user, THE user SHALL lose access to the corresponding Faction_Channel automatically via Discord's permission system
4. IF the Faction_Role for the new Faction does not exist during a switch, THEN THE Bot SHALL create the Faction_Role and Faction_Channel following the same provisioning rules as Requirement 7 and Requirement 8

### Requirement 11: User War Enrollment Constraint

**User Story:** As a system operator, I want each user limited to one active war at a time, so that scoring and participation remain unambiguous.

#### Acceptance Criteria

1. THE Bot SHALL enforce that a user can be enrolled in at most one active War at a time, determined by the user's current Faction
2. WHEN a user's Faction is already in an active War and the user runs `/faction_challenge join`, THE Challenge_Lookup SHALL enroll the user in that specific War
3. WHEN a user leaves a Faction while enrolled in a War, THE Bot SHALL remove the user from that War's roster via `removeUserFromFactionChallengeEnrollment`

### Requirement 12: Backward Compatibility with Existing Role Links

**User Story:** As a server admin who already configured faction roles manually, I want the automatic provisioning to respect my existing role mappings, so that my current setup is not disrupted.

#### Acceptance Criteria

1. WHEN a Faction already has a role ID in `SystemConfig.factionRoleMap`, THE Bot SHALL use the existing role instead of creating a new Faction_Role
2. THE `/faction_role_link` command SHALL continue to function, allowing admins to override the automatically created Faction_Role with a custom role
3. WHEN an admin uses `/faction_role_link` to set a custom role, THE Bot SHALL update `SystemConfig.factionRoleMap` and use the custom role for future join and switch operations
