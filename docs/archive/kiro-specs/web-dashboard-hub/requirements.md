# Requirements Document

## Introduction

Transform the existing PlayBound website (play-bound.com) from a marketing/landing page into a full web dashboard that gives players, admins, and premium users meaningful reasons to visit. The dashboard surfaces personal game stats, shop browsing, faction profiles, achievement showcases, full admin server management, premium status, and web-based game scheduling — all backed by new and existing API endpoints on api.play-bound.com.

## Glossary

- **Dashboard**: The authenticated web application at play-bound.com that displays personalized data after Discord OAuth login
- **Player**: Any Discord user who has logged in via Discord OAuth on the website
- **Admin**: A user who has the Bot Manager role or server owner permissions in at least one guild where PlayBound is installed
- **Premium_User**: A user whose `isPremium` flag is true on at least one guild User document (via Discord or Stripe subscription)
- **Stats_Aggregator**: The API service that aggregates a user's game statistics across all guild User documents
- **Shop_Browser**: The web UI component that displays global and server-specific shop items with ownership status
- **Faction_Profile_Card**: The web UI component that displays a user's faction membership, season standings, and war participation
- **Achievement_Showcase**: The web UI component that lists a user's earned achievements with names and descriptions
- **Admin_Dashboard**: The full-width tabbed admin interface replacing the existing slide-out admin drawer
- **Game_Scheduler**: The web UI component that allows admins to start or schedule games from the browser
- **Shop_Manager**: The web UI component that allows admins to add, edit, and remove server-specific shop items
- **Channel_Configurator**: The web UI component that allows admins to set channel assignments via dropdown selectors
- **Challenge_Manager**: The web UI component that allows admins to view and manage faction challenges
- **Premium_Status_Card**: The web UI component that displays a premium user's subscription status and active perks
- **Stats_API**: The `GET /api/me/stats` endpoint that returns aggregated per-game-type win counts across all guilds
- **Shop_API**: The `GET /api/shop` endpoint that returns global and server-specific shop items with ownership data
- **UserSchema**: The Mongoose User model containing per-guild stats, inventory, achievements, faction, and premium fields
- **SystemConfig**: The Mongoose SystemConfig model containing per-guild channel assignments, shop items, and server settings
- **ShopItemSchema**: The Mongoose model for global shop items with id, name, price, desc, type, and premiumOnly fields
- **RecurringGameSchema**: The Mongoose model for scheduled recurring games with guildId, channelId, type, interval, and nextRun
- **FactionChallengeSchema**: The Mongoose model for faction wars with participants, scores, status, and war metadata

## Requirements

### Requirement 1: Personal Game Stats Aggregation API

**User Story:** As a player, I want to see my game win statistics aggregated across all servers, so that I can understand my overall performance at a glance.

#### Acceptance Criteria

1. WHEN a logged-in Player requests `GET /api/me/stats`, THE Stats_API SHALL aggregate `stats.gamesWon`, `stats.triviaWins`, `stats.serverdleWins`, `stats.unscrambleWins`, `stats.tuneWins`, `stats.captionWins`, `stats.sprintWins`, and `stats.guessWins` across all UserSchema documents matching the Player's userId
2. WHEN a logged-in Player requests `GET /api/me/stats`, THE Stats_API SHALL return the count of distinct guildId values where the Player has at least one game win
3. WHEN a logged-in Player requests `GET /api/me/stats`, THE Stats_API SHALL return the response within 3 seconds
4. IF an unauthenticated request is made to `GET /api/me/stats`, THEN THE Stats_API SHALL return HTTP 401 with error code `login_required`
5. WHEN the Stats_API aggregates wins, THE Stats_API SHALL exclude guilds listed in the `PUBLIC_STATS_EXCLUDE_GUILD_IDS` environment variable

### Requirement 2: Personal Game Stats Card UI

**User Story:** As a player, I want to see a visual stats card on my dashboard showing per-game-type wins and server count, so that I can track my progress.

#### Acceptance Criteria

