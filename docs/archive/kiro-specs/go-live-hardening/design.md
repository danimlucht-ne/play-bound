# Design: PlayBound Go-Live Hardening

## Overview
This design covers the technical approach for each requirement to prepare PlayBound for production launch.

## Design Details

### FR1: Health Endpoint
Add a simple route in the Express app section of `index.js` (or the extracted server module):
```js
app.get('/health', (req, res) => res.json({ status: 'ok' }));
```
This should be added before the Stripe webhook route. No authentication required — it's a public liveness check.

### FR2: Rate Limiting
Install `express-rate-limit`:
```bash
npm install express-rate-limit
```
Apply a general limiter to all Express routes and a stricter one to the webhook endpoint:
- General: 100 requests / 15 min per IP
- Webhook: 30 requests / 1 min per IP (Stripe sends bursts but not hundreds)

### FR3: Game Collection Cleanup
Two options (implement one):
- **Option A (TTL Index):** Add a MongoDB TTL index on `Game.endTime` with an expiry of 30 days. This requires setting `endTime` on all games when they end (verify this is already happening).
- **Option B (Cron Job):** Add a `node-cron` task that runs daily and deletes `Game` documents where `status === 'ended'` and `endTime` is older than 30 days.

Option A is preferred as it's zero-maintenance once set up.

### FR4: Private Ticket Threads
Audit the `/ticket` command handler. Ensure it uses `channel.threads.create()` with `type: ChannelType.PrivateThread`. If it's currently using `ChannelType.PublicThread`, change it. The bot needs `CREATE_PRIVATE_THREADS` permission in the server.

### FR5: Payment Path Audit
- Review the current webhook handler to determine if it processes Stripe events, Discord entitlement events, or both.
- Add a config flag (e.g., `PAYMENT_PROVIDER=discord` or `PAYMENT_PROVIDER=stripe`) to `.env.example` so the active path is explicit.
- If Discord-native is the go-live path, the Stripe webhook handler should still exist but log a warning if it receives events unexpectedly.

### FR6: Role Command Error Handling
Wrap all role operations in try/catch blocks that specifically catch Discord API errors:
- `50013` (Missing Permissions) — tell the user the bot's role needs to be higher in the hierarchy
- `50028` (Invalid Role) — tell the user the role ID is invalid
- General fallback — log the error and tell the user something went wrong

### FR7: MongoDB Backup
Create a `scripts/backup.sh` script:
```bash
#!/bin/bash
mongodump --uri="$MONGO_URI" --out="/backups/playbound-$(date +%Y%m%d)"
find /backups -type d -mtime +7 -exec rm -rf {} +
```
Document in README how to set this up as a daily cron job. For cloud-hosted MongoDB (Atlas), document how to enable automated backups in the Atlas UI instead.

### FR8: Stripe Webhook Zero-Match Warning
After each `User.updateMany` call in the webhook handler, capture the result and check `modifiedCount`:
```js
const result = await User.updateMany({ userId: discordUserId }, { isPremium: true, premiumSource: 'stripe' });
if (result.modifiedCount === 0) {
    console.warn(`[Stripe] WARNING: No user documents found for Discord ID ${discordUserId}. Payment received but premium not granted.`);
}
```
Apply the same pattern to the `customer.subscription.deleted` handler.

### FR9: Custom Server Factions [💎 Premium]
Add a `ServerFaction` model (or embed in `SystemConfig`):
```js
const ServerFactionSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    name: { type: String, required: true },
    emoji: { type: String, required: true },
    desc: { type: String, required: true },
    totalPoints: { type: Number, default: 0 },
    members: { type: Number, default: 0 }
});
ServerFactionSchema.index({ guildId: 1, name: 1 }, { unique: true });
```
Commands:
- `/create_faction name emoji description` — Premium admin only. Cap at 5 custom factions per server.
- `/delete_faction name` — Removes the faction and unsets it from all server users.
- `/rename_faction old_name new_name` — Renames an existing custom faction. Updates all user references.
- `/list_server_factions` — Shows both global and custom server factions.
- `/faction join` — Updated to show server factions alongside global ones. Users can have one global faction AND one server faction.
- `/faction leave` — Lets any user leave their current global faction, server faction, or both. Decrements the faction's member count accordingly.

Points earned contribute to both the user's global faction and their server faction simultaneously.

### FR10: Custom Server Achievements [💎 Premium]
Add a `ServerAchievement` model:
```js
const ServerAchievementSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    key: { type: String, required: true },
    name: { type: String, required: true },
    desc: { type: String, required: true },
    roleRewardId: { type: String, default: null }
});
ServerAchievementSchema.index({ guildId: 1, key: 1 }, { unique: true });
```
Commands:
- `/create_achievement key name description role_reward(optional)` — Premium admin only. Cap at 20 custom achievements per server.
- `/grant_achievement user achievement_key` — Manually awards a custom achievement to a user. Triggers the standard achievement announcement and role grant if configured.
- `/delete_achievement key` — Removes the achievement definition. Does not revoke from users who already earned it.
- `/list_server_achievements` — Shows all custom achievements for the server.

The `/profile` command should display custom server achievements in a separate section below the built-in ones.

### FR11: Admin Faction Management
Commands:
- `/set_user_faction user faction` — Force-assign a user to a global or server faction. If they're already in one, swap them.
- `/remove_user_faction user` — Remove a user from their current faction (global, server, or both via a `type` option).
- `/reset_faction_points faction` — Reset a faction's `totalPoints` to 0. Useful for season resets. Requires confirmation.
- `/faction_members faction` — Paginated list of all users in a given faction within the current server, sorted by contribution.

