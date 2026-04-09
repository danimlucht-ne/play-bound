'use strict';
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(__dirname, '..', 'games', 'platformPlay.js'), 'utf8');
const set = new Set();
for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 0xf0) {
        set.add(s.slice(i, i + 4));
    }
}
for (const x of [...set].sort()) {
    const codes = [...x].map((c) => 'U+' + c.codePointAt(0).toString(16).toUpperCase()).join(' ');
    console.log(JSON.stringify(x), codes);
}
