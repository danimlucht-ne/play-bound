'use strict';
const fs = require('fs');
const lineNo = parseInt(process.argv[2], 10) || 505;
const lines = fs.readFileSync(require('path').join(__dirname, '..', 'games', 'platformPlay.js'), 'utf8').split(/\n/);
const l = lines[lineNo - 1];
const start = l.indexOf(": '") + 3;
const sub = l.slice(start, start + 10);
for (let i = 0; i < sub.length; i++) {
    console.log(i, sub.charCodeAt(i).toString(16), JSON.stringify(sub[i]));
}
