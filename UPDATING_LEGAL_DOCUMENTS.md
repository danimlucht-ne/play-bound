# Updating Terms of Service and Privacy Policy

Use this checklist whenever you change legal text or need everyone to accept again.

## 1. What must stay in sync

| Piece | Role |
|--------|------|
| **Version strings** (terms + privacy) | The Discord bot compares these to each user’s stored `agreedTermsVersion` / `agreedPrivacyVersion`. If either string does not match exactly, the user sees the **Agreements Required** embed and must tap **Accept & Continue** before slash commands work. |
| **Public HTML** (`terms.html`, `privacy.html`) | Linked from that embed (`https://play-bound.com/terms.html` and `privacy.html`). Users read the real policy here. |
| **Optional:** `docs/TERMS.md`, `docs/PRIVACY.md` | Internal / repo-friendly copies. They are **not** what Discord serves; keep them aligned if you use them as source material. |

## 2. Bump version strings (force re-accept in Discord)

Pick **one** source of truth (first match wins at runtime):

1. **Recommended (no deploy):** Log into the PlayBound site as the **developer** account → **Admin** drawer → **Legal** tab → enter new **Terms version** and **Privacy version** → **Save & require re-accept**.  
   This stores a single MongoDB document (`legal_policy_config`, `_id: global`) in the **production** database. The bot reads it from prod for all servers (including test-guild routing).

2. **Fallback:** Edit `src/bot/constants.js` (`CURRENT_TERMS_VERSION`, `CURRENT_PRIVACY_VERSION`) and redeploy. Used when there is **no** database row, or after **Clear DB override** in the Legal tab.

3. **Optional tuning:** `PLAYBOUND_LEGAL_VERSION_CACHE_MS` (default `5000`) controls how long the bot caches effective versions in memory after a read.

**Revert DB override:** Admin → Legal → **Clear DB override** (or `DELETE /api/admin/legal-policy`). The bot then uses `constants.js` again until you save new versions in the admin UI.

## 3. Publish updated HTML (policy text)

Public URLs stay **`/terms.html`** and **`/privacy.html`** on whatever host serves your PlayBound static site.

**A. Repository (typical for git-based deploys)**  
Edit or replace:

- `../lucht-applications/play-bound/terms.html`
- `../lucht-applications/play-bound/privacy.html`

(paths relative to this bot repo: sibling `lucht-applications/play-bound/`)

Deploy the site the same way you deploy today (CDN, static host, etc.).

**B. Bot-hosted static (`PUBLIC_DIR`)**  
If the Node process serves the marketing site via `PUBLIC_DIR` (see `.env.example`), you can:

- Replace `terms.html` / `privacy.html` inside that folder on disk, **or**
- **Admin → Legal → Publish HTML to site** (file pickers). Requires `PUBLIC_DIR` to be set and the bot to have write access to that directory.

**C. Drop-in files without touching repo HTML**  
Set optional env vars on the bot host (see `.env.example`):

- **`LEGAL_CONTENT_DIR`** — folder containing `terms.html` and `privacy.html`, **or**
- **`LEGAL_TERMS_FILE`** / **`LEGAL_PRIVACY_FILE`** — absolute or cwd-relative paths to each file.

The HTTP app serves these **before** files under `PUBLIC_DIR` for `/terms.html` and `/privacy.html` when the request hits **this** Express server.

**If the live site is not this bot** (e.g. Vercel-only): update `terms.html` / `privacy.html` on that host; env `LEGAL_*` only applies where this bot’s Express serves those routes.

## 4. Discord embed links

The agreement embed hardcodes:

- `https://play-bound.com/terms.html`
- `https://play-bound.com/privacy.html`

If you ever change the public base URL, update `src/events/interactionCreate.js` (search for `play-bound.com`) so the buttons match where users actually read the policies.

## 5. Suggested order of operations

1. Draft and review policy text (HTML pages and optional `docs/*.md`).
2. Publish HTML to the live URLs (section 3).
3. Bump version strings (section 2) so Discord re-gates everyone on next command.
4. Smoke-test: open the public pages in a browser, then run a slash command with a test account that had already accepted; confirm the embed appears and **Accept** succeeds.

## 6. API reference (developer session)

All under `/api/admin/` with a logged-in **developer** session:

| Method | Path | Purpose |
|--------|------|--------|
| `GET` | `/legal-policy` | Current effective versions, DB row, code defaults, whether HTML upload is available |
| `POST` | `/legal-policy` | JSON `{ termsVersion, privacyVersion }` — upsert DB versions |
| `DELETE` | `/legal-policy` | Remove DB row (fall back to `constants.js`) |
| `POST` | `/legal-policy/html` | JSON `{ termsHtml?, privacyHtml? }` — write `terms.html` / `privacy.html` under `PUBLIC_DIR` (at least one field non-empty; max ~1.5 MB each) |

Non-developer accounts cannot call these endpoints.
