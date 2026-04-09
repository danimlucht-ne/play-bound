# COMMANDS.md

PlayBound command reference. This file is the human-readable command guide. `deploy-commands.js` remains the source of truth for registered slash commands, and `src/events/interactionCreate.js` remains the source of truth for runtime permissions and behavior. The command set below is based on your uploaded README command reference. :contentReference[oaicite:0]{index=0}

==================================================
HOW TO USE THIS FILE
==================================================

Use this file for:
- quick command discovery
- product documentation
- onboarding staff/admins
- contributor orientation

Do NOT use this file as the only source of truth for:
- exact slash option schemas
- permission enforcement
- runtime edge cases

When command names, descriptions, or options change:
1. update `deploy-commands.js`
2. redeploy slash commands
3. update this document

==================================================
COMMAND GROUPS
==================================================

1. Onboarding & Help
2. Profile & Leaderboards
3. Economy & Shop
4. Hosted Games
5. Platform Rotation Games
6. Duels
7. Factions & Faction Wars
8. Growth & Referrals
9. Server Configuration & Automation
10. Developer / Admin Only

==================================================
1. ONBOARDING & HELP
==================================================

/onboarding
- Short first-time tour
- Supports skip/resume
- Used for first-time user onboarding flows

/help
- General bot guide
- Best first stop for players

/support
- Returns support server invite

/ticket
- Opens a private support ticket
- Types:
  - Bug
  - Suggestion
  - Support
  - Other

/premium
- Explains Premium benefits
- Links to subscription / purchase flow

==================================================
2. PROFILE & LEADERBOARDS
==================================================

/profile
- View your own stats
- Premium can peek at another member

/leaderboard
- Server activity rankings
- Local to the current guild
- Not the same as global faction standings

/leaderboard_history
- Shows saved weekly/monthly leaderboard snapshots

/season
- Quarterly faction season overview
- Used for seasonal standings and champions

==================================================
3. ECONOMY & SHOP
==================================================

/daily
- Claim daily Credits
- Premium has stronger cadence/perks

/pay
- Send Credits to another user

/shop
- Browse the Credit shop

/buy
- Buy an item from the shop

/inventory
- View owned items

/equip
- Equip a cosmetic item

/server_shop_add
- Add a custom server shop item
- Typically role / badge / color
- Premium / staff tool

/server_shop_remove
- Remove a custom server shop item
- Premium / staff tool

==================================================
4. HOSTED GAMES
==================================================

These are classic manually hosted or staff-hosted game commands.

/trivia
- Live trivia match

/triviasprint
- Speed trivia format

/startserverdle
- Wordle-style game

/guessthenumber
- Guess game with closest / without-going-over modes

/moviequotes
- Guess the movie or TV show from a quote

/namethattune
- Guess the song from an audio preview

/spellingbee
- Voice + thread spelling game

/caption
- Caption contest

/unscramble
- Unscramble words/phrases

/giveaway
- Giveaway with winners, exclusions, and cooldown rules

/tournament
- Dice Roll Tournament bracket

Common hosted game options include:
- thread_name
- duration
- rounds / questions
- points
- delay_hrs / delay_days
- repeat_hrs (Premium on supported games)

==================================================
5. PLATFORM ROTATION GAMES
==================================================

/playgame
- Starts a platform mini-game in a thread (no delay option — starts when you submit)
- Game must be in today’s active rotation
- Featured game gives bonus casual rewards only

Current listed platform games include: :contentReference[oaicite:1]{index=1}
- risk_roll
- target_21
- dice_duel
- king_of_the_hill
- high_card_blitz
- push_luck_deck
- combo_builder
- reaction_rush
- closest_guess
- last_man_standing
- pattern_memory
- logic_grid_mini
- multi_step_trivia
- lie_detector
- vote_the_winner
- sabotage_mode

==================================================
6. DUELS
==================================================

/duel
- 1v1 trivia duel
- Players stake Credits
- Winner takes the pot

==================================================
7. FACTIONS & FACTION WARS
==================================================

--------------------------------------------------
FACTION IDENTITY
--------------------------------------------------

/faction join
- Join a global faction

/faction leave
- Leave your current faction

/faction switch
- Premium only
- Switch factions
- Clears active war enrollment
- Has cooldown

/faction stats
- Shows your faction’s global stats
- Shows your contribution in this server

/faction server
- Server-only faction ranking
- Uses server activity logic
- Not the same as global /factions

/faction_balance
- Shows how many members of each faction are in the current server

/factions
- Official global faction rankings
- Based on match points from ranked wars

--------------------------------------------------
FACTION DISPLAY / SERVER OVERRIDES
--------------------------------------------------

/faction_role_link
- Link a Discord role to a faction

/faction_rename
- Rename faction display in this server only
- Does NOT change global faction identity

/faction_emoji
- Change faction display emoji in this server only
- Does NOT change global faction identity

--------------------------------------------------
FACTION RECRUITING
--------------------------------------------------

/faction_recruit
- Share your faction recruit code

/faction_redeem
- Redeem a faction recruit code in the same server

--------------------------------------------------
FACTION CHALLENGES / WARS
--------------------------------------------------

/faction_challenge create
- Start a duel challenge
- Premium + staff/Faction Leader
- Max 2 duels per server per UTC day

/faction_challenge create_royale
- Start a royale challenge
- Premium + staff/Faction Leader
- Max 1 royale per server per UTC day

/faction_challenge join
- Enroll in the active challenge
- Required to contribute

/faction_challenge status
- View current challenge status and scores

/faction_challenge history
- View past challenges in the current server

