# PlayBound — Marketing site

Static site for [play-bound.com](https://play-bound.com): landing page, leaderboards preview, Discord login, referral tools, admin panel hooks, and the **player onboarding** UI.

This folder is **`apps/web`** in the [PlayBound monorepo](https://github.com/danimlucht-ne/play-bound) (same repository as the Discord bot). Edit policy copy in **`public/terms.md`** and **`public/privacy.md`**, then run **`npm run web:build`** from the repository root (or `npm run build` here) to regenerate `terms.html` / `privacy.html`.

## Stack

- **HTML + CSS + vanilla JavaScript** (no bundler for the app shell)
- **Legal pages:** Markdown in `public/` → HTML via `scripts/build-legal.mjs` (`npm run build`)
- **Hosting:** [Vercel](https://vercel.com/) — set the Vercel project **Root Directory** to **`apps/web`** (see `vercel.json`)

## Project layout

| Path | Purpose |
|------|---------|
| `index.html` | Main page: hero, stats, play hub, leaderboards, profile strip, game browser modal, admin drawer |
| `onboarding-ui.css` | Onboarding / modal design system (tokens, screens, game demo shell) |
| `onboarding-ui.js` | Full-screen onboarding flow; syncs with bot API `onboarding` state |
| `privacy.html`, `terms.html` | Legal pages |
| `vercel.json` | SPA-style fallback to `index.html` only when **no matching file** exists (so PNG/CSS/JS/legal HTML are served normally) |

## API coupling

The page reads the bot’s public base URL from a `<meta>` tag:

```html
<meta name="playbound-api" content="https://api.play-bound.com">
```

Used for:

- `GET /api/public-config`, `/api/stats/global`, `/api/leaderboard/*`, `/api/games/today`, `/api/seasons/*`, …
- `GET /api/me` and `POST /api/me/onboarding` when the user signs in with Discord (session cookie; CORS must allow your site origin)

Change the meta value for staging or self-hosted APIs.

## Onboarding UI

- Opens automatically for logged-in users who have an **active** onboarding tour (unless they dismissed it this browser session).
- **Launcher bar:** “Continue setup” / “Resume setup” reopens the overlay.
- **Discord column:** Short copy + button labels mirroring Discord-style interactions.
- **Practice game:** Local reaction mini-game only; real scores still come from Discord.

Challenge preview: add `?demoWar=1` to the URL to show sample ranked-war layout.

## Local preview

From this directory, serve files over HTTP (required for `fetch` and paths):

```bash
npx serve .
# or
python -m http.server 8080
```

Open `http://localhost:8080` (or the port shown). Point `playbound-api` at an API that allows your origin, or expect CORS errors for authenticated routes.

## Deploy

1. Connect the repo/folder to Vercel (static site).
2. `vercel.json` only SPA-fallbacks to `index.html` when the request **Accept** header looks like HTML **and** there is no static file for that path — so `.png`, `.css`, `.js`, and `terms.html` / `privacy.html` are served as files.
3. **Header wordmark + hero** are **inline SVG** inside `index.html` (no extra HTTP request), so they render even if static files or Vercel rewrites are misconfigured. **Favicon** uses an inline **data-URI** SVG for the same reason. Optional files **`playbound_icon.svg`** / **`playbound_banner.svg`** remain for `og:image` and redirects.
4. Set production `playbound-api` meta to your live API URL (e.g. `https://api.play-bound.com`).

### If the marketing site shows broken images

- **Vercel → Project → Settings → General → Root Directory** must be **`apps/web`** (this folder in the PlayBound repo). Otherwise the wrong files deploy and asset paths break.
- This repo’s `vercel.json` must **not** use a blind “everything → `index.html`” rewrite; the current rule only applies when the `Accept` header looks like HTML, so real files (`.svg`, `.css`, `.js`, legal HTML) are served normally.
- **`og:image`** still points at `https://play-bound.com/playbound_banner.svg`; crawlers need that URL to return SVG (not HTML). If link previews fail, verify that URL in a browser or `curl -I`.
- Legacy `/playbound_icon.png` and `/playbound_banner.png` requests redirect to the SVGs in `vercel.json`.

### If `api.…` returns 404 for `/api/seasons/*` or `/api/games/today`

Those routes are implemented on the **same repository’s** Discord bot HTTP app (`src/server/api/publicRoutes.js`, mounted from `src/server/webhook.js`). A 404 usually means the API host is running an **older deploy** or traffic is not reaching that process. Quick checks:

```bash
curl -sS https://api.play-bound.com/api | head
curl -sS https://api.play-bound.com/api/seasons/current | head
curl -sS https://api.play-bound.com/api/games/today | head
```

The first should return JSON with `"service":"playbound-api"` and a list of paths. If that 404s too, redeploy the bot from a revision that includes the current `publicRoutes.js` (seasons + games/today).

## Same repo as the bot

The **PlayBound Discord bot** (games, economy, OAuth session issuer, `/api/*`) lives at the **repository root** (`../` from this folder). See the root **`README.md`** for bot setup, env vars, and slash commands.
