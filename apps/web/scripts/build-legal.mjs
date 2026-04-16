#!/usr/bin/env node
/**
 * Renders public/terms.md and public/privacy.md into root terms.html / privacy.html
 * with the same PlayBound visual shell as before. Run before deploy or `npm test`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

marked.use({
  gfm: true,
  mangle: false,
  headerIds: false,
});

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @returns {{ meta: Record<string, string>, body: string }}
 */
function parseFrontmatter(raw) {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---\n")) {
    return { meta: {}, body: raw.trim() };
  }
  const end = trimmed.indexOf("\n---\n", 4);
  if (end === -1) {
    return { meta: {}, body: raw.trim() };
  }
  const yamlBlock = trimmed.slice(4, end);
  const body = trimmed.slice(end + 5).trimStart();
  /** @type {Record<string, string>} */
  const meta = {};
  for (const line of yamlBlock.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    meta[m[1]] = val;
  }
  return { meta, body };
}

const FAVICON =
  "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000/svg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Cdefs%3E%3ClinearGradient%20id%3D%22g%22%20x1%3D%220%25%22%20y1%3D%220%25%22%20x2%3D%22100%25%22%20y2%3D%22100%25%22%3E%3Cstop%20offset%3D%220%25%22%20stop-color%3D%22%2300ced1%22%2F%3E%3Cstop%20offset%3D%22100%25%22%20stop-color%3D%22%232dd4bf%22%2F%3E%3C%2FlinearGradient%3E%3C%2Fdefs%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22url(%23g)%22%2F%3E%3Cpolygon%20points%3D%2224%2C18%2024%2C46%2046%2C32%22%20fill%3D%22%23070b10%22%2F%3E%3C%2Fsvg%3E";

/**
 * @param {{ docTitle: string, pageTitle: string, lastUpdated: string, bodyHtml: string }} p
 */
function wrapPage({ docTitle, pageTitle, lastUpdated, bodyHtml }) {
  const updatedLine = lastUpdated
    ? `    <p class="updated">Last Updated: ${escapeHtml(lastUpdated)}</p>\n`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PlayBound — ${escapeHtml(docTitle)}</title>
  <link rel="icon" type="image/svg+xml" href="${FAVICON}" sizes="any">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #ccc; background: #1a1a2e; line-height: 1.7; }
    a { color: #7289da; }
    .container { max-width: 700px; margin: 0 auto; padding: 3rem 1.5rem; }
    h1.page-title { color: #fff; margin-bottom: 0.5rem; font-size: 1.75rem; }
    .legal-body h1 { color: #fff; margin: 1.25rem 0 0.5rem; font-size: 1.35rem; }
    .legal-body h2 { color: #fff; margin-top: 2rem; margin-bottom: 0.5rem; font-size: 1.15rem; }
    .legal-body h3 { color: #e0e0f0; margin-top: 1.25rem; margin-bottom: 0.4rem; font-size: 1rem; }
    .legal-body p, .legal-body li { margin-bottom: 0.75rem; font-size: 0.95rem; }
    .legal-body ul, .legal-body ol { padding-left: 1.5rem; }
    .updated { color: #888; font-size: 0.85rem; margin-bottom: 2rem; }
    .back { display: inline-block; margin-bottom: 1.5rem; color: #7289da; font-size: 0.9rem; }
    .legal-body hr { border: none; border-top: 1px solid #2a2a4a; margin: 2rem 0; }
    .legal-body blockquote { background: #16213e; border-left: 3px solid #5865F2; padding: 0.75rem 1rem; border-radius: 4px; font-size: 0.9rem; margin: 1rem 0; color: #ccc; }
    .legal-body code { background: #16213e; padding: 0.15rem 0.35rem; border-radius: 3px; font-size: 0.9em; }
    .legal-body pre { background: #16213e; padding: 1rem; overflow-x: auto; border-radius: 4px; margin: 1rem 0; font-size: 0.85rem; }
    .legal-body pre code { background: none; padding: 0; }
    .legal-body strong { color: #e8e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <a href="/index.html" class="back">&larr; Back to PlayBound</a>
    <h1 class="page-title">${escapeHtml(pageTitle)}</h1>
${updatedLine}    <div class="legal-body">
${bodyHtml}
    </div>
  </div>
</body>
</html>
`;
}

function main() {
  const pairs = [
    { src: "public/terms.md", out: "terms.html", fallbackTitle: "Terms of Service" },
    { src: "public/privacy.md", out: "privacy.html", fallbackTitle: "Privacy Policy" },
  ];
  for (const { src, out, fallbackTitle } of pairs) {
    const srcPath = path.join(rootDir, src);
    if (!fs.existsSync(srcPath)) {
      console.error(`[build-legal] Missing source: ${src}`);
      process.exit(1);
    }
    const raw = fs.readFileSync(srcPath, "utf8");
    const { meta, body } = parseFrontmatter(raw);
    const pageTitle = meta.title || fallbackTitle;
    const lastUpdated = meta.lastUpdated || "";
    const bodyHtml = marked.parse(body);
    const html = wrapPage({
      docTitle: pageTitle,
      pageTitle,
      lastUpdated,
      bodyHtml,
    });
    fs.writeFileSync(path.join(rootDir, out), html, "utf8");
    console.log(`[build-legal] Wrote ${out} from ${src}`);
  }
}

main();