### FR12: Admin User Management
Commands:
- `/view_user user` — Ephemeral embed showing full profile: points, weekly points, streak, faction, premium status/source, inventory contents, equipped cosmetics, achievements, and key stats (games won, etc.).
- `/reset_user user` — Wipe a user's points, streak, inventory, achievements, and cosmetics back to defaults. Requires a confirmation button ("Are you sure?") before executing. Does not affect premium status.
- `/revoke_achievement user achievement_key` — Remove a specific achievement from a user's achievements array. If the achievement had a role reward, also remove the role.
- `/remove_item user item_id` — Remove a specific item from a user's inventory. If it's an equipped cosmetic, also unequip it.

### FR13: Blacklist System
Add `isBlacklisted: { type: Boolean, default: false }` and `blacklistReason: { type: String, default: null }` to the User schema.
Commands:
- `/blacklist user reason` — Sets `isBlacklisted: true` across all guild documents for that userId. Blacklisted users cannot use any bot commands or participate in games.
- `/unblacklist user` — Reverses the blacklist.
Add an early check at the top of the `interactionCreate` handler: if the user is blacklisted, reply with an ephemeral message explaining they are blocked and the reason, then return.

### FR14: Server Stats
- `/serverstats` — Admin-only embed showing: total registered users in the server, total points distributed (sum of all user points), total games played (count of Game documents for this guild), currently active games, most popular game type (by count), top faction by points, and premium user count.

### FR15: Name That Tune iTunes Verification
Audit the `/namethattune` command handler to verify:
- Uses `https://itunes.apple.com/search?term=...&entity=song&limit=100&media=music`
- Filters results to only tracks with a valid `previewUrl`
- Handles iTunes API errors (timeout, 5xx, empty results) with a user-friendly message
- Deduplicates tracks by `trackId` within a session
- The "mix" mode fetches from multiple genres and shuffles
- Error logs reference "iTunes API" not "local files"
- README accurately describes the feature as using iTunes previews

### FR16: Game Content Data Integrity & Admin Content Management
Verify seed data quality:
- Serverdle: all entries in `Word` collection are exactly 5 uppercase letters, no duplicates
- Unscramble: all entries in `Phrase` collection have both `phrase` and `clue` fields, no duplicates
- Movie Quotes: all entries in `MovieQuote` collection have both `quote` and `movie` fields, no duplicates
- Trivia: Open Trivia DB API calls handle `response_code !== 0` (no results, rate limited, token exhausted)

Add admin content management commands:
- `/add_word word` — Add a 5-letter word to the Serverdle pool. Validates length and uniqueness.
- `/remove_word word` — Remove a word from the pool.
- `/add_phrase phrase clue` — Add an unscramble phrase with clue.
- `/remove_phrase phrase` — Remove a phrase.
- `/add_movie_quote quote movie` — Add a movie quote.
- `/remove_movie_quote quote` — Remove a movie quote.
- `/content_stats` — Show counts of words, phrases, and movie quotes in the database.

### NFR1: Code Modularization
Target structure:
```
index.js              → Bot init, event routing, command dispatch only
lib/
  db.js               → getUser, updateUser, addScore, getSystemConfig, etc.
  announcements.js    → sendGlobalAnnouncement, announceWinner, announceScheduledGame
  achievements.js     → awardAchievement, achievement checks
  utils.js            → decodeHTMLEntities, getLevenshteinDistance, normalizeText, isFuzzyMatch, parsePointValues
games/
  trivia.js           → nextTriviaQuestion, triggerTriviaMatchEnd, startTriviaGame
  serverdle.js        → generateServerdleImage, triggerServerdleEnd, startServerdleGame
  guess-the-number.js → triggerNumberGuessingEnd
  tournament.js       → triggerTournamentStart, runTournamentRound
  trivia-sprint.js    → triggerTriviaSprintEnd
  caption.js          → triggerCaptionEnd
  name-that-tune.js   → triggerTuneEnd
  movie-quotes.js     → triggerMovieEnd, nextMovieQuote
  unscramble.js       → triggerUnscrambleEnd
  giveaway.js         → endGiveaway
  story.js            → One-word story logic
```
Each game module exports its start function, end/trigger function, and any message handlers. The main `index.js` imports and wires them up.

### NFR2: Music Licensing
- Name That Tune uses the public iTunes Search API (`https://itunes.apple.com/search`) to fetch 30-second preview clips. This is legally permissible under Apple's API terms of use.
- Update README to clarify this uses iTunes previews, not local files.
- No licensing action needed.

### NFR3: Channel Consolidation
This is a Discord server config change, not a code change. Recommendation: rename `#community-support` to `#general-chat` or `#hangout` if it's meant for casual conversation, keeping `#support` + `/ticket` as the official help path.

### NFR4: Stripe Key Swap
Pre-launch checklist item:
1. Log into Stripe dashboard in live mode
2. Copy live secret key → update `STRIPE_SECRET_KEY` in production `.env`
3. Create a new webhook endpoint pointing to production URL → copy webhook secret → update `STRIPE_WEBHOOK_SECRET`
4. Verify Payment Links were created in the correct mode
5. Test a real $1 payment and confirm the webhook fires and premium is granted
6. Refund the test payment
