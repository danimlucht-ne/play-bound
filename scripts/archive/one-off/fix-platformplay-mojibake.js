'use strict';

/**
 * Replace common UTF-8-as-Latin-1 mojibake in games/platformPlay.js; update Push Your Luck scoring copy.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'games', 'platformPlay.js');
let s = fs.readFileSync(file, 'utf8');

const pairs = [
    ['\u00e2\u0153\u2026', '\u2705'],
    ['\u00e2\u20ac\u201d', '\u2014'],
    ['\u00e2\u20ac\u201c', '\u2013'],
    ['\u00e2\u20ac\u2122', '\u2019'],
    ['\u00f0\u0178\u0152\u0178', '\u{1F31F}'],
    ['\u00f0\u0178\u017d\u00ad', '\u{1F3AD}'],
];

for (const [bad, good] of pairs) {
    let k = 0;
    while (s.includes(bad)) {
        s = s.split(bad).join(good);
        k++;
    }
    if (k) console.log('Replaced', k, 'x', JSON.stringify(bad));
}

const oldPush =
    'Scoring overview: play **3 hands**. Draw **+2 / +3 / +4 / +5 / BUST**. Safe stop = **4 + one third of your bank**. Bust = **1**.';
const newPush =
    'Scoring overview: play **3 hands**. Draw **+2 / +3 / +4 / +5 / BUST**. Score when you stop without busting = **4 + one third of your bank**. Bust = **1**.';
if (s.includes(oldPush)) {
    s = s.split(oldPush).join(newPush);
    console.log('Updated push_luck_deck scoring copy.');
}

fs.writeFileSync(file, s);
console.log('Wrote', file);
