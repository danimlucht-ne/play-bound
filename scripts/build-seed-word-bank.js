/**
 * Builds data/serverdle-word-bank.txt from npm `word-list` (5-letter, has vowel),
 * excluding words already listed in seed-expanded.js SERVERDLE_WORDS.
 * Run: npm run build:seed-words
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const seedPath = path.join(ROOT, 'seed-expanded.js');
const wlPath = path.join(ROOT, 'node_modules', 'word-list', 'words.txt');
const outPath = path.join(ROOT, 'data', 'serverdle-word-bank.txt');

const TARGET = 4500;

if (!fs.existsSync(wlPath)) {
    console.error('Missing word-list package. Run: npm install');
    process.exit(1);
}

const seed = fs.readFileSync(seedPath, 'utf8');
const wm = seed.match(/const SERVERDLE_WORDS = \[([\s\S]*?)\];/);
if (!wm) {
    console.error('Could not parse SERVERDLE_WORDS from seed-expanded.js');
    process.exit(1);
}

const existing = new Set();
for (const q of wm[1].match(/"[A-Z]+"/g) || []) {
    existing.add(q.slice(1, -1).toUpperCase());
}

const dict = fs
    .readFileSync(wlPath, 'utf8')
    .split('\n')
    .map((w) => w.trim().toLowerCase())
    .filter((w) => /^[a-z]{5}$/.test(w) && /[aeiouy]/.test(w));

const candidates = dict
    .map((w) => w.toUpperCase())
    .filter((w) => !existing.has(w));

// Deterministic shuffle (Fisher–Yates with fixed seed) so the file is stable across runs
function seededRandom(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const rand = seededRandom(20260402);
const shuffled = [...candidates];
for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}

const picked = shuffled.slice(0, TARGET).sort();

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${picked.join('\n')}\n`);
console.log(`Wrote ${picked.length} words to ${path.relative(ROOT, outPath)} (candidates ${candidates.length})`);
