# Platform mini-games: scoring for Credits vs faction wars

This document describes **exactly** how PlayBound turns a `/playgame` session into (1) **server Credits / leaderboard points** and (2) **faction challenge / war** tallies, including how **top‑5 average** works for games like **Reaction Rush** and how **roster size** (5 vs 100 members) matters.

Implementation references (current codebase):

- Session end → `games/platformPlay.js` → `finishSession` → `capBase` → `awardPlatformGameScore` → `lib/db.js` → `addScore` → `lib/factionChallenge.js` → `recordFactionChallengePoints`
- War aggregation → `lib/factionChallenge.js` → `computeTeamValues` / `_topNAvg`
- Official ranked rules → `lib/rankedFactionWar.js`
- Per-game defaults & caps → `lib/gamePlatform/registry.js`

---

## 1. Two different numbers from one play

When a platform mini-game finishes, the bot computes a single integer: **faction base** (also called “base” in UI copy). That value is used in **two separate ways**:

### 1.1 Credits (server economy / `/leaderboard`)

`addScore` in `lib/db.js` builds **display points** from:

- **Base** = raw mini-game outcome (integer ≥ 0).
- **+ streak bonus** (capped), then × **double-points pass**, × **Premium**, × **host aura** (if the session host is Premium).
- **+ casual-only featured bonus** (when the game is “featured” and eligible) — added **after** those multipliers.

So streaks, Premium, passes, and featured bonuses **inflate Credits** but **do not** change faction war input.

### 1.2 Faction war ledger (challenge score)

The amount passed to `recordFactionChallengePoints` is **only** the **base** integer (no streak / Premium / pass / aura):

```327:328:c:\Users\danim\Documents\Programming\discord-bot\discord-bot-games\lib\db.js
    /** Faction wars only credit the base game award (no streak / premium / pass / aura), so balances can’t be inflated into war scores. */
    const factionChallengeBasePoints = Math.max(0, Math.floor(Number(points)));
```

**Non-faction play:** If the user has **no faction**, or there is **no active challenge**, or they are **not enrolled**, or the **tag is not allowed** for that war, the play still awards **Credits** as above; **no** (or zero) faction war credit is applied. The user may see an ephemeral explanation when credit was skipped.

---

## 2. Per-session cap (platform games only)

Before calling `addScore`, `finishSession` clamps base with `capBase` using each game’s `balancingConfig.sessionCapFaction` in the registry (if set). That is a **per `/playgame` match** ceiling on the **base** that can feed both Credits and war credit for that session.

---

## 3. Faction war: what gets stored per player

When a play **does** credit the active challenge:

1. **`rawScoresByUser[userId]`** increases by the **full** base for that session (uncapped by per-tag limits).
2. **`scoresByUser[userId]`** increases by the **counted** amount for that session — on **ranked** wars this may be **less** than base if the user has hit the **per-tag contribution cap** for that game tag (`contributionCapsByTag` + `countedPointsByUserTag` in `recordFactionChallengePoints`).

**Official team scoring for the war uses `scoresByUser` (counted), not raw.**  
(End-of-war snapshots still record raw team sums for display/history.)

---

## 4. How “top 5 average” works (all games, same formula)

For each faction, the war engine collects one **counted total per enrolled user** (sum of all their credited plays during that war for allowed tags).

```492:522:c:\Users\danim\Documents\Programming\discord-bot\discord-bot-games\lib\factionChallenge.js
function _scoresRawForTeam(challenge, factionName) {
    const ids = getParticipantIds(challenge, factionName);
    const arr = [];
    for (const uid of ids) {
        arr.push(getScoreByUser(challenge, uid));
    }
    return arr;
}

function _topNAvg(values, n) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => b - a);
    const take = Math.min(n, sorted.length);
    const top = sorted.slice(0, take);
    return top.reduce((a, b) => a + b, 0) / take;
}
```

