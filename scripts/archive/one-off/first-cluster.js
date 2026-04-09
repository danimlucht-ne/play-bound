'use strict';
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(__dirname, '..', 'games', 'platformPlay.js'), 'utf8');
const marker = '`ðŸ';
const i = s.indexOf(marker);
const seg = s.slice(i + 1, i + 5);
console.log(JSON.stringify(seg));
for (let j = 0; j < seg.length; j++) console.log(j, seg.charCodeAt(j));

const b = Buffer.allocUnsafe(4);
for (let j = 0; j < 4; j++) b[j] = seg.charCodeAt(j) & 255;
console.log('utf8 decode', b.toString('utf8'));
