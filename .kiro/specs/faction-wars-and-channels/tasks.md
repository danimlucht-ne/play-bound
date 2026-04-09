# Implementation Plan: Faction Wars and Channels

## Overview

Extend the PlayBound Discord bot to support multiple concurrent faction wars per guild and automatic provisioning of faction-specific Discord roles and private channels. Implementation proceeds in layers: data model first, then lookup/scoring refactors, then provisioning, then command handler updates, then announcements, and finally wiring and integration.

## Tasks

- [x] 1. Add `factionChannelMap` to SystemConfig schema
  - Add `factionChannelMap: { type: FactionGuildSlotSchema, default: () => ({}) }` to `SystemSchema` in `models.js`, parallel to existing `factionRoleMap`
  - Add JSDoc comment: `/** Discord channel id per global faction (auto-provisioned private HQ). */`
  - _Requirements: 8.4_

- [x] 2. Implement faction-aware challenge lookup functions
  - [x] 2.1 Add `getActiveChallengeForFaction(guildId, factionName)` to `lib/factionChallenge.js`
    - Query `FactionChallenge.find({ guildId, status: 'active', endAt: { $gt: new Date() } })` then filter in-memory for the war whose `teamNames()` includes `factionName`
    - Return the matching document or `null`
    - _Requirements: 2.1, 2.4, 11.2_

  - [x] 2.2 Add `getAllActiveChallenges(guildId)` to `lib/factionChallenge.js`
    - Query `FactionChallenge.find({ guildId, status: 'active', endAt: { $gt: new Date() } })`
    - Return the array (may be empty)
    - _Requirements: 3.2, 3.3, 4.3_

  - [x] 2.3 Refactor `recordFactionChallengePoints` to use `getActiveChallengeForFaction`
    - Replace the current `FactionChallenge.findOne({ guildId, status: 'active', endAt: { $gt: new Date() } })` with a call that filters by the user's `factionName` using `getActiveChallengeForFaction`
    - Ensure points credit only the war containing the user's faction
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 2.4 Refactor `isUserEnrolledInActiveFactionChallenge` to use `getActiveChallengeForFaction`
    - Replace `getActiveChallenge(guildId)` with `getActiveChallengeForFaction(guildId, factionName)`
    - _Requirements: 5.4, 11.2_

  - [x] 2.5 Update `expireStaleChallenges` to handle multiple active wars
    - The existing query already returns all stale wars; verify the loop processes each independently (global totals, victory roles, economy payouts)
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 2.6 Export new functions and deprecate `getActiveChallenge`
    - Add `getActiveChallengeForFaction` and `getAllActiveChallenges` to `module.exports`
    - Add deprecation JSDoc to `getActiveChallenge`
    - _Requirements: 2.1, 3.3_

  - [ ]* 2.7 Write property test: Faction overlap determines war creation outcome (Property 1)
    - **Property 1: Faction overlap determines war creation outcome**
    - Generate random faction pairs and existing active wars; verify `checkFactionOverlap` succeeds iff no overlap
    - **Validates: Requirements 1.1, 1.2**

  - [ ]* 2.8 Write property test: Faction uniqueness invariant (Property 2)
    - **Property 2: Faction uniqueness invariant**
    - Generate random sequences of war creates; verify each faction appears in at most one active war
    - **Validates: Requirements 1.4, 11.1**

  - [ ]* 2.9 Write property test: Faction-aware lookup correctness (Property 3)
    - **Property 3: Faction-aware lookup correctness**
    - Generate multiple active wars with random factions; for random faction, verify `getActiveChallengeForFaction` returns correct war or null
    - **Validates: Requirements 2.1, 2.4, 5.4, 11.2**

  - [ ]* 2.10 Write property test: Scoring routes to the correct war (Property 4)
    - **Property 4: Scoring routes to the correct war**
    - Generate multiple wars with enrolled users; call scoring for random user; verify only correct war's scores change
    - **Validates: Requirements 5.1, 5.2**

  - [ ]* 2.11 Write property test: War isolation under mutation (Property 5)
    - **Property 5: War isolation under mutation**
    - Generate N wars; end one; verify others' status, rosters, and scores unchanged
    - **Validates: Requirements 1.3, 4.5, 6.2**

  - [ ]* 2.12 Write property test: Independent expiration by endAt (Property 6)
    - **Property 6: Independent expiration by endAt**
    - Generate wars with random endAt; run expiration at random time T; verify correct subset expires
    - **Validates: Requirements 6.1, 6.3**

