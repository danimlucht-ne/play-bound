'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'games', 'platformPlay.js');
let s = fs.readFileSync(file, 'utf8');

const keys = JSON.parse(fs.readFileSync(path.join(__dirname, 'emoji-keys.json'), 'utf8'));
/** Same order as `emoji-keys.json` from `dump-emoji-keys.js`. */
const codepoints = [
    '1F3B2',
    '1F3C1',
    '1F527',
    '1F4A5',
    '1F512',
    '1F3AF',
    '1F389',
    '1F3E0',
    '1F451',
    '1F3E6',
    '1F480',
    '1F3C6',
    '1F9E0',
    '1F9E9',
    '1F534',
    '1F7E2',
    '1F6D1',
];

if (keys.length !== codepoints.length) {
    console.error('keys length', keys.length, '!= codepoints', codepoints.length);
    process.exit(1);
}

for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const good = String.fromCodePoint(parseInt(codepoints[i], 16));
    const n = s.split(k).length - 1;
    if (n) {
        s = s.split(k).join(good);
        console.log('Replaced', n, 'x', JSON.stringify(k), '->', codepoints[i]);
    }
}

fs.writeFileSync(file, s);
console.log('Wrote', file);
