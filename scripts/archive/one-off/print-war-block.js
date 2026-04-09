'use strict';
const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(__dirname, '..', 'games', 'platformPlay.js'), 'utf8');
const i = s.indexOf('const warPersonalCapNote');
console.log(JSON.stringify(s.slice(i, i + 450)));
