# Operations, graceful shutdown, and kill switches

This document is for developers and operators who run PlayBound in production or staging. It describes behavior that is implemented in code (not aspirational).

For environment variable names and examples, see **`.env.example`** (sections *Maintenance*, *Slash command kill switch*, *Graceful shutdown & ops visibility*).

---

## 1. Graceful shutdown

### Triggers

The process registers handlers for **`SIGINT`** (Ctrl+C locally, typical Docker/K8s stop) and **`SIGTERM`** (common production default).

### What happens (order)

1. **`shuttingDown`** flips to true (see `lib/botLifecycle.js`). New guild work is rejected early (see below).
2. If the Discord client is ready, presence is set to a short "Restarting..." style activity.
3. **Shutdown hooks** run (currently: **`clearTimeout`** on every entry in **`state.scheduledGames`** so delayed starts do not fire after exit).
4. The **HTTP server** from Express is closed (`server.close()`), so new TCP connections are refused; in-flight requests finish unless the drain timer fires.
5. **`client.destroy()`** disconnects the Discord session.
6. **`process.exit(0)`** on success.

If teardown takes longer than the drain budget, the process **`process.exit(1)`** (forced).

### Environment

| Variable | Purpose |
|----------|---------|
| `PLAYBOUND_SHUTDOWN_USER_MESSAGE` | Text users see when they hit an interaction during drain (also accepts synonym `PLAYBOUND_SHUTDOWN_MESSAGE`). |
| `PLAYBOUND_SHUTDOWN_DRAIN_MS` | Max milliseconds to wait for HTTP close + Discord destroy (default **15000**). |

### Extending cleanup

Call **`registerShutdownHook(fn)`** from `lib/botLifecycle.js` during startup (before signals matter). The function may be sync or async. Failures are logged and do not block other hooks.

**Not stopped automatically:** `node-cron` tasks started in `ready.js` are not individually cancelled; the process exit ends them. If you add long-lived intervals, clear them in a shutdown hook.

---

## 2. Health checks and load balancers

| Route | Normal | While shutting down |
|-------|--------|---------------------|
| `GET /health` | **200** `{ "status": "ok" }` | **503** `{ "status": "shutting_down" }` |
| `GET /api/health` | **200** `{ "status": "ok", "discordReady": ... }` | **503** with `status: "shutting_down"` |

**Uptime monitors:** If you alert on **any non-200**, expect brief **503** during deploys/restarts. Options:

- Point the monitor at a path that must stay up for "process alive" only and accept **503** as "draining but expected", or
- Use a platform health check that tolerates short **503** during rollout, or
- Monitor **`/webhook`** with a **GET** (returns 200) if you only care that Express is listening (does not reflect Discord readiness).

See also **`docs/MONITORING.md`**.

---

## 3. Behavior while draining

- **`interactionCreate`:** After resolving **`guildId`**, if shutting down and the interaction is repliable, the bot replies with the shutdown message (ephemeral when possible, or `editReply` if already deferred) and **returns** before user DB work and game handlers.
- **`messageCreate`:** If shutting down, the handler **returns** immediately (no Mongo, no in-channel game logic).

DMs without **`guildId`** are unchanged by the interaction guard (there is no guild-scoped early return path).

---

## 4. Kill switches and maintenance (summary)

These are configured via env; details and messages are in **`.env.example`**.

- **Master game slash disable:** `PLAYBOUND_DISABLE_ALL_GAMES` (and synonyms/time-box variants). Blocks the built-in list of competitive/game slash commands; not every command.
- **Per-command disable:** `PLAYBOUND_DISABLED_SLASH_COMMANDS` (comma/space-separated names).
- **Maintenance windows:** `PLAYBOUND_MAINTENANCE_SCHEDULE_*` blocks certain schedules and immediate starts per `lib/maintenanceScheduling.js`.

Developers can allow listed bot developers past the slash gate with **`PLAYBOUND_COMMAND_GATE_BYPASS_DEVELOPER`** (see `.env.example`).

### Templated maintenance broadcast (all servers)

When **`PLAYBOUND_MAINTENANCE_AUTO_BROADCAST=1`** and the maintenance window env vars define a valid range, the bot posts a **fixed-template** embed to each guild's **announcement channel** (the same field set by **`/set_announcement_channel`**): UTC start/end, approximate duration, and short guidance about new games / scheduling. No manual copy-paste per server.