/faction_challenge end
- End the active challenge early
- Premium + staff/Faction Leader

--------------------------------------------------
FACTION CHALLENGE SETTINGS
--------------------------------------------------

Important create/create_royale concepts include: :contentReference[oaicite:2]{index=2}
- duration_hours
- challenge_mode:
  - ranked
  - unranked
- faction participants
- games / game_type filters
- scoring_mode:
  - total_points
  - avg_points
  - top_n_avg
- top_n
- point_goal
- max_per_team
- contribution_caps

Ranked wars:
- affect global standings
- are structured / official
- only allowed games count
- only enrolled players count

Unranked wars:
- local only
- do not affect global standings

==================================================
8. GROWTH & REFERRALS
==================================================

/invite
- Bot invite link + referral code

/invites
- Your referral stats

/claim_referral
- Link a server to a referrer
- Typically Administrator-gated

/invite_leaderboard
- Global referral leaderboard

==================================================
9. SERVER CONFIGURATION & AUTOMATION
==================================================

--------------------------------------------------
ANNOUNCEMENTS & CHANNELS
--------------------------------------------------

/set_announcement_channel
- Channel for game start and winner announcements

/set_announce_everyone
- Toggle @everyone on announcement posts

/set_automated_posts
- Master switch for automated channel posts

/set_welcome_channel
- Channel for welcome messages

/set_birthday_channel
- Channel for birthday posts

/set_story_channel
- Channel for story game

/set_leaderboard_channel
- Channel for leaderboard message

/set_achievement_channel
- Channel for achievement announcements

--------------------------------------------------
WELCOME / BIRTHDAY / REDIRECT CONTENT
--------------------------------------------------

/add_welcome_message
/remove_welcome_message
/list_welcome_messages

/add_birthday_message
/remove_birthday_message
/list_birthday_messages

/add_redirect
/remove_redirect

--------------------------------------------------
ROLES & STAFF CONTROLS
--------------------------------------------------

/set_manager_role
- Define Bot Manager role

/set_member_game_hosts
- Allow members to host supported games

/set_auto_role
/remove_auto_role
/sync_auto_role
/strip_role

--------------------------------------------------
FACTION SERVER SETTINGS
--------------------------------------------------

/set_faction_challenge_defaults
- Default game/scoring settings for wars

/set_faction_leader_role
- Role that can manage faction wars without full manager powers

/set_faction_reminder_channel
- Weekly faction reminder / nudge channel

/set_faction_victory_role
- Role assigned to winners of a faction challenge

--------------------------------------------------
LEADERBOARD / PROGRESSION SETTINGS
--------------------------------------------------

/set_leaderboard_cadence
- all_time
- weekly
- monthly

/adjustpoints
- Adjust Credits only
- Does not change Arena score or faction standings

/wipe_leaderboard
- Reset Credits, cadence counters, and Arena score for the server

--------------------------------------------------
ACHIEVEMENTS
--------------------------------------------------

/achievement create
/achievement delete
/achievement list
/achievement grant
/achievement revoke

/set_role_reward
- Grant a role reward for an achievement

--------------------------------------------------
SCHEDULING / PANELS
--------------------------------------------------

/schedule_announcement
- Schedule a future announcement

/setup_panels
- Post support / navigation panels

/story_export
- Export story, clear channel, restart

/listgames
- List active games in DB

/endgame
- Force-end an active game

==================================================
10. DEVELOPER / ADMIN ONLY
==================================================

/broadcast
- Send a message to all announcement channels
- Developer only

/admin_premium
- Grant/revoke premium manually
- Developer only

/premium_analytics
- Premium conversion / trigger analytics
- Developer only

/dev_points add
/dev_points set
- Developer point tools

/blacklist
/unblacklist
- Block or unblock user bot access
- Admin/staff-gated

==================================================
PERMISSION SUMMARY
==================================================

Typical default rules from your current docs: :contentReference[oaicite:3]{index=3}
- Most server config and hosted game setup require:
  - Administrator
  - Bot Manager role
- Some games can be opened to members via:
  - /set_member_game_hosts
- Faction challenge create/end usually require:
  - Premium
  - Administrator, Bot Manager, or configured Faction Leader
- /faction_challenge join and status are broadly available to eligible members
- Developer-only commands are restricted by DEVELOPER_ID / runtime checks

Always verify final permissions in:
- `deploy-commands.js`
- `src/events/interactionCreate.js`

==================================================
PLAYER MENTAL MODEL
==================================================

Use this simplified model when explaining commands to users:

1. Join a faction
2. Play games for Credits and Arena progress
3. Join active faction wars if you want to contribute
4. Use /factions for official global standings
5. Use /leaderboard for this server’s local activity board

==================================================
ADMIN MENTAL MODEL
==================================================

Use this simplified model when explaining commands to staff:

1. Configure channels and roles
2. Decide whether members can host games
3. Set up faction defaults and ranked rules
4. Create wars and manage participation
5. Use automation, scheduling, and announcements to keep the server active

==================================================
NOTES
==================================================

- `/factions` = official global faction standings
- `/leaderboard` = local server activity
- Server faction renames are display-only
- Ranked wars affect global standings
- Unranked wars are local only
- Featured daily games boost casual rewards only
- Premium should never distort war fairness

==================================================
MAINTENANCE
==================================================

When command definitions change:
1. update `deploy-commands.js`
2. redeploy slash commands
3. update README / COMMANDS.md
4. verify runtime checks in `interactionCreate.js`

If you want a machine-generated full option reference, keep that separate from this file. This file should stay readable and easy to scan.
