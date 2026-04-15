'use strict';

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'games', 'platformPlay.js');
let s = fs.readFileSync(file, 'utf8');

const re = /const warPersonalCapNote = isWarSession\s*\n\s*\?[\s\S]+?\n\s*:\s*'';/;

const replacement = `const warPersonalCapNote = isWarSession
        ? \`\\n\\u2694\\uFE0F **War:** no **Credits** per match \\u2014 one payout when the war **ends**: **\${FACTION_WAR_PARTICIPATION_CREDITS}** per enrolled player + **\${FACTION_WAR_TOP5_EXTRA_CREDITS.join(' / ')}** extra for **1st\\u20135th** on your faction (raw score); max **\${FACTION_WAR_MAX_PERSONAL_CREDITS}**. War tally still uses your full match base.\`
        : '';`;

if (!re.test(s)) {
    console.error('Pattern not found for warPersonalCapNote');
    process.exit(1);
}
s = s.replace(re, replacement);
fs.writeFileSync(file, s);
console.log('Patched warPersonalCapNote');
