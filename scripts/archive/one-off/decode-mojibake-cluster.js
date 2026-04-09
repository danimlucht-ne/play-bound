'use strict';
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(__dirname, '..', 'games', 'platformPlay.js'), 'utf8');

function tryDecode(seg) {
    const b = Buffer.allocUnsafe(seg.length);
    for (let i = 0; i < seg.length; i++) {
        const cp = seg.charCodeAt(i);
        if (cp > 255) return null;
        b[i] = cp;
    }
    try {
        return b.toString('utf8');
    } catch {
        return null;
    }
}

const set = new Set();
const re = /ðŸ[^\n`]{0,5}/g;
let m;
while ((m = re.exec(s))) set.add(m[0]);

for (const seg of [...set].sort()) {
    const d = tryDecode(seg);
    console.log(JSON.stringify(seg), '->', d == null ? 'FAIL' : JSON.stringify(d));
}