- **Official ranked wars** fix **N = 5** and mode **`top_n_avg`** (`lib/rankedFactionWar.js`).
- The **official score** for a side is: **average of the top min(5, number of enrolled players) counted totals** (not “average of whole Discord membership”).

**Important:** There is **no separate** “Reaction Rush average” formula. Reaction Rush only determines **how many base points one session adds to the one player who gets credit** for that session. Those points **accumulate** on that user’s war total like any other game; the war then takes **top‑5 average** over enrolled players.

---

## 5. Reaction Rush: who gets credit, and how many base points

Configured defaults (`lib/gamePlatform/registry.js`): `matchRounds: 3`, `defaultCasualRewards.first: 12`, `second: 5`, `sessionCapFaction: 24`.

### 5.1 Multi-round (`matchRounds > 1`, default)

- Only the user who **started** the thread (`/playgame` host) may answer.
- Each **round** they clear first adds **`first`** base (default **12**) to a **running total** for that match.
- The **entire match** ends with **one** `finishSession` call whose base = **sum of rounds** (then **session cap**).
- **Faction war:** that sum is added to **the host’s** `scoresByUser` / `rawScoresByUser` (subject to per-tag cap), **not** split across people in the thread.

So for top‑5 average: if five different players each run Reaction Rush matches, each player’s **own** session totals accrue separately; the faction’s official score uses the **best five players’ totals**, not an average inside one thread.

### 5.2 Single-round (`matchRounds === 1`)

- **Anyone** in the thread can buzz in.
- First correct answer ends the match.
- Base for that session:
  - **`first`** if the winner is the **host**,
  - **`second`** if the winner is someone else (default **5**).
- **Faction war:** credit goes to **whoever won the click** (`userId` passed to scoring), not necessarily the host.

---

## 6. “5 people vs 100 people” — what actually matters

Discord faction size is **not** the same as **war roster** or **scoring population**.

### 6.1 Roster cap (`max_per_team`)

Ranked wars require a **roster cap** (default **7** if not overridden via server defaults or `/faction_challenge create`). Only users who **`/faction_challenge join`** and hold a roster spot can accumulate war score. If the roster is full, additional faction members **cannot** add counted points until the war changes.

So a server with **100** people in a faction might still only have **7** scorers; a server with **5** might have **5** if all join.

### 6.2 Top‑5 average vs headcount

- If a faction has **≤ 5** enrolled players, the official value is the average of **all of them** (each contributes their full counted total into the sorted list; `take = min(5, n)`).
- If a faction has **> 5** enrolled players, only the **top five counted totals** matter for the **official** average. Extra enrolled players do **not** increase the numerator unless they **outscore** someone in the current top five.

**No normalization by Discord member count** is applied: the design is **capped roster + top‑5 average + per-tag caps**, not “points per capita.”

### 6.3 Cross-server fairness

Each **guild** runs its own challenge document. **Global** faction standings (for ranked) use **match points** (+3 win, +1 tie, etc.) when wars end — not a direct comparison of raw mini-game totals across servers. See `buildEndgameGlobalMergePayload` in `lib/factionChallenge.js`.

---

## 7. Per-game: base formula (one `/playgame` match)

Unless noted, only the **session host** controls the session (`session.userId`). Values below use **registry defaults**; admins can override via game platform settings.

