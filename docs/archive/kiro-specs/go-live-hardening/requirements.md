# Requirements: PlayBound Go-Live Hardening

## Overview
Address all critical and high-priority items needed before PlayBound goes live to real users at scale. Covers security, operational reliability, database hygiene, legal compliance, and code maintainability.

## Requirements

### Functional Requirements

- FR1: Add a `GET /health` endpoint to the Express server that returns HTTP 200 with a JSON body `{ status: "ok" }` so external uptime monitors (UptimeRobot, Better Stack, etc.) can verify the bot's web server is alive.

- FR2: Add rate limiting to the Express server (especially the `/webhook` Stripe endpoint) to prevent abuse. Use a middleware like `express-rate-limit` with sensible defaults (e.g., 100 requests per 15 minutes per IP for general routes, stricter for webhook).

- FR3: Add a TTL index or scheduled cleanup mechanism for the `Game` collection so that ended games older than 30 days are automatically purged from MongoDB, preventing unbounded collection growth.

- FR4: Verify that the `/ticket` command creates a **private thread** (not a public one) so user support conversations are not visible to other server members.

- FR5: Audit and clarify the Stripe vs. Discord Premium payment path. Ensure the `.env` configuration clearly documents which payment system is active. If using Discord-native monetization at launch, ensure Stripe webhook processing gracefully handles or ignores events. If using both, document the dual-path clearly.

- FR6: Ensure all role-management commands (`/set_manager_role`, `/set_auto_role`, `/sync_auto_role`, `/strip_role`) handle Discord permission errors gracefully (missing permissions, role hierarchy issues) with clear user-facing error messages, especially in multi-server contexts.

- FR7: Add automated MongoDB backup strategy — either a cron-based `mongodump` script or documentation for cloud provider snapshot configuration. Include a restore procedure.

- FR8: After the Stripe webhook processes a `checkout.session.completed` or `customer.subscription.deleted` event, check the `modifiedCount` from `User.updateMany`. If `modifiedCount === 0`, log a warning indicating the Discord user ID was not found in the database (likely a typo or a user who hasn't interacted with the bot yet). This prevents silent failures where a user pays but never receives premium.

- FR9: [💎 Premium] Allow premium server admins to create custom server-scoped factions via `/create_faction`. Custom factions have a name, emoji, and description, and function like the global factions but are limited to that server. Server members can join a server faction in addition to their global faction. Include `/delete_faction` (admin only, unsets faction from all server members and deletes it), `/rename_faction` (admin only), and `/list_server_factions` commands. Cap at 5 custom factions per server. Also add `/faction leave` so any user can leave their current global or server faction voluntarily (decrements the faction's member count).

- FR10: [💎 Premium] Allow premium server admins to create custom achievements via `/create_achievement`. Custom achievements have a key, name, description, and optional role reward. Admins can manually grant them to users via `/grant_achievement user:@Name achievement:key`. Include `/delete_achievement` and `/list_server_achievements` commands. Custom achievements appear alongside built-in ones on a user's `/profile`.

- FR11: Add admin faction management commands: `/set_user_faction user faction` (force-assign a user to a global or server faction), `/remove_user_faction user` (remove a user from their faction), `/reset_faction_points faction` (reset a faction's total points to zero for season resets), and `/faction_members faction` (list all members of a given faction in the server).

- FR12: Add admin user management commands: `/view_user user` (inspect a user's full profile including points, streak, inventory, achievements, premium status, faction), `/reset_user user` (wipe a user's points, streak, inventory, and achievements back to defaults with confirmation prompt), `/revoke_achievement user achievement_key` (remove a specific achievement from a user), and `/remove_item user item_id` (remove a specific item from a user's inventory).

- FR13: Add `/blacklist user reason` and `/unblacklist user` commands. Blacklisted users are blocked from all bot interactions (commands, game participation, economy). Store blacklist status on the User model. Check blacklist status early in the interaction handler and reject with a message explaining they are blacklisted.

- FR14: Add `/serverstats` command (admin only) showing aggregate server statistics: total users, total points distributed, total games played, active games, most popular game type, top faction by points, and premium user count.

- FR15: Verify Name That Tune correctly uses the iTunes Search API (`https://itunes.apple.com/search`). Ensure: (a) graceful handling when iTunes API is down or returns no results, (b) the `previewUrl` field is validated before attempting to play (some tracks may not have previews), (c) duplicate tracks are filtered out within a single game session, (d) the genre/query parameter properly maps to iTunes search terms, and (e) the error log message references "iTunes" not "local files".

- FR16: Verify trivia and game content data integrity: (a) Trivia uses Open Trivia Database API with proper rate-limit retry (429 handling) and fallback when a category returns no results, (b) Serverdle word bank has sufficient 5-letter words (target: 500+) with no duplicates or non-5-letter entries, (c) Unscramble phrase bank has sufficient variety across categories (target: 100+) with no duplicates, (d) Movie Quotes bank has sufficient entries (target: 50+) with no duplicate quotes. Add admin commands `/add_word word`, `/remove_word word`, `/add_phrase phrase clue`, `/remove_phrase phrase`, `/add_movie_quote quote movie`, `/remove_movie_quote quote` so admins can manage game content without reseeding the database.

### Non-Functional Requirements

- NFR1: Refactor `index.js` into modular files — extract each game type into its own module (e.g., `games/trivia.js`, `games/serverdle.js`, `games/tournament.js`, etc.) and extract shared utilities (user management, scoring, announcements) into helper modules. The main `index.js` should only handle bot initialization, event routing, and command dispatch.

- NFR2: The Name That Tune feature uses the public iTunes Search API for 30-second preview clips, which is legally permissible under Apple's API terms. Update the README to document this (remove any references to "local music library"). No licensing action needed.

- NFR3: Consolidate or clearly differentiate the `#community-support` and `#support` channels in the Discord server to avoid user confusion about where to seek help.

- NFR4: Swap Stripe test keys for live keys (secret key + webhook secret) on the production server. Verify that Payment Links match the intended mode (test vs. live). Confirm webhook signature validation works end-to-end with live keys.
