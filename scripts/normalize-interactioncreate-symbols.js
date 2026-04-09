'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'events', 'interactionCreate.js');
let s = fs.readFileSync(file, 'utf8');

if (s.charCodeAt(0) === 0xfeff) {
    s = s.slice(1);
    console.log('Stripped UTF-8 BOM');
}

const pairs = [
    ['\u00e2\u0152\u203a', '\u231b'], // ⌛ (was mojibake for hourglass in duel timers)
    ['\u00e2\u00ad\u0090', '\u2b50'], // ⭐
    ['\u00e2\u2020\u2019', '\u2192'], // →
    ['\u00e2\u2030\u02c6', '\u2248'], // ≈
];

for (const [bad, good] of pairs) {
    const n = s.split(bad).length - 1;
    if (n) {
        s = s.split(bad).join(good);
        console.log('replaced', n, 'x', good.codePointAt(0).toString(16));
    }
}

fs.writeFileSync(file, s);
console.log('wrote', file);
