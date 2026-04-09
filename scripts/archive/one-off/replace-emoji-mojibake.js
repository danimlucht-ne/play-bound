'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'games', 'platformPlay.js');
let s = fs.readFileSync(file, 'utf8');

/** UTF-8 read as Latin-1 / CP1252 style mojibake: always these 4 code units. */
const map = [
    ['ðŸ', '\u{1F3C1}'],
    ['ðŸ\xa0', '\u{1F3E0}'],
    ['ðŸ¦', '\u{1F3E6}'],
    ['ðŸ†', '\u{1F3C6}'],
    ['ðŸ§\xa0', '\u{1F9E0}'],
    ['ðŸ§©', '\u{1F9E9}'],
    ['ðŸŸ¢', '\u{1F7E2}'],
    ['ðŸŽ¯', '\u{1F3AF}'],
    ['ðŸŽ²', '\u{1F3B2}'],
    ['ðŸŽ‰', '\u{1F389}'],
    ['ðŸ‘‘', '\u{1F451}'],
    ['ðŸ’¥', '\u{1F4A5}'],
    ['ðŸ’€', '\u{1F480}'],
    ['ðŸ”§', '\u{1F527}'],
    ['ðŸ”´', '\u{1F534}'],
    ['ðŸ”’', '\u{1F512}'],
    ['ðŸ›‘', '\u{1F6D1}'],
];

for (const [bad, good] of map) {
    if (!s.includes(bad)) continue;
    const n = s.split(bad).length - 1;
    s = s.split(bad).join(good);
    console.log('Replaced', n, 'x', JSON.stringify(bad), '->', good);
}

fs.writeFileSync(file, s);
console.log('Done');
