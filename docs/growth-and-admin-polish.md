# PlayBound — growth & power-admin polish backlog

**Intent:** Ship things that help **discovery / conversion** and make **server admins & your developer self** feel confident—*before* support volume forces reactive work. No support pings yet is a good window to set defaults and “wow” polish.

**Where things live:** marketing + admin drawer mostly **`apps/web/index.html`**; dashboard cards **`apps/web/dashboard.js`** + **`dashboard.css`**.

Work **top to bottom** within each tier, or pick one tier and finish it.

---

## Tier 1 — Growth (highest leverage first)

- [x] **One-line audience lock** above the fold on the marketing hero: *who* (server owners / mods) and *outcome* (game night, engagement, Premium value)—no insider-only jargon as the first sentence.
- [ ] **Social / Discord link preview hardening** — `og:image` as **1200×630 PNG** (not only SVG) so Discord and iMessage previews look crisp; keep SVG for inline use if you want.
- [ ] **Short motion proof** — 8–15s silent GIF or loop ( `/playgame` → thread, or faction war snippet ) embedded on the site; reduces “is this real?” for cold traffic.
- [x] **Premium clarity strip** — 3–5 bullets: what Premium buys vs free, renewal/cancel in plain language, link to purchase path; aligns marketing with Discord expectations. *(Existing cards + new free-vs-Premium sentence under section.)*
- [x] **Single primary CTA hierarchy** — “Add to Discord” dominant; support server / docs secondary but visible (you already lean this way—audit mobile where CTAs stack). *(Nav FAQ link; CTAs unchanged.)*

---

## Tier 2 — Growth (still early, no support load)

- [x] **FAQ block** (`#faq`) — the questions you *expect* once installs scale (permissions, Premium, data, “does it read all messages?”). Written for **mods**, not developers.
- [x] **Structured data** — `SoftwareApplication` or `Organization` JSON-LD on homepage if it matches reality (lawyer/SEO quick check).
- [x] **Changelog or “What’s new”** — short public list tied to Discord announcements; builds trust for power admins who re-check before enabling features. *(**`#whats-new`** section on site — update bullets when you ship.)*

---

## Tier 1 — Power-admin polish (drawer + dashboard)

- [x] **Drawer = modal behavior** — While `#admin-drawer` is open: **Escape** closes, **focus trap** inside panel, focus returns to opener on close; `aria-modal` / `role="dialog"` and labelled-by the title. *(Escape + return focus already existed; added **Tab focus trap** in capture phase.)*
- [x] **Sticky server context** — Selected guild **name + id** (and optional icon) always visible in the drawer header so multi-guild admins never act on the wrong server by accident.
- [ ] **Save / destructive feedback** — Long forms: disabled submit while saving, success toast or persistent line until dismissed; destructive actions (wipe, bulk adjust) → **confirm + type server name** or second click pattern.
- [x] **Dashboard empty states** — Logged-in user with thin stats: friendly copy + “next steps” (invite link, run a game, open admin drawer) instead of blank cards only. *(Stats card when `totalGamesWon === 0` and `serverCount === 0`.)*
- [x] **Loading skeletons** — Replace one-line “Loading…” in dashboard cards with lightweight placeholders to reduce layout shift when APIs return.

---

## Tier 2 — Power-admin polish

- [x] **Deep link affordance** — Surface “copy link to this dashboard tab” (`#dashboard-shop`, etc.) for mods who coordinate in Discord.
- [x] **Tab keyboard navigation** — Admin sidebar tab strip: arrow keys between tabs, **Home/End**, visible focus ring matching `dashboard` patterns. *(Arrow ↑↓←→ between visible admin tabs; `:focus-visible` on admin tab buttons + dashboard tabs.)*
- [ ] **Audit / logs readability** — Relative timestamps (“2h ago”) + absolute on hover; monospace density toggle if logs feel cramped.
- [x] **Developer-only strip** — Visual divider + “Developer” label on Legal / Logs / Servers tabs so it’s obvious why most users don’t see them (reduces “is my install broken?”).

---

## Cross-cutting (growth + admins, pay once)

- [ ] **Design tokens in one place** — Reduce drift between inline `:root` in `index.html` and `dashboard.css` (shared `tokens.css` or merged sheet) so one tweak updates marketing + dashboard + drawer.
- [x] **Contrast pass** — `muted` on `surface` in drawer and dashboard; focus rings on all interactive controls (WCAG-style target: **AA** on critical paths). *(Focus rings expanded; full contrast audit still optional.)*
- [ ] **Performance slice** — Move a chunk of marketing-only CSS from `index.html` to a cached static file when the HTML file becomes painful to edit (no framework required).

---

## Explicitly *later* (when support exists)

- Saved replies, in-bot “what’s new”, ticket integration — premature until volume justifies it.

---

*Cross-link: production and legal checklist remains **`docs/GO_LIVE_CHECKLIST.md`**.*
