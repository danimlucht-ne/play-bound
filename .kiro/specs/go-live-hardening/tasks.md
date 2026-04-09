# Tasks: PlayBound Go-Live Hardening

## Tasks

- [x] 1. Add `GET /health` endpoint returning `{ status: "ok" }` to the Express server
  - Requirements: FR1
  - File: `index.js` (Express app section)

- [x] 2. Install `express-rate-limit` and add rate limiting middleware to all Express routes, with a stricter limit on the `/webhook` endpoint
  - Requirements: FR2
  - Files: `package.json`, `index.js`

- [x] 3. Add a TTL index on `Game.endTime` (30 days) or a daily cron job to purge ended games older than 30 days
  - Requirements: FR3
  - Files: `models.js`, `index.js` (if cron approach)

- [ ] 4. Audit the `/ticket` command to confirm it creates a PrivateThread; fix if it creates a PublicThread
  - Requirements: FR4
  - File: `index.js` (ticket command handler)

- [x] 5. Audit Stripe vs. Discord Premium payment flow; add `PAYMENT_PROVIDER` config to `.env.example`; ensure webhook handler gracefully handles the inactive provider's events
  - Requirements: FR5
  - Files: `.env.example`, `index.js` (webhook handler)

- [x] 6. Add try/catch with specific Discord API error handling to all role-management commands (`/set_manager_role`, `/set_auto_role`, `/sync_auto_role`, `/strip_role`)
  - Requirements: FR6
  - File: `index.js` (role command handlers)

- [x] 7. Create `scripts/backup.sh` for automated MongoDB backups with 7-day retention; document setup in README
  - Requirements: FR7
  - Files: `scripts/backup.sh` (new), `README.md`

- [x] 8. Refactor `index.js` — extract shared DB/user utilities into `lib/db.js`, announcement helpers into `lib/announcements.js`, achievement logic into `lib/achievements.js`, and text utilities into `lib/utils.js`
  - Requirements: NFR1
  - Files: `index.js`, `lib/db.js` (new), `lib/announcements.js` (new), `lib/achievements.js` (new), `lib/utils.js` (new)

- [ ] 9. Extract each game type into its own module under `games/` directory (trivia, serverdle, guess-the-number, tournament, trivia-sprint, caption, name-that-tune, movie-quotes, unscramble, giveaway, story)
  - Requirements: NFR1
  - Files: `index.js`, `games/*.js` (new, ~11 files)

- [x] 10. Update README to document that Name That Tune uses the public iTunes Search API for 30-second preview clips; remove any references to "local music library"
  - Requirements: NFR2
  - Files: `README.md`

- [ ] 11. Consolidate or rename `#community-support` / `#support` channels in the Discord server to eliminate confusion
  - Requirements: NFR3
  - Note: Discord server config change, not a code change

- [ ] 12. Swap Stripe test keys for live keys in production `.env`; verify webhook signature validation works end-to-end; do a test payment and refund
  - Requirements: NFR4
  - Files: `.env` (production only)

- [x] 13. Add `modifiedCount === 0` warning logging after `User.updateMany` calls in both `checkout.session.completed` and `customer.subscription.deleted` Stripe webhook handlers
  - Requirements: FR8
  - File: `index.js` (webhook handler)

- [ ] 14. Create `ServerFaction` model; implement `/create_faction`, `/delete_faction`, `/rename_faction`, `/list_server_factions` commands (premium admin only); update `/faction join` to show server factions alongside global ones; add `/faction leave` for users to voluntarily leave global or server factions
  - Requirements: FR9
  - Files: `models.js`, `index.js` (or `games/factions.js` if modularized), `deploy-commands.js`

- [ ] 15. Create `ServerAchievement` model; implement `/create_achievement`, `/grant_achievement`, `/delete_achievement`, `/list_server_achievements` commands (premium admin only); update `/profile` to display custom achievements
  - Requirements: FR10
  - Files: `models.js`, `index.js` (or `lib/achievements.js` if modularized), `deploy-commands.js`

- [ ] 16. Implement admin faction management: `/set_user_faction`, `/remove_user_faction`, `/reset_faction_points`, `/faction_members` commands; register in `deploy-commands.js`
  - Requirements: FR11
  - Files: `index.js`, `deploy-commands.js`

- [ ] 17. Implement admin user management: `/view_user` (ephemeral full profile), `/reset_user` (with confirmation button), `/revoke_achievement`, `/remove_item` commands; register in `deploy-commands.js`
  - Requirements: FR12
  - Files: `index.js`, `deploy-commands.js`

- [x] 18. Add blacklist system: add `isBlacklisted` and `blacklistReason` fields to User schema; implement `/blacklist` and `/unblacklist` commands; add early blacklist check in `interactionCreate` handler
  - Requirements: FR13
  - Files: `models.js`, `index.js`, `deploy-commands.js`

- [ ] 19. Implement `/serverstats` command showing aggregate server statistics (total users, points, games played, active games, top game type, top faction, premium count)
  - Requirements: FR14
  - Files: `index.js`, `deploy-commands.js`

- [ ] 20. Audit Name That Tune implementation: verify iTunes Search API usage, previewUrl validation, error handling for API failures, track deduplication, and correct error log messages; update README to reference iTunes API
  - Requirements: FR15
  - Files: `index.js` (namethattune handler), `README.md`

- [x] 21. Validate seed data integrity: ensure all Serverdle words are exactly 5 uppercase letters with no duplicates, all Unscramble phrases have phrase+clue with no duplicates, all Movie Quotes have quote+movie with no duplicates; add a `scripts/validate-seed.js` script to check this
  - Requirements: FR16
  - Files: `scripts/validate-seed.js` (new), `seed-expanded.js`

- [ ] 22. Implement admin content management commands: `/add_word`, `/remove_word`, `/add_phrase`, `/remove_phrase`, `/add_movie_quote`, `/remove_movie_quote`, `/content_stats`; register in `deploy-commands.js`
  - Requirements: FR16
  - Files: `index.js`, `deploy-commands.js`
