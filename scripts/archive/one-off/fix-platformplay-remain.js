'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'games', 'platformPlay.js');
let s = fs.readFileSync(file, 'utf8');

s = s.split('\u00e2\u009d\u0152').join('\u274c');

s = s.split('\u00c3\u2014').join('\u00d7');

const oldFaces =
    "const faces = ['\u00e2\u0161\u20ac', '\u00e2\u0161\u0081', '\u00e2\u0161\u201a', '\u00e2\u0161\u0192', '\u00e2\u0161\u201e', '\u00e2\u0161\u2026'];";
const newFaces =
    "const faces = ['\\u2680', '\\u2681', '\\u2682', '\\u2683', '\\u2684', '\\u2685'];";
if (s.includes(oldFaces)) {
    s = s.split(oldFaces).join(newFaces);
    console.log('fixed dieFaceUnicode faces');
} else {
    console.log('faces line not found (already fixed?)');
}

const dieRange =
    '(\u00e2\u0161\u20ac\u2013\u00e2\u0161\u2026)'; // âš€–âš… with en dash
if (s.includes(dieRange)) {
    s = s.split(dieRange).join('(\u2680\u2013\u2685)');
    console.log('fixed die range template');
}
const dieRange2 = '(\u00e2\u0161\u20ac\u2013\u00e2\u0161\u2026)'; // same
// target_21 embed might use … ellipsis as last char — verify
const t21 = s.indexOf('Roll **d6**');
if (t21 !== -1) {
    const snip = s.slice(t21, t21 + 80);
    const alt = snip.match(/\([^)]*d6[^)]*\)/);
    if (alt) console.log('t21 snippet', alt[0]);
}

fs.writeFileSync(file, s);
console.log('wrote', file);