- [x] 3. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create faction provisioning module
  - [x] 4.1 Create `lib/factionProvisioning.js` with `ensureFactionRole(guild, factionName, config)`
    - Check `config.factionRoleMap[factionName]` — if set, verify the role still exists in Discord (fetch); if deleted, clear the stale ID
    - If no role, create `{FACTION_NAME}_MEMBER` via `guild.roles.create`, persist to SystemConfig using `findOneAndUpdate` with condition slot is null (race-safe)
    - Return `{ roleId, created, error }` — catch Discord permission errors gracefully
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 4.2 Add `ensureFactionChannel(guild, factionName, config, roleId)` to `lib/factionProvisioning.js`
    - Check `config.factionChannelMap[factionName]` — if set, verify channel still exists; if deleted, clear stale ID
    - If no channel, create `{faction-name}-hq` with permission overwrites: deny `ViewChannel` for `@everyone`, allow `ViewChannel` + `SendMessages` for faction role and bot
    - Persist channel ID to SystemConfig `factionChannelMap` using `findOneAndUpdate`
    - Return `{ channelId, created, error }` — catch Discord permission errors gracefully
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 4.3 Write property test: Provisioning naming convention (Property 7)
    - **Property 7: Provisioning naming convention**
    - For each faction name in `GLOBAL_FACTION_KEYS`, verify role name is `{NAME}_MEMBER` and channel name is `{name}-hq`
    - **Validates: Requirements 7.2, 8.1**

  - [ ]* 4.4 Write property test: Provisioning idempotency and backward compatibility (Property 8)
    - **Property 8: Provisioning idempotency and backward compatibility**
    - Call `ensureFactionRole`/`ensureFactionChannel` twice; verify same ID returned, no duplicates; verify pre-existing `factionRoleMap` entries are respected
    - **Validates: Requirements 7.4, 8.3, 8.4, 12.1**

  - [ ]* 4.5 Write property test: Channel permission lockdown (Property 9)
    - **Property 9: Channel permission lockdown**
    - For any created faction channel, verify permission overwrites deny `@everyone` ViewChannel and allow faction role + bot
    - **Validates: Requirements 8.2**

