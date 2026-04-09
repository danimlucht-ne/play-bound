# PlayBound — Faction commands (step-by-step)

How faction-related slash commands work and what each parameter means.

---

## Big picture

1. **Global factions** live in the database (`Faction`). Each user has at most **one** global faction (`User.faction`). **`/factions`** is the **global** leaderboard (by competitive / faction totals).
2. **This server** can **rename** or **re-emoji** the six built-in teams for display (`/faction_rename`, `/faction_emoji`). **`/faction server`** and **`/faction_balance`** are **server-only** views.
3. **Faction challenges (“wars”)** are **per-server, time-limited events**. Only players who **`/faction_challenge join`** are **enrolled**; only their scores from **allowed game types** count toward the **war total** (shown in **`/faction_challenge status`**).
4. **Who can manage what:** **Administrator** or **Bot Manager** (`/set_manager_role`) for most setup commands. **Faction challenges** (`/faction_challenge` create / end) can also be run by members with the configured **Faction Leader** role (`/set_faction_leader_role`) — that role does **not** grant other admin powers. **Premium** is required for **`/faction switch`**, **`/faction_challenge create`**, **`/faction_challenge create_royale`**, and **`/faction_challenge end`** (create/end also need admin, Bot Manager, or Faction Leader as above).

---

## `/factions`

- **Steps:** Run the command; no options.
- **Meaning:** Shows the **global** faction leaderboard (all servers that count toward globals).

---

## `/faction_balance`

- **Steps:** Run; no options.
- **Meaning:** Shows **how many members** of each faction are in **this server** (headcount only).

---

## `/faction` (subcommands)

### `join`

1. Pick **`name`** (autocomplete: valid faction names).
2. You must **not** already be in a faction (otherwise leave or Premium **switch**).
3. If the name matches an **official** team (**Phoenixes**, **Unicorns**, **Fireflies**, **Dragons**, **Wolves**, **Eagles**) and the DB row is missing, the bot **auto-creates** that default faction doc.
4. **Legacy-only:** if your database still has other `Faction` rows from the past, **`/faction join`** can target those by **exact** name as well.

**`name`:** Exact global faction name to join.

### `leave`

1. Run; no options.
2. Clears your faction; if a war was active, you’re **unenrolled** — run **`/faction_challenge join`** again after rejoining a team.

### `switch` (Premium)

1. Pick **`name`** (new faction).
2. Requires **Premium**; **7-day cooldown** between switches.
3. Adjusts global totals for the old faction; **removes you from war enrollment**; syncs **linked roles** if configured.

**`name`:** Faction to switch to.

### `stats`

1. Run; no options.
2. Requires being **in** a faction.
3. Shows **global** faction stats plus **your** contribution in **this server**.

### `server`

1. Run; no options.
2. Ranks factions in **this server** by members’ **total points** (server leaderboard logic — **not** the same as global **`/factions`**).

---

## `/faction_recruit`

1. You must be in one of the **six official** global factions (see **`/faction join`** autocomplete).
2. Bot gives you a **short-lived code** (~**14 days**).
3. **Recruits:** `/faction join` → your faction → **`/faction_redeem code:…`** in the **same server** where the code was created.
4. Premium recruiters get **2×** on related rewards.

**No parameters** on recruit; redeem uses **`code`** below.

---

## `/faction_redeem`

1. Get **`code`** from a recruiter’s **`/faction_recruit`**.
2. You must **already** be in **that** faction in **this** server.
3. Code must be from **this** server; you can’t redeem your **own** code; one recruit credit per recruiter/recruit pair.

**`code`:** The `FR…` recruit token.

---

## `/faction_role_link` (Administrator or Bot Manager)

1. Choose **`faction`:** one of the **six official** teams (fixed choices in slash UI).
2. Choose **`role`:** Discord role to assign.
3. **Meaning:** When someone **joins** or **switches** into that faction (in this server), the bot can **sync** that role.

---

## `/faction_rename` (Administrator or Bot Manager)

1. **`faction`:** one of the six official teams.
2. **`name`:** Display name for **this server** only (e.g. in **`/faction server`**, **`/faction_balance`**), max 80 chars.

---

## `/faction_emoji` (Administrator or Bot Manager)

1. **`faction`:** one of the six official teams.
2. **`emoji`:** Unicode or `<:custom:id>` from **this** server (optional if only clearing).
3. **`clear`:** If true, drop custom emoji and use **global** default again.

