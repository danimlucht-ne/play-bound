import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(rootDir, file), "utf8");
}

function exists(file) {
  return fs.existsSync(path.join(rootDir, file));
}

function size(file) {
  return fs.statSync(path.join(rootDir, file)).size;
}

function expectIncludes(source, needle, message) {
  assert.ok(source.includes(needle), message);
}

const html = read("index.html");
const vercel = JSON.parse(read("vercel.json"));

[
  "public/terms.md",
  "public/privacy.md",
  "index.html",
  "dashboard.css",
  "dashboard.js",
  "onboarding-ui.css",
  "onboarding-ui.js",
  "privacy.html",
  "terms.html",
  "playbound_banner.png",
  "playbound_icon.png",
  "playbound_banner.svg",
  "playbound_icon.svg",
  "vercel.json",
].forEach((file) => {
  assert.ok(exists(file), `Expected ${file} to exist`);
  assert.ok(size(file) > 0, `Expected ${file} to be non-empty`);
});

expectIncludes(html, 'src="./playbound_banner.png"', "Hero banner should use the production PNG asset");
expectIncludes(html, 'src="./playbound_icon.png"', "Header icon should use the production PNG asset");
expectIncludes(html, 'class="hero-banner"', "Hero banner element is missing");
expectIncludes(html, 'class="wordmark__icon"', "Wordmark icon element is missing");
expectIncludes(html, 'class="hero-how__step"', "How-it-works cards are missing");
expectIncludes(html, 'meta property="og:image" content="https://play-bound.com/playbound_banner.svg"', "OG image should point at the public banner asset");
expectIncludes(html, 'meta name="twitter:image" content="https://play-bound.com/playbound_banner.svg"', "Twitter image should point at the public banner asset");
expectIncludes(html, 'meta name="playbound-api"', "API meta tag is required");

assert.equal(vercel.$schema, "https://openapi.vercel.sh/vercel.json", "vercel.json should declare the Vercel schema");
assert.ok(Array.isArray(vercel.rewrites) && vercel.rewrites.length > 0, "vercel.json should contain rewrites");
assert.ok(Array.isArray(vercel.redirects) && vercel.redirects.length >= 2, "vercel.json should contain legacy PNG-to-SVG redirects");
assert.ok(
  vercel.rewrites.some((rule) => rule.source === "/:path*" && rule.destination === "/index.html"),
  "vercel.json should rewrite HTML navigation requests to index.html",
);
assert.ok(
  vercel.rewrites.every((rule) =>
    !Array.isArray(rule.missing) ||
    rule.missing.every((condition) => condition.type === "host")
  ),
  "vercel.json rewrites must not use unsupported missing condition types",
);
assert.ok(
  vercel.redirects.some((rule) => rule.source === "/playbound-icon.png" && rule.destination === "/playbound_icon.svg"),
  "vercel.json should redirect the legacy icon route to the SVG route",
);
assert.ok(
  vercel.redirects.some((rule) => rule.source === "/playbound-banner.png" && rule.destination === "/playbound_banner.svg"),
  "vercel.json should redirect the legacy banner route to the SVG route",
);

console.log("Static validation passed for PlayBound.");