- [x] 5. Integrate provisioning into faction join/leave/switch flows
  - [x] 5.1 Update `lib/officialFactionJoin.js` to call provisioning after `syncFactionMemberRoles`
    - After `syncFactionMemberRoles`, call `ensureFactionRole(guild, joinName, config)` then `ensureFactionChannel(guild, joinName, config, roleId)`
    - If provisioning returns errors, append a warning to the user's reply content (faction join still succeeds)
    - Re-fetch config after provisioning if role was newly created so `syncFactionMemberRoles` can assign it
    - _Requirements: 7.1, 7.3, 8.1, 8.4_

  - [x] 5.2 Update `/faction leave` handler in `src/events/interactionCreate.js`
    - Ensure `syncFactionMemberRoles(guild, userId, config, null)` removes the old faction role (already works via existing logic)
    - Verify user loses access to faction channel automatically via Discord permissions
    - _Requirements: 10.1, 10.3_

  - [x] 5.3 Update `/faction switch` handler in `src/events/interactionCreate.js`
    - After removing old faction role, call `ensureFactionRole` and `ensureFactionChannel` for the new faction
    - Assign new faction role to user
    - _Requirements: 10.2, 10.4_

  - [ ]* 5.4 Write unit tests for provisioning integration
    - Test `/faction join` triggers role + channel creation when none exist
    - Test `/faction join` reuses existing role when `factionRoleMap` already set
    - Test `/faction leave` removes role
    - Test `/faction switch` removes old role, provisions new role + channel
    - _Requirements: 7.1, 7.4, 10.1, 10.2, 10.4, 12.1_

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Update slash command definitions and command handlers
  - [x] 7.1 Update `deploy-commands.js` — add `all` option to `status` and `end` subcommands, add `faction` option to `end`
    - Add `.addBooleanOption(o => o.setName('all').setDescription('Show/end all active wars'))` to `status` and `end` subcommands
    - Add `.addStringOption(o => o.setName('faction').setDescription('End the war for this faction').addChoices(...FACTION_SLASH_CHOICES))` to `end` subcommand
    - _Requirements: 3.3, 4.1, 4.2, 4.3_

  - [x] 7.2 Update `faction_challenge create` handler in `src/events/interactionCreate.js`
    - Replace single-war rejection with `checkFactionOverlap(guildId, [factionA, factionB])` — reject only if specified factions overlap with an existing active war
    - On rejection, include conflicting factions and existing war's end time in the reply
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 7.3 Update `faction_challenge join` handler
    - Replace `getActiveChallenge(guildId)` with `getActiveChallengeForFaction(guildId, user.faction)`
    - If no war for user's faction, reply "No active war for your faction"
    - If user has no faction, reply directing them to `/faction join`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 7.4 Update `faction_challenge status` handler
    - Default (no `all` flag): use `getActiveChallengeForFaction(guildId, user.faction)` to show user's war
    - If user's faction not in a war, fall back to `getAllActiveChallenges(guildId)` summary
    - With `all` flag: always show `getAllActiveChallenges(guildId)` summary
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 7.5 Update `faction_challenge end` handler
    - No args: end user's faction's war via `getActiveChallengeForFaction`
    - `faction` arg: end that faction's war via `getActiveChallengeForFaction(guildId, factionArg)`
    - `all` flag: end all via `getAllActiveChallenges(guildId)` and loop
    - Process global totals, victory roles, economy payouts independently per war
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 7.6 Write unit tests for updated command handlers
    - Test create rejects only on faction overlap, not on any active war
    - Test join finds correct war for user's faction
    - Test status shows user's war vs all wars
    - Test end with faction arg, without arg, and `all` flag
    - _Requirements: 1.1, 1.2, 2.1, 2.3, 3.1, 3.3, 4.1, 4.3_

- [x] 8. Add faction channel war announcements
  - [x] 8.1 Add `announceFactionWarToFactionChannels` to `lib/announcements.js`
    - Accept `client, guildId, config, factionNames, embed` parameters
    - For each faction in `factionNames`, look up `config.factionChannelMap[faction]` and send the embed
    - If no faction channel exists for a faction, fall back to `config.announceChannel`
    - Continue to send to guild announce channel as well
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 8.2 Wire `announceFactionWarToFactionChannels` into the `faction_challenge create` handler
    - After creating the war and calling `announceFactionChallengeToGuild`, also call `announceFactionWarToFactionChannels` with the participating factions
    - _Requirements: 9.1, 9.3_

  - [ ]* 8.3 Write unit tests for faction channel announcements
    - Test announcement sent to faction channels + announce channel
    - Test fallback to announce channel when no faction channel exists
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 9. Backward compatibility verification
  - [x] 9.1 Verify `/faction_role_link` continues to work and overrides auto-provisioned roles
    - Ensure `ensureFactionRole` respects existing `factionRoleMap` entries set by `/faction_role_link`
    - Ensure `/faction_role_link` updates `factionRoleMap` and subsequent joins use the custom role
    - _Requirements: 12.1, 12.2, 12.3_

  - [x] 9.2 Verify `removeUserFromFactionChallengeEnrollment` works with multiple active wars
    - Ensure leaving a faction removes user from all active challenge rosters (existing logic already loops all active challenges)
    - _Requirements: 11.3_

  - [ ]* 9.3 Write unit tests for backward compatibility
    - Test `/faction_role_link` overrides auto-provisioned role
    - Test user removed from war roster on faction leave
    - _Requirements: 11.3, 12.2, 12.3_

- [x] 10. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The existing `getActiveChallenge` is kept but deprecated — callers migrate to faction-scoped lookups
- Provisioning is idempotent and gracefully degrades on missing Discord permissions
