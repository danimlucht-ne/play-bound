# PlayBound Systems Diagram

==================================================
CORE STRUCTURE
==================================================

USER
 ├── Profile
 ├── Credits (casual)
 ├── Arena Score (competitive)
 └── Faction (global)

SERVER
 ├── Local faction display names
 ├── Active challenges
 └── Game sessions

==================================================
GAME SYSTEM
==================================================

Game Engine
 ├── Game Registry
 ├── Rotation Engine
 ├── Scoring Engine
 └── Session Manager

Flow:
User → Join Game → Play → Earn Points

==================================================
FACTION SYSTEM
==================================================

Global Factions
 ├── Eagles
 ├── Wolves
 └── Dragons

Server Layer
 ├── Rename factions
 ├── Assign roles
 └── Manage participation

==================================================
CHALLENGE SYSTEM
==================================================

Challenge
 ├── Type: Duel / Royale
 ├── Mode: Ranked / Casual
 ├── Allowed Games
 ├── Scoring Mode
 └── Roster

Flow:
Create → Join → Play → Score → End

==================================================
SCORING PIPELINE
==================================================

Game Played
 → Base Points
 → Check Enrollment
 → Check Game Eligibility
 → Add to User Score
 → Aggregate Team Score

Modes:
- total_points
- avg_points
- top_n_avg

==================================================
GLOBAL SYSTEM
==================================================

Each ranked challenge:
 → produces normalized result
 → awards match points

Leaderboard:
- based on match results
- not raw totals

==================================================
ROTATION SYSTEM
==================================================

Daily:
- select 4–6 active games
- ensure category balance
- assign featured game

Prevents:
- repetition
- meta abuse

==================================================
ONBOARDING SYSTEM
==================================================

User Flow:
Join → Pick Faction → Play → Learn → Compete

Tracked:
- hasJoinedFaction
- hasPlayedGame
- onboardingComplete

==================================================
PREMIUM SYSTEM
==================================================

Affects:
- rewards
- automation
- hosting tools

Does NOT affect:
- faction war scoring
- fairness