1. WHEN a logged-in Player views the Dashboard, THE Dashboard SHALL display a stats card showing total games won and per-game-type win counts (trivia, serverdle, unscramble, tune, caption, sprint, guess)
2. WHEN the stats card displays a game type with wins across multiple guilds, THE Dashboard SHALL show the count in the format "{N} wins across {M} servers"
3. WHEN the Stats_API returns zero wins for a game type, THE Dashboard SHALL display that game type with a count of zero
4. IF the Stats_API request fails, THEN THE Dashboard SHALL display an inline error message and a retry button

### Requirement 3: Shop Items API

**User Story:** As a player, I want to browse available shop items from the web, so that I can see what is available to purchase without opening Discord.

#### Acceptance Criteria

1. WHEN a logged-in Player requests `GET /api/shop?guildId=X`, THE Shop_API SHALL return all global ShopItemSchema documents combined with the server-specific `shopItems` array from the SystemConfig for guild X
2. WHEN the Shop_API returns items, THE Shop_API SHALL include for each item: id, name, price, description, type, and premiumOnly flag
3. WHEN a logged-in Player requests `GET /api/shop?guildId=X`, THE Shop_API SHALL include an `owned` boolean for each item indicating whether the Player's UserSchema inventory or currentCosmetics contains that item id
4. WHEN a logged-in Player requests `GET /api/shop?guildId=X`, THE Shop_API SHALL include an `equipped` boolean for each item indicating whether the Player's currentCosmetics map contains that item id as a value
5. IF the guildId query parameter is missing, THEN THE Shop_API SHALL return only global ShopItemSchema documents without server-specific items
6. IF an unauthenticated request is made to `GET /api/shop`, THEN THE Shop_API SHALL return items without `owned` or `equipped` fields

### Requirement 4: Shop Browser UI

**User Story:** As a player, I want to browse shop items on the web with filtering and ownership indicators, so that I can plan purchases before using Discord commands.

#### Acceptance Criteria

1. WHEN a logged-in Player views the Shop_Browser, THE Dashboard SHALL display all shop items grouped by type (consumable, cosmetic, badge, color, role)
2. WHEN a shop item is owned by the Player, THE Shop_Browser SHALL display an "Owned" badge on that item
3. WHEN a shop item is currently equipped by the Player, THE Shop_Browser SHALL display an "Equipped" indicator on that item
4. WHEN a shop item has `premiumOnly` set to true, THE Shop_Browser SHALL display a premium indicator on that item
5. WHEN a Player selects a server from a server dropdown, THE Shop_Browser SHALL reload items for that guild using the Shop_API
6. THE Shop_Browser SHALL display each item's name, price, description, and type

### Requirement 5: Faction Profile Card

**User Story:** As a player, I want to see my faction membership, season standing, and war participation on the web, so that I can track my faction involvement.

#### Acceptance Criteria

1. WHEN a logged-in Player who belongs to a faction views the Dashboard, THE Faction_Profile_Card SHALL display the Player's faction name and faction emoji
2. WHEN a logged-in Player views the Faction_Profile_Card, THE Faction_Profile_Card SHALL display the faction's current season match points and global rank
3. WHEN a logged-in Player views the Faction_Profile_Card, THE Faction_Profile_Card SHALL display the number of faction challenges the Player has participated in (enrolled as participant in FactionChallengeSchema documents)
4. WHEN a logged-in Player who does not belong to a faction views the Dashboard, THE Faction_Profile_Card SHALL display a message indicating no faction membership with a prompt to join via Discord
5. IF the faction data API request fails, THEN THE Faction_Profile_Card SHALL display an inline error message and a retry button

### Requirement 6: Faction Profile API

**User Story:** As a player, I want an API endpoint that returns my faction details and war participation, so that the web dashboard can display faction data.

#### Acceptance Criteria

1. WHEN a logged-in Player requests `GET /api/me/faction`, THE Stats_API SHALL return the Player's faction name, faction emoji, and the faction's current matchPoints and global rank
2. WHEN a logged-in Player requests `GET /api/me/faction`, THE Stats_API SHALL return the count of FactionChallengeSchema documents where the Player's userId appears in participantsA, participantsB, or participantsByFaction
3. WHEN a logged-in Player requests `GET /api/me/faction`, THE Stats_API SHALL return the Player's last 10 war results including winnerFaction, the Player's faction side, and endedAt timestamp
4. IF the logged-in Player has no faction, THEN THE Stats_API SHALL return `{ faction: null }` with HTTP 200