| Tag | Ranked war eligible? | How base is computed (high level) |
|-----|----------------------|-----------------------------------|
| `risk_roll` | Yes | Die game: bust → participate (~3); max rounds or lock → `defaultBasePoints` + f(total) with formulas in `handleRiskRoll`; capped by `sessionCapFaction`. |
| `target_21` | Yes | **Multiple hands** (`matchRounds` default 3): per hand bust / 21 / stand formulas; **match base = sum of hands**; then `capBase`. |
| `dice_duel` | Yes | **Multiple duels**: beat house → `defaultBasePoints + 4`, tie → `defaultBasePoints`, lose → participate; triples add casual bonus (+5) or +3 if `comboBonusRanked`; **sum** duels. |
| `king_of_the_hill` | Yes | Up to `rounds` (4): `defaultBasePoints + bestBeat * 3`. |
| `high_card_blitz` | Yes | **Multiple hands**: win → `defaultBasePoints + 4`, loss → 2; double down adjusts (ranked may ignore ranked double-down bonus per config); **sum** hands. |
| `push_luck_deck` | Yes | **Multiple hands**: bust → 1; stop → `defaultBasePoints + bank`; bank cap `rankedBankCap` (18); **sum** hands. |
| `combo_builder` | Yes | **Multiple draws** (`matchRounds`): each draw `defaultBasePoints + tier * 3` (tier from poker-like rules on five d13 values); **sum** draws. |
| `reaction_rush` | Yes | See **§5**; **sum** of round bases in multi-round; single-round host/guest **first**/**second**. |
| `closest_guess` | Yes | Thread guesses; winner (or nobody): exact / distance formula from `defaultBasePoints`, `exactHitBonus`, etc. |
| `last_man_standing` | Yes | Placement table `placementTable`: win 1st / 2nd surviving / eliminated default 12 / 6 / 3. |
| `pattern_memory` | Yes | Fail → participate (~2); full sequence → `defaultBasePoints + length * factionPointsPerRound` (4 per step default). |
| `logic_grid_mini` | Yes | **Multiple steps**: each correct + `max(3, round(defaultBasePoints / chainLength) + 1)`; wrong → keep cumulative or 3 if none; all correct → cumulative. |
| `multi_step_trivia` | Yes | Wrong: partial from `tierPoints` by steps cleared, or 2 if none; perfect chain: tier by total correct. Steps from Open Trivia DB or fallback pool. |
| `lie_detector` | **No** (`rankedEligible: false`) | Correct → `detect` (~10); wrong → 3. Does **not** credit **ranked** wars. |
| `vote_the_winner` | **No** | After 30s: `defaultBasePoints + min(10, totalVotes)`. Open thread voting; not ranked war eligible. |
| `sabotage_mode` | **No** | Role-based; base from `teamWin` + bonuses; not ranked war eligible. |

**Hosted commands** (`/trivia`, `/triviasprint`, etc.): classified as **hosted** in `lib/gameClassification.js`. They **never** credit **official ranked** wars. They may still affect **Credits** and, if configured, **unranked** challenges.

---

## 8. End of war: winner vs global standings

Inside one challenge, the winner is determined by comparing each team’s **official** aggregate (`computeTeamValues` → `_valueForRaw` with `scoringMode`).

- **Ranked:** mode is fixed to **top‑5 average** of **counted** per-user totals.
- **Unranked:** server defaults may allow `total_points` or `avg_points` — those modes behave differently and can favor larger enrolled participation; see `FactionChallengeSchema.scoringMode` in `models.js`.

When a **ranked** war ends, **global** faction records receive **match points** (and win/loss/tie counters, raw war contribution totals, etc.) — not a transfer of the full raw mini-game sum as the primary standing.

---

## 9. Quick FAQ

**Q: Does Reaction Rush average reaction time across players?**  
**A:** No. It awards a **base integer** to **one user per finished match** (host in multi-round, or the buzzer in single-round). The war’s “average” is **top‑5 average of those users’ cumulative counted war points**, mixed with all other allowed games they played.

**Q: Is a 100-person faction 20× stronger than a 5-person faction?**  
**A:** Only up to **roster cap** and **top‑5**: at most **five** counted totals drive the official average, and only **roster-capped** joiners can score.

**Q: Are Credits and war score the same number for a play?**  
**A:** The **base** input is the same before caps; **Credits** on the profile are usually **higher** after streak / Premium / pass / featured bonus; **war** uses **base only** (then per-tag counted cap on ranked).

---

*Generated from codebase behavior; if logic changes, update this file alongside `games/platformPlay.js`, `lib/factionChallenge.js`, `lib/db.js`, and `lib/gamePlatform/registry.js`.*