---

## `/set_faction_reminder_channel` (admin/manager command path)

1. Optional **`channel`:** Text channel for a **weekly Sunday** “faction war” nudge.
2. **Omit channel** → turns the reminder **off**.

---

## `/set_faction_victory_role` (admin/manager)

1. Optional **`role`:** Role granted to **enrolled winners** when a challenge **ends**.
2. **Omit role** → **disable** that reward.

---

## `/set_faction_leader_role` (Administrator or Bot Manager)

1. Optional **`role`:** Discord role whose members may **create** and **end** faction challenges (same **Premium** and **daily limits** as everyone else).
2. **Omit role** → clear the Faction Leader role (no one has challenge-only powers via this path).
3. Does **not** grant access to points, wipes, channels, manager role, redirects, or other server admin tools.

---

## `/set_faction_challenge_defaults` (Administrator or Bot Manager)

Sets **defaults** used when **`/faction_challenge create`** (or **`create_royale`**) **omits** optional fields.

| Option | Meaning |
|--------|--------|
| **`clear: true`** | Reset to built-in defaults: **`game_type`** = all tagged mini-games, **`scoring_mode`** = `top_n_avg`, **`top_n`** = **5**. |
| **`game_type`** | Default filter: `all`, `trivia`, `triviasprint`, `serverdle`, `guessthenumber`, `moviequotes`, `unscramble`, `caption`, `namethattune`, `spellingbee`. |
| **`scoring_mode`** | `total_points` (sum of enrolled), `avg_points` (average of members with >0), `top_n_avg` (average of top N scores). |
| **`top_n`** | Used when scoring mode is **top_n_avg** (1–50). |

If you pass **no** options and **not** `clear`, the bot typically **shows current** defaults.

---

## `/faction_challenge`

**Permissions:** **`create`** / **`create_royale`:** **Premium** + **Administrator**, **Bot Manager**, or **Faction Leader** (`/set_faction_leader_role`). **`join`** / **`status`** / **`history`:** anyone (subject to normal checks). **`end`:** **Premium** + **Administrator**, **Bot Manager**, or **Faction Leader**.  
Only **one** active challenge per server; end it before starting another.

### `create` (2-team war)

**Steps:**

1. **`faction_a`**, **`faction_b`:** Two **different** official factions.
2. **`duration_hours`:** Length of the **scoring window** once live (1–720).
3. Optional **`game_type`:** Which games count; if omitted → server default or built-in **`all`**.
4. Optional **`scoring_mode`:** If omitted → default or built-in **`top_n_avg`**.
5. Optional **`top_n`:** For **top_n_avg** (default **5** if not set).
6. Optional **`point_goal`:** If set (≥50), war can end early when a team’s **enrolled war total** reaches this.
7. Optional **`max_per_team`:** Roster cap (1–25); only the **first N** joiners per side can score.

Wars **start immediately** when created (no delayed start from slash), so **`/playgame`** rotation and filters match the day the war goes live.

### `create_royale` (all six official factions)

Same optional parameters as **`create`**, except **no** `faction_a` / `faction_b` — every official team is on the roster. **`join`** requires being in one of those factions.

### `join`

1. There must be an **active** challenge.
2. You must **`/faction join`** a faction **on the war roster** first.
3. If **`max_per_team`** is set and your side is full, you **cannot** enroll.

### `status`

- Shows **live** scores, filter, end time, optional **point goal** and **roster cap**, enrolled counts.

### `history`

- **`limit`:** 1–15 ended wars (default 10), newest first.

### `end`

- **Premium** + **Administrator**, **Bot Manager**, or **Faction Leader**; ends the active challenge, picks **winner** (or tie), applies **victory role** if configured.

---

## Quick reference: war parameters

| Parameter | Meaning |
|-----------|--------|
| **`duration_hours`** | How long the war runs **after** it goes active. |
| **`game_type`** | Which mini-games feed the war score. |
| **`scoring_mode`** | **total_points** vs **avg_points** vs **top_n_avg**. |
| **`top_n`** | For **top_n_avg**, how many top scores enter the average. |
| **`point_goal`** | Optional early end when enrolled **war total** hits the goal. |
| **`max_per_team`** | Max **enrolled** players per faction (first-come). |

---

*Generated from PlayBound bot behavior (`deploy-commands.js`, `interactionCreate.js`, and related libs). Update this file when commands change.*
