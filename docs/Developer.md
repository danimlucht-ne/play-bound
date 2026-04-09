
---

# 🧑‍💻 DEV.md (DEVELOPER + SETUP)

# PlayBound Developer Guide

==================================================
STACK
==================================================

Backend:
- Node.js
- Express
- MongoDB

Interface:
- Discord bot (primary)
- Optional web UI

==================================================
SETUP
==================================================

1. Install dependencies
npm install

2. Configure environment variables
- DISCORD_TOKEN
- CLIENT_ID
- MONGO_URI

3. Deploy commands
npm run deploy:commands

4. Start server
npm start

==================================================
DEPLOY METHOD: LOCAL -> VM -> PM2
==================================================

Use this flow when shipping new PlayBound code to production.

LOCAL MACHINE
-------------

1. Review the working tree

```bash
cd /path/to/play-bound
git status
```

2. Commit and push

```bash
git add .
git commit -m "Describe the PlayBound change"
git push origin main
```

VM / PRODUCTION SERVER
----------------------

1. Pull the new code

```bash
cd /path/to/play-bound
git pull origin main
```

2. Install dependencies

```bash
npm install
```

3. Deploy Discord slash commands

Run this when commands changed, command options changed, or when you are not sure.

```bash
node deploy-commands.js
```

4. Run the go-live test suite

```bash
npm run test:go-live
```

5. Optional: run real Mongo integration tests

Only run this against an isolated test database, never against the production DB name.

```bash
export PLAYBOUND_ALLOW_DB_TESTS=1
export TEST_MONGO_URI="$MONGO_URI"
export TEST_MONGO_DB="PlayBoundTest"
npm run test:db:integration
```

6. Restart PlayBound with PM2

```bash
npx pm2 restart playbound
npx pm2 logs playbound --lines 100
```

Use `--update-env` if environment variables changed:

```bash
npx pm2 restart playbound --update-env
npx pm2 logs playbound --lines 100
```

SUPPORT SERVER PANEL REFRESH
----------------------------

After deploying support panel or bootstrap changes, refresh the panels in Discord.

Fresh panel channels only:

```text
/setup_panels wipe_panel_channels:true
```

Full managed support-server channel wipe and repin:

```text
/bootstrap_support_server wipe_all_managed_channels:true force_repin:true
```

DEPLOY SAFETY NOTES
-------------------

- Always run `npm run test:go-live` before restarting PM2.
- Run `node deploy-commands.js` after editing `deploy-commands.js` or command behavior.
- Use the DB integration test for scoring, faction, economy, race-condition, or persistence changes.
- Watch PM2 logs for startup errors, Mongo connection errors, command registration issues, and recovery logs.
- Brief `/health` 503 responses during restart are expected while graceful shutdown is draining.

==================================================
CORE MODULES
==================================================

Game Engine
- Runs game sessions
- Emits base points

Scoring Engine
- Calculates user totals
- Removes multipliers for faction wars

Faction Engine
- Tracks global factions
- Handles aggregation

Challenge Engine
- Manages wars
- Enforces rules

Rotation Engine
- Selects daily games
- Prevents repetition

==================================================
KEY FUNCTIONS
==================================================

addScore(user, points)
- calculates total score with modifiers

recordFactionChallengePoints()
- only base points
- only if enrolled
- only if eligible game

computeTeamValues()
- applies scoring mode

applyEndedChallengeToGlobalTotals()
- converts challenge result → global score

==================================================
CRITICAL RULES
==================================================

- War scoring uses BASE points only
- Enrollment is required
- Game eligibility is enforced
- Global scoring must be normalized
- Premium NEVER affects war scoring

==================================================
DATA MODELS
==================================================

User
- id
- credits
- arenaScore
- faction

Challenge
- id
- mode (ranked/unranked)
- teams
- scoresByUser
- scoringMode

Faction
- name
- matchPoints
- wins/losses

==================================================
ADMIN CONTROLS
==================================================

Must support:

- create challenge
- end challenge
- set scoring mode
- set roster cap
- set allowed games
- set contribution caps

==================================================
OPERATIONS (PRODUCTION)
==================================================

Graceful shutdown (SIGINT/SIGTERM), health 503 while draining, slash kill switches,
maintenance windows, ops JSON logs, and presence hints are documented here:

docs/OPERATIONS_AND_SHUTDOWN.md

.env.example — sections: Maintenance, Slash command kill switch,
Graceful shutdown & ops visibility.

==================================================
TESTING PRIORITIES
==================================================

- scoring fairness
- multi-server balance
- rotation behavior
- challenge integrity

==================================================
PHILOSOPHY
==================================================

Every system must answer:

"Does this improve fairness or fun?"

If not → remove it.
