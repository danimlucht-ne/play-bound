# PlayBound Testing

This site is static HTML/CSS/JS, so the safest setup is a mix of fast structural checks and browser smoke tests.

## What is covered

- Required files exist and are non-empty
- `index.html` points at the expected banner/icon assets
- `vercel.json` keeps the rewrite/redirect contract intact
- The page renders without runtime errors
- The header icon and hero banner load successfully
- The `1 / 2 / 3 / 4` hero step cards stay aligned
- Guest and logged-in states both render correctly
- API failures show an explicit error state instead of a silent broken page
- SPA-style deep links and legal pages still load

## Commands

Install dependencies once:

```bash
npm install
npx playwright install
```

Run the fast static gate:

```bash
npm run test:static
```

Run the browser smoke suite:

```bash
npm run test:e2e
```

Run everything before deploy:

```bash
npm test
```

## CI recommendation

Make `npm test` the required pre-deploy gate for the `play-bound` Vercel project.

Suggested CI order:

1. `npm ci`
2. `npx playwright install --with-deps chromium`
3. `npm test`

## Notes

- The Playwright tests mock `https://api.play-bound.com`, so they stay deterministic and do not depend on the live backend.
- The local test server mirrors the important Vercel behaviors for static files, PNG redirects, and HTML rewrites.
