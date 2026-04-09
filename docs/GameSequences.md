# PlayBound Game & Challenge Flow

==================================================
USER FLOW
==================================================

1. User joins server
2. User selects faction
3. User plays a game
4. User earns rewards
5. User joins a challenge
6. User contributes to faction

==================================================
GAME FLOW
==================================================

Start Game
 → Players join
 → Game runs
 → Results calculated
 → Points awarded

If challenge active:
 → Check enrollment
 → Check eligibility
 → Add to war score

==================================================
SCORING FLOW
==================================================

Game Result
 → Base Points
 → Stored per user

Casual:
 → apply multipliers
 → award credits

Faction War:
 → base points only
 → no multipliers

==================================================
CHALLENGE FLOW
==================================================

Create Challenge
 → Set rules
 → Players join
 → Games played
 → Scores accumulate
 → Challenge ends

==================================================
TEAM SCORING
==================================================

total_points
- sum of all players

avg_points
- average of active players

top_n_avg
- average of top N players

==================================================
GLOBAL FLOW
==================================================

Challenge ends
 → Normalize score
 → Determine winner
 → Award match points

Leaderboard updates

==================================================
ROTATION FLOW
==================================================

Daily:
 → Select game pool
 → Tag eligible games
 → Assign featured game

==================================================
ONBOARDING FLOW
==================================================

Welcome
 → Pick faction
 → Play first game
 → Show rewards
 → Introduce challenges

==================================================
RULES
==================================================

- Only base points count in wars
- Only enrolled players count
- Only allowed games count
- Global scores must be normalized

==================================================
RESULT
==================================================

A system that is:
- fair across server sizes
- competitive
- repeatable
- scalable