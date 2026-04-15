# PlayBound Scoring Guide

How points are earned, how faction wars are scored, and how server size affects fairness.

**See also:** [`FACTIONS_AND_SCORING_INDEX.md`](./FACTIONS_AND_SCORING_INDEX.md) · [`factioninstructions.md`](./factioninstructions.md) (slash commands) · [`platform-game-faction-scoring.md`](./platform-game-faction-scoring.md) (implementation detail for `/playgame` and wars).

---

## Part 1: How Players Earn Points

### Hosted Games (slash commands like /trivia, /serverdle, etc.)

These are server-hosted games started by an admin or manager. Points are awarded by placement:

| Placement | Points |
|-----------|--------|
| 1st place | 25 |
| 2nd place | 15 |
| 3rd place | 5 |
| Participated (no podium) | 1 |

The host can customize these values when starting the game.

### Platform Games (/playgame)

These are the official mini-games that rotate daily. Each game has a base point value (6-12 points depending on the game). Examples:

| Game | Category | Base Points | Casual Win Reward |
|------|----------|-------------|-------------------|
| Risk Roll | Dice | 8 | 12 |
| Target 21 | Dice | 8 | 14 |
| Dice Duel | Dice | 10 | 12 |
| King of the Hill | Dice | 9 | 14 |
| High Card Blitz | Cards | 7 | 11 |
| Push Your Luck Deck | Cards | 8 | 13 |
| Combo Builder | Cards | 9 | 15 |
| Reaction Rush | Reaction | 6 | 12 (1st) / 5 (2nd) / 2 (3rd) |
| Closest Guess | Guess | 7 | 12 |
| Last Man Standing | Elimination | 12 | 18 |
| Pattern Memory | Puzzle | 8 | 10 |
| Logic Grid Mini | Puzzle | 8 | 14 |
| Multi-Step Trivia | Trivia | 10 | 3 per step + 8 chain bonus |

Social games (Lie Detector, Vote the Winner, Sabotage Mode) are NOT ranked-eligible and do not count toward faction wars.

### Point Multipliers (Credits only, NOT faction war base)

After the base points are determined, these multipliers apply to the player's personal Credits balance:

1. **Streak bonus**: +1 per consecutive active day (capped at +5 free, +12 Premium)
2. **Double Points Pass**: 2x if the player has a consumable active
3. **Premium multiplier**: 2x if the player has Premium
4. **Host Aura**: 1.35x if the game host has Premium (or someone used the thread boost button)
5. **Featured bonus**: Up to +50% casual bonus if the game is the daily featured game

**Important**: None of these multipliers affect faction war scoring. Wars use only the raw base points.

---

## Part 2: How Faction Wars Work

### Creating a War

A server admin (with Premium) creates a faction challenge:
- **Duel**: Two factions face off (e.g., Dragons vs Wolves)
- **Royale**: All three factions compete (Dragons vs Wolves vs Eagles)
- **Daily limit**: 3 wars per server per UTC day (typically 2 duels + 1 royale)

### Enrolling

Players use `/faction_challenge join` to enroll for their faction. Enrollment is capped:
- **Ranked wars**: Default roster cap of 7 per team (configurable per server, max 25)
- **Unranked wars**: No roster cap required

### Scoring During a War

When an enrolled player plays a ranked-eligible game during an active war:
1. Their **base game points** (before any multipliers) are credited to the war ledger
2. Only official `/playgame` platform games count for ranked wars
3. Hosted games (/trivia, /serverdle, etc.) do NOT count for ranked wars
4. Optional per-game contribution caps prevent one game type from dominating (e.g., "trivia:500" means max 500 points from trivia per player)

### Calculating the Winner

**Ranked wars use "Top 5 Average" scoring (fixed, cannot be changed):**

1. Take each team's enrolled players' war scores
2. Sort by score descending
3. Take the top 5 scores
4. Average them
5. Highest average wins

If a team has fewer than 5 players with scores, only those with scores are averaged.

### Match Points (Global Standings)

The war result awards match points to the global faction standings:

| Result | Match Points |
|--------|-------------|
| Win | +3 |
| Tie | +1 |
| Loss | +0 |

These match points are the primary metric on the global `/factions` leaderboard.

---

## Part 3: Fairness Across Server Sizes

### Example: 1 Player per Faction

Server with 3 members (1 Dragon, 1 Wolf, 1 Eagle):

- Dragon player scores 45 base points during the war
- Wolf player scores 38 base points
- Eagle player scores 52 base points

Top-5 average: Dragon = 45, Wolf = 38, Eagle = 52
Winner: Eagles (+3 match points globally)

### Example: 10 Players per Faction

Server with 30 members (10 per faction), roster cap = 7:

Only 7 can enroll per team. Say Dragons enroll 7, Wolves enroll 7.
Dragon scores: [120, 95, 80, 65, 50, 30, 10]
Wolf scores: [110, 100, 85, 70, 45, 25, 5]

Top 5 average:
- Dragons: (120 + 95 + 80 + 65 + 50) / 5 = 82.0
- Wolves: (110 + 100 + 85 + 70 + 45) / 5 = 82.0

Result: Tie — each faction gets +1 match point.

### Example: 100 Players per Faction

Server with 300 members (100 per faction), roster cap = 7:

Still only 7 can enroll per team. The other 93 members per faction cannot participate in the war. The scoring is identical to the 10-player example — only the top 5 of the 7 enrolled matter.

### Why This Is Fair

| Mechanism | Effect |
|-----------|--------|
| Roster cap (default 7) | Large servers can't flood a war with extra members |
| Top-5 averaging | Only the best 5 scores matter, not total headcount |
| Base points only | Premium/streak/aura multipliers stripped from war scoring |
| 3 wars/day/server cap | No server can generate unlimited match points |
| Match points per war (not per player) | A win is +3 regardless of team size |
| Only /playgame counts | Hosted games can't be used to farm war points |

### The One Advantage Large Servers Have

A faction with presence in 50 servers gets up to 150 war opportunities per day (50 servers × 3 wars). A faction in 5 servers gets 15. This is intentional — it rewards faction growth and community building, not individual server size.

---

## Part 4: Unranked (Casual) Wars

Unranked wars are local to the server and do NOT affect global faction standings. They allow:
- Any scoring mode (total, average, or top-N)
- No roster cap required
- Point goals (first team to X points wins)
- Hosted games can count
- No match points awarded

These are for fun and server events, not competitive global rankings.