### Requirement 7: Achievement Showcase

**User Story:** As a player, I want to see all my earned achievements listed on the web with descriptions, so that I can review my accomplishments.

#### Acceptance Criteria

1. WHEN a logged-in Player views the Achievement_Showcase, THE Dashboard SHALL display all achievement keys from the Player's UserSchema `achievements` array resolved to their display name and description
2. WHEN resolving achievement metadata, THE Achievement_Showcase SHALL use built-in ACHIEVEMENTS definitions and guild-specific `customAchievements` from SystemConfig
3. WHEN the Player has achievements from multiple guilds, THE Achievement_Showcase SHALL display the union of all achievements across guilds without duplicates
4. WHEN the Player has zero achievements, THE Achievement_Showcase SHALL display a message indicating no achievements earned with guidance on how to earn them

### Requirement 8: Achievement Data API

**User Story:** As a player, I want an API endpoint that returns my achievements with resolved metadata, so that the web dashboard can display achievement details.

#### Acceptance Criteria

1. WHEN a logged-in Player requests `GET /api/me/achievements`, THE Stats_API SHALL return the deduplicated union of `achievements` arrays from all UserSchema documents matching the Player's userId
2. WHEN the Stats_API returns achievements, THE Stats_API SHALL resolve each achievement key to its name and description using built-in ACHIEVEMENTS and per-guild customAchievements
3. IF an achievement key cannot be resolved to metadata, THEN THE Stats_API SHALL return the raw key as the name with a null description

### Requirement 9: Admin Dashboard Layout

**User Story:** As an admin, I want the admin interface to be a full-width dashboard tab instead of a slide-out drawer, so that I have more space to manage my server.

#### Acceptance Criteria

1. WHEN an Admin clicks the admin navigation tab, THE Admin_Dashboard SHALL render as a full-width page section replacing the main content area
2. THE Admin_Dashboard SHALL organize admin functions into sub-tabs: Overview, Games, Economy, Factions, Shop, Channels, Referrals, Automation, Roles, Audit
3. WHEN a non-admin Player views the Dashboard, THE Dashboard SHALL hide the admin navigation tab
4. WHEN an Admin selects a server from the server selector, THE Admin_Dashboard SHALL load all sub-tab data for that guild

### Requirement 10: Web Game Scheduling

**User Story:** As an admin, I want to start or schedule games from the web dashboard, so that I can manage game sessions without using Discord slash commands.

#### Acceptance Criteria

1. WHEN an Admin opens the Game_Scheduler, THE Game_Scheduler SHALL display a form with server selector, channel selector, and game type selector
2. WHEN an Admin submits the Game_Scheduler form with "Start Now", THE Game_Scheduler SHALL send a POST request to the existing `/api/admin/games` endpoint to create an active game in the selected channel
3. WHEN an Admin submits the Game_Scheduler form with "Schedule", THE Game_Scheduler SHALL send a POST request to create a RecurringGameSchema document with the specified interval in days and hours
4. WHEN the game scheduling API receives a request during a maintenance window, THE Game_Scheduler SHALL display the maintenance denial message returned by the API
5. WHEN the Game_Scheduler displays the channel selector, THE Game_Scheduler SHALL populate options from the guild's text channels available to the bot
6. WHEN the Game_Scheduler displays the game type selector, THE Game_Scheduler SHALL list all game types from the PLATFORM_GAME_TAGS registry

### Requirement 11: Shop Management for Admins

**User Story:** As an admin, I want to add, edit, and remove server-specific shop items from the web, so that I can manage my server's shop without slash commands.

#### Acceptance Criteria

