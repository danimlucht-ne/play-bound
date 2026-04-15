'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'games', 'platformPlay.js');
let s = fs.readFileSync(file, 'utf8');

if (s.charCodeAt(0) === 0xfeff) {
    s = s.slice(1);
    console.log('Stripped UTF-8 BOM');
}

/** Remaining mojibake / double-encoded UTF-8 in user-facing strings. Order: longest first. */
const pairs = [
    ['\u00e2\u008f\u00b1\u00ef\u00b8\u008f', '\u23f1\ufe0f'], // ⏱️ (speed prep / round cap embeds)
    ['\u00e2\u2013\u00b6\u00ef\u00b8\u008f', '\u25b6\ufe0f'], // ▶️
    ['\u00e2\u017e\u2013', '\u2796'], // ➖ (dice duel tie)
    ['\u00e2\u2020\u2019', '\u2192'], // →
    ['\u00e2\u2013\u00a0', '\u25a0'], // ■
    ['\u00e2\u2013\u00b3', '\u25b3'], // △
];

for (const [bad, good] of pairs) {
    const parts = s.split(bad);
    const n = parts.length - 1;
    if (n) {
        s = parts.join(good);
        console.log('replaced', n, 'occurrence(s)');
    }
}

fs.writeFileSync(file, s);
console.log('wrote', file);
