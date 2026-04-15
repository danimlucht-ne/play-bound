'use strict';
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(__dirname, '..', 'games', 'platformPlay.js'), 'utf8');
const uniq = new Set();
for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 0xf0) uniq.add(s.slice(i, i + 4));
}
fs.writeFileSync(path.join(__dirname, 'emoji-keys.json'), JSON.stringify([...uniq], null, 2), 'utf8');
console.log('wrote', [...uniq].length, 'keys');