1. WHEN an Admin views the Shop_Manager, THE Shop_Manager SHALL display all server-specific shop items from the SystemConfig `shopItems` array for the selected guild
2. WHEN an Admin clicks "Add Item" in the Shop_Manager, THE Shop_Manager SHALL display a form with fields for name, price, description, type (consumable, cosmetic, badge, color, role), and premiumOnly toggle
3. WHEN an Admin submits a new shop item, THE Shop_Manager SHALL send a POST request to `POST /api/admin/shop` to append the item to the guild's SystemConfig `shopItems` array
4. WHEN an Admin edits an existing shop item, THE Shop_Manager SHALL send a PUT request to `PUT /api/admin/shop/:itemIndex` to update the item at that index in the `shopItems` array
5. WHEN an Admin deletes a shop item, THE Shop_Manager SHALL send a DELETE request to `DELETE /api/admin/shop/:itemIndex` to remove the item from the `shopItems` array
6. IF the shop item name is empty or the price is not a positive integer, THEN THE Shop_Manager SHALL display a validation error and prevent submission

### Requirement 12: Shop Management API

**User Story:** As an admin, I want API endpoints to manage server-specific shop items, so that the web dashboard can perform CRUD operations on the shop.

#### Acceptance Criteria

1. WHEN an Admin sends `POST /api/admin/shop` with guildId and item data, THE Shop_API SHALL append the new item to the SystemConfig `shopItems` array for that guild
2. WHEN an Admin sends `PUT /api/admin/shop/:itemIndex` with guildId and updated item data, THE Shop_API SHALL replace the item at the specified index in the `shopItems` array
3. WHEN an Admin sends `DELETE /api/admin/shop/:itemIndex` with guildId, THE Shop_API SHALL remove the item at the specified index from the `shopItems` array
4. IF the itemIndex is out of bounds for the `shopItems` array, THEN THE Shop_API SHALL return HTTP 404 with error code `item_not_found`
5. IF the requesting user does not have admin access to the specified guild, THEN THE Shop_API SHALL return HTTP 403 with error code `forbidden`

### Requirement 13: Channel Configuration

**User Story:** As an admin, I want to configure channel assignments (announce, welcome, birthday, achievement, leaderboard) via dropdown selectors on the web, so that I do not need to type channel IDs manually.

#### Acceptance Criteria

1. WHEN an Admin views the Channel_Configurator, THE Channel_Configurator SHALL display the current channel assignments for announceChannel, welcomeChannel, birthdayChannel, achievementChannel, leaderboardChannel, and storyChannel from SystemConfig
2. WHEN an Admin views the Channel_Configurator, THE Channel_Configurator SHALL populate each dropdown with the guild's text channels fetched from the bot's Discord cache
3. WHEN an Admin selects a channel from a dropdown and saves, THE Channel_Configurator SHALL send a PATCH request to update the corresponding field on the guild's SystemConfig document
4. WHEN an Admin selects "None" from a channel dropdown and saves, THE Channel_Configurator SHALL set the corresponding SystemConfig field to null
5. IF the channel update API request fails, THEN THE Channel_Configurator SHALL display an error message and revert the dropdown to the previous value

### Requirement 14: Channel Configuration API

**User Story:** As an admin, I want API endpoints to list guild channels and update channel assignments, so that the web dashboard can configure channels.

#### Acceptance Criteria

1. WHEN an Admin requests `GET /api/admin/channels?guildId=X`, THE Admin_Dashboard SHALL return the list of text channels in guild X that the bot can see, each with channelId and name
2. WHEN an Admin requests `GET /api/admin/channels?guildId=X`, THE Admin_Dashboard SHALL return the current channel assignments from SystemConfig (announceChannel, welcomeChannel, birthdayChannel, achievementChannel, leaderboardChannel, storyChannel)
3. WHEN an Admin sends `PATCH /api/admin/channels` with guildId and a map of channel field names to channel IDs, THE Admin_Dashboard SHALL update the corresponding fields on the SystemConfig document
4. IF a provided channelId does not exist in the guild's channel list, THEN THE Admin_Dashboard SHALL return HTTP 400 with error code `invalid_channel`

### Requirement 15: Faction Challenge Management

**User Story:** As an admin, I want to view active faction challenges, end them, and see challenge history from the web, so that I can manage wars without Discord commands.

#### Acceptance Criteria

