# PlayBound — go-live checklist

**Live runbook:** use this file for pre-launch and production checks. Older Kiro task trees for go-live and related work live under **`docs/archive/kiro-specs/`** (historical); do not assume unchecked items there are still tracked only in those files—migrate any real follow-ups here or into your issue tracker.

Work through sections in order, or run **[parallel]** sections alongside others. Check boxes as you complete items.

**Already assumed:** PM2 is running the bot; you will switch Stripe **live** payment links when ready (not duplicated here).

---

## 1. Environment & secrets

- [ ] **1.1** List every secret in one place (password manager): `DISCORD_TOKEN`, `CLIENT_ID`, `DEVELOPER_ID`, `MONGO_URI`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PAYMENT_LINK_*`, `PORT`, support server IDs/invite, `TERMS_URL` / `PRIVACY_URL`, optional `DISCORD_PREMIUM_SKU_ID`. Use `.env.example` as the field list.
- [ ] **1.2** Confirm **production** `.env` has no dev/staging tokens, test URIs, or placeholder values for critical keys.
- [ ] **1.3** Set `DEVELOPER_ID` to the Discord user id of the only person(s) who may use `/broadcast` and `/admin_premium`.
- [ ] **1.4** On the VPS: restrict `.env` permissions (e.g. `chmod 600 .env`) and avoid running the bot as root if you can avoid it.
- [ ] **1.5** Record **who** has server SSH and who can rotate tokens (one paragraph in your private runbook).

---

## 2. MongoDB backups & restore (explicit instructions)

Pick **one** primary strategy: **Atlas automated backups** *or* **`mongodump` on a schedule**.

### Option A — MongoDB Atlas (recommended if you use Atlas)

1. In [Atlas](https://cloud.mongodb.com) → your cluster → **Backup**.
2. Confirm **cloud backup** is enabled, note **retention** (e.g. daily + point-in-time if on a tier that supports it).
3. **Restore drill (staging):**  
   - Atlas → Backup → **Restore** (or download snapshot) into a **separate** cluster or database name for testing.  
   - Or use **mongodump** from Atlas connection string against prod (read-only user) only if your policy allows—prefer Atlas UI restore for drills.
4. **Done when:** You have completed at least one restore to a non-production target and verified collections exist (`User`, `Game`, `SystemConfig`, etc.).

### Option B — `mongodump` with `scripts/backup.sh` (Linux/macOS server)

**Prerequisites**

- [ ] `mongodump` and `mongorestore` installed (same major version as your server is ideal).  
  - Ubuntu example: `sudo apt-get install mongodb-database-tools` (package name may vary by distro).
- [ ] `MONGO_URI` in project `.env` (same as the bot). The script loads `.env` from the repo root.

**What the script does** (see `scripts/backup.sh`)

- Dumps the database to `BACKUP_DIR` (default **`/backups/playbound`**).
- Creates a folder named `YYYYMMDD_HHMMSS` under that directory.
- Deletes backup folders older than **7 days** under `BACKUP_DIR`.

**One-time setup**

```bash
cd /path/to/playbound   # your deploy directory
chmod +x scripts/backup.sh
sudo mkdir -p /backups/playbound
sudo chown YOUR_DEPLOY_USER:YOUR_DEPLOY_USER /backups/playbound
```

Optional: use a custom directory (same user as cron):

```bash
export BACKUP_DIR=/home/deploy/backups/playbound
```

**Manual backup run**

```bash
cd /path/to/playbound
./scripts/backup.sh
```

**Schedule with cron** (example: daily 03:00 server time)

```bash
crontab -e
```

Add (adjust path and user):

```cron
0 3 * * * cd /path/to/playbound && /usr/bin/env bash scripts/backup.sh >> /var/log/playbound-backup.log 2>&1
```

**Restore from a dump folder** (destructive on target—use staging first)

```bash
# Replace FOLDER with the backup name, e.g. 20260402_030015
mongorestore --uri="$MONGO_URI" /backups/playbound/FOLDER/
```

If `mongodump` wrote a nested structure, the path may be `/backups/playbound/FOLDER/<dbname>/`. Point `mongorestore` at the directory that contains the BSON files for your database (MongoDB docs: [mongorestore](https://www.mongodb.com/docs/database-tools/mongorestore/)).

**Restore drill checklist**

- [ ] Take a backup.
- [ ] Restore to a **test** MongoDB (different URI or dropped test DB).
- [ ] Confirm a few collections and document counts look sane.

### Windows (dev machine)

`scripts/backup.sh` is **bash**. On Windows you can:

- Use **WSL** and run the same steps as Linux, **or**
- Run **`mongodump`** / **`mongorestore`** manually in PowerShell with [MongoDB Database Tools](https://www.mongodb.com/try/download/database-tools) installed:

```powershell
$env:MONGO_URI = "mongodb+srv://..."   # or load from .env securely
mongodump --uri=$env:MONGO_URI --out="C:\backups\playbound\$(Get-Date -Format 'yyyyMMdd_HHmmss')"
```

### RPO / RTO (write down)

- [ ] **RPO** (max acceptable data loss): e.g. “24h if we only have daily backups.”
- [ ] **RTO** (time to bring DB back): e.g. “1–2 hours including restore + bot restart.”

---

## 3. Stripe (before live payment links)

- [ ] **3.1** Webhook URL in Stripe Dashboard matches your deployed server (HTTPS, correct path for `src/server/webhook.js`).
- [ ] **3.2** `STRIPE_WEBHOOK_SECRET` in `.env` matches the signing secret for that endpoint.
- [ ] **3.3** **Test mode:** complete purchase (or test event) → user receives Premium in DB; cancel/refund path revokes if implemented.
- [ ] **3.4** List subscribed **webhook event types** and match them to your handler (document any gaps).

*(When product is ready: switch `STRIPE_PAYMENT_LINK_MONTHLY` / `YEARLY` to live links and re-test once.)*

---

## 4. Discord app & slash commands

- [ ] **4.1** Developer Portal → bot → **Privileged Gateway Intents** match what the code needs (e.g. Message Content, Server Members if you use member-dependent features).
- [ ] **4.2** Bot **invite URL** includes `applications.commands` and required bot permissions for your servers.
- [ ] **4.3** On the release commit, run: `node deploy-commands.js` (production `CLIENT_ID` + token).
- [ ] **4.4** After global registration propagates, smoke-test one command per area: games, economy, manager-only, premium-gated.

---

## 5. Permissions audit (guild)

- [ ] **5.1** Compare `README.md` (“Permissions”, “Premium vs free”) with actual behavior; fix README or code so they agree.
- [ ] **5.2** In a test guild: non-manager cannot start gated games; manager can; `/leaderboard` matches documented rule.
- [ ] **5.3** Non-admin cannot use `/blacklist`; only developer uses `/broadcast` and `/admin_premium`.

---

## 6. Support server & onboarding **[parallel]**

- [ ] **6.1** Pin “Start here”: invite link, **`/set_manager_role`**, where to read docs, how to open `/ticket`.
- [ ] **6.2** Verify `SUPPORT_SERVER_*` and `SUPPORT_SERVER_INVITE` in `.env`; run `/ticket` once end-to-end.
- [ ] **6.2b** (Optional) Set `SUPPORT_PANEL_QUICK_START`, `LEARN`, `HELP_DESK_AND_SUGGESTIONS`, `PLAY_HERE`, and `PREMIUM` `*_CHANNEL_ID` values, redeploy commands, run `/setup_panels` **in the support guild** to post navigation embeds.
- [ ] **6.3** (Optional) Add release **version or git SHA** to `/help` footer for easier bug reports.

---

## 7. Full QA pass (staging or sacrificial guild)

- [ ] **7.1** Deploy + `pm2 restart` (with `--update-env` if `.env` changed); confirm clean startup and Mongo connection in logs.
- [ ] **7.2** Economy: `/daily`, `/pay`, `/shop` + buy/equip a non-premium item.
- [ ] **7.3** Run one full cycle each for the games you care about (threads, buttons, voice if Name That Tune).
- [ ] **7.4** `/listgames` and `/endgame` after tests; confirm no “zombie” active games if you expect them ended.
- [ ] **7.5** **Reboot test:** restart bot during/after a game; confirm recovery or clean shutdown per design.
- [ ] **7.6** Premium (Stripe test): grant → use one premium feature → revoke; confirm state.

---

## 8. Monitoring & logs

- [ ] **8.1** PM2 logs: configure rotation (`pm2 install pm2-logrotate` or equivalent) so disks don’t fill.
- [ ] **8.2** Write 3–5 “if you see this, check X” lines (Mongo disconnect, webhook 4xx, repeated interaction errors).
- [ ] **8.3** (Optional) Add error tracking (e.g. Sentry) for `index.js`.

---

## 9. Known code debt (track before/after launch)

- [ ] **9.1 Giveaway recovery key:** runtime stores giveaways under **`message` id** (`activeGiveaways.set(msg.id, …)`), while `src/events/ready.js` recovery may use **`threadId`** as the Map key. **Fix and test:** restart mid-giveaway, confirm timer/end still works. *(See grep: `activeGiveaways.set` vs `endGiveaway`.)*
- [ ] **9.2 Recurring games:** `ready.js` cron only auto-starts some types; ensure README and Discord options match what actually runs.
- [ ] **9.3 GIF URLs** in `lib/duelFlair.js` / `lib/gameFlair.js`: spot-check after deploy; replace any broken links.

---

## 10. Go-live day (minimal sequence)

1. [ ] Tag release / note commit SHA.
2. [ ] Pull on server; `npm ci` (or `npm install`); `node deploy-commands.js` if commands changed.
3. [ ] `pm2 restart <name> --update-env`; watch logs 5–10 minutes.
4. [ ] Smoke: one economy action + one short game on production guild.
5. [ ] Post short note in support/announce channel.

---

## Quick links (repo)

| Topic | Location |
|--------|----------|
| README backups (short) | `README.md` → Database backups |
| Backup script | `scripts/backup.sh` |
| Env template | `.env.example` |
| Webhook server | `src/server/webhook.js` |
| Crash recovery | `src/events/ready.js` |

---

## 11. Archived Kiro “go-live hardening” follow-ups

The **`docs/archive/kiro-specs/go-live-hardening/tasks.md`** snapshot had mixed done/open items. Use it as **history only**; do not treat unchecked boxes there as an active backlog unless you explicitly revive them.

**Still worth a conscious check:**

- **`/ticket` thread visibility** (old task 4): confirm the implementation creates a **private** support thread (see **`src/events/interactionCreate.js`** / ticket handler paths).
- **Name That Tune / iTunes** (old task 20): if you rely on that game, spot-check preview URL validation and API failure handling.

**Large unchecked items** in that snapshot (e.g. custom `ServerFaction` / admin content commands, full game modularization) are **product backlog**, not go-live blockers—promote any you still want into your issue tracker and drop the rest.