Requirements per guild:

- **`announceChannel`** must be set.
- **Automated server posts** must be on (same master switch as other bot-driven announce-channel posts; not **`/set_automated_posts`** off).

**`@everyone`** on that post uses the same rule as other announcement-channel posts: guild **`announcePingEveryone`** (legacy default is to ping).

**Dedupe:** `MaintenanceBroadcastLog` in Mongo (`maintenancebroadcastlogs`) — at most one **`advance`** row per `(guildId, windowStartMs, windowEndMs)`, so process restarts do not re-broadcast the same window.

**When it sends:** Only while **`now < maintenance start`** (advance notice). Optional **`PLAYBOUND_MAINTENANCE_BROADCAST_MAX_LEAD_MS`** (e.g. `86400000` for 24h) means "do not send until we are inside that many milliseconds of start." If omitted, the first eligible **ready** or hourly tick may send even if maintenance is days away.

**When it runs:** Once after **`ready`** (after scheduled games resume) and **hourly at minute 5 UTC** (`5 * * * *`). If a send fails, the dedupe document is removed so a later run can retry.

Optional **`PLAYBOUND_MAINTENANCE_BROADCAST_FOOTER`** appends a paragraph to the embed. Successful sends also emit **`maintenance_broadcast`** in structured ops logs when ops logging is enabled.

---

## 5. Discord presence (ops hints)

On **`ready`**, presence is set by **`lib/opsPresence.js`**: it prefers a maintenance-limited or kill-switch-oriented status line when applicable; otherwise the default help line. Changing env at runtime **without** a process restart does not refresh presence until the next boot.

---

## 6. Structured ops logging

When **`PLAYBOUND_OPS_EVENT_LOG`** is **not** set to `0`, `false`, or `no`, the bot emits lines prefixed with **`[PlayBound:ops]`** followed by a single JSON object per event.

Useful **`category`** values include:

- **`shutdown`** — start / complete / timeout
- **`command_gate`** — slash command denied (includes `reason`, `command`, `guildId`, `userId`)
- **`interaction_received`** - high-volume command/button/modal receipt lines (controlled separately by `PLAYBOUND_INTERACTION_EVENT_LOG`)
- **`interaction_error`** - unhandled interaction errors with guild/user/channel/command context
- **`command_denied`** - archived-thread, shutdown, blacklist, permission, and maintenance denials
- **`recovery_action`** - startup recovery/resume/compensation decisions
- **`scheduled_game`** - delayed schedule creation, resume, and fire lifecycle
- **`maintenance_block`** - scheduling/immediate start blocked (includes `rule`, window metadata, and context when available)
- **`maintenance_broadcast`** - templated advance notice posted to a guild announce channel

**Example (grep):**

```bash
# production logs
grep '\[PlayBound:ops\]' /path/to/your.log
```

Mute all ops JSON logs: `PLAYBOUND_OPS_EVENT_LOG=0`.
Mute only high-volume interaction receipt lines: `PLAYBOUND_INTERACTION_EVENT_LOG=0`.

---

## 7. Local quick test

1. Start the bot with valid env.
2. Send **`SIGINT`** once (Ctrl+C). You should see **`[Lifecycle]`** log lines, HTTP close, clean exit **0**.
3. Optionally hit **`GET /health`** in another terminal while repeating SIGTERM/SIGINT to observe **503** during drain (timing-dependent).

---

## 8. Code map

| Concern | Location |
|---------|----------|
| Shutdown state, hooks, signals | `lib/botLifecycle.js` |
| Ops JSON logs | `lib/opsEventLog.js` |
| Presence from gates + maintenance | `lib/opsPresence.js` |
| Slash gate + `getPerCommandDisableCount` | `lib/commandGate.js` |
| Maintenance throws + logging | `lib/maintenanceScheduling.js` |
| Templated maintenance announce + dedupe | `lib/maintenanceBroadcast.js`, `MaintenanceBroadcastLog` in `models.js` |
| HTTP app, health, `listenHttpServer` return value | `src/server/webhook.js` |
| Wire hooks + `installSignalHandlers` | `index.js` |
| Draining guards | `src/events/interactionCreate.js`, `src/events/messageCreate.js` |
| Presence on login | `src/events/ready.js` |