1. WHEN an Admin views the Challenge_Manager, THE Challenge_Manager SHALL display all active FactionChallengeSchema documents for the selected guild with faction names, scores, end time, and challenge mode
2. WHEN an Admin clicks "End Challenge" on an active challenge, THE Challenge_Manager SHALL send a POST request to `POST /api/admin/factions/challenge/end` with the challenge ID
3. WHEN the challenge end API processes the request, THE Challenge_Manager SHALL compute final scores, determine the winner, apply match points to global standings for ranked wars, and grant war economy payouts
4. WHEN an Admin views the Challenge_Manager history section, THE Challenge_Manager SHALL display the last 12 completed challenges with winner, matchup, scores, and match points awarded
5. IF the Admin does not have faction management permissions for the guild, THEN THE Challenge_Manager SHALL display a message indicating insufficient permissions

### Requirement 16: Premium Status Card

**User Story:** As a premium user, I want to see my subscription status and active perks on the web, so that I can verify my premium benefits.

#### Acceptance Criteria

1. WHEN a Premium_User views the Dashboard, THE Premium_Status_Card SHALL display the text "Premium Active" with the subscription source (Discord or Stripe)
2. WHEN a non-premium Player views the Dashboard, THE Premium_Status_Card SHALL display a prompt to subscribe with links to the Stripe monthly and yearly purchase URLs from the public config
3. THE Premium_Status_Card SHALL list the active premium perks: 2x point multiplier, extended streak cap (+12), faction switch ability, and automation access

### Requirement 17: Premium Shop Highlighting

**User Story:** As a premium user, I want premium-exclusive shop items to be visually highlighted, so that I can identify items available only to premium subscribers.

#### Acceptance Criteria

1. WHEN the Shop_Browser displays items, THE Shop_Browser SHALL apply a distinct visual style (border color and label) to items where `premiumOnly` is true
2. WHEN a non-premium Player views a premiumOnly item, THE Shop_Browser SHALL display a lock icon and "Premium Only" label on that item
3. WHEN a Premium_User views a premiumOnly item, THE Shop_Browser SHALL display the item without the lock icon

### Requirement 18: Premium Automation Controls

**User Story:** As a premium admin, I want to manage scheduled announcements and recurring games from the web, so that I can configure automation without Discord commands.

#### Acceptance Criteria

1. WHEN a Premium_User with admin access views the Automation sub-tab, THE Admin_Dashboard SHALL display existing recurring games and scheduled announcements for the selected guild
2. WHEN a Premium_User creates a new recurring game via the web, THE Admin_Dashboard SHALL create a RecurringGameSchema document with the specified guildId, channelId, type, intervalDays, intervalHours, and nextRun
3. WHEN a Premium_User deletes a recurring game via the web, THE Admin_Dashboard SHALL remove the corresponding RecurringGameSchema document
4. WHEN a non-premium Admin views the Automation sub-tab, THE Admin_Dashboard SHALL display the automation data as read-only with a premium upgrade prompt

### Requirement 19: Boost Session History

**User Story:** As a premium user, I want to see my boost session history on the web, so that I can review when I have boosted game threads.

#### Acceptance Criteria

1. WHEN a Premium_User views the boost history section, THE Dashboard SHALL display the last 20 game sessions where the Player activated a premium aura boost, showing game type, guild name, and timestamp
2. WHEN the boost history API returns zero results, THE Dashboard SHALL display a message indicating no boost sessions recorded
3. IF the Player is not a Premium_User, THEN THE Dashboard SHALL hide the boost history section

### Requirement 20: Navigation and Layout

**User Story:** As a player, I want the dashboard to integrate into the existing tab-based navigation, so that the experience is consistent with the current website.

#### Acceptance Criteria

1. THE Dashboard SHALL add a "My Dashboard" tab to the existing navigation bar visible only to logged-in Players
2. WHEN a logged-in Player clicks "My Dashboard", THE Dashboard SHALL display the player dashboard with stats card, shop browser, faction profile, and achievement showcase sections
3. WHEN an Admin clicks the "Admin" tab, THE Dashboard SHALL render the Admin_Dashboard as a full-width tabbed interface instead of the existing slide-out drawer
4. THE Dashboard SHALL preserve the existing profile strip showing faction, credits, and arena score for logged-in users
5. WHEN the Dashboard loads on a mobile viewport (width below 768px), THE Dashboard SHALL stack all cards vertically in a single column layout
