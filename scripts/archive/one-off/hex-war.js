'use strict';
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(__dirname, '..', 'games', 'platformPlay.js'), 'utf8');
const i = s.indexOf('Faction challenge:');
console.log(
    s
        .slice(i - 15, i + 25)
        .split('')
        .map((c) => c.charCodeAt(0).toString(16))
        .join(' '),
);
