'use strict';

/**
 * Refreshes the "Full slash command option reference" section in README.md from deploy-commands.js.
 *
 *   node scripts/regenerate-slash-readme.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const readmePath = path.join(root, 'README.md');
const genPath = path.join(__dirname, 'generate-slash-readme-tables.js');

const r = spawnSync(process.execPath, [genPath], { cwd: root, encoding: 'utf8' });
if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    process.exit(r.status || 1);
}
const frag = r.stdout.trim();

let readme = fs.readFileSync(readmePath, 'utf8');

const fullHeading = '## Full slash command option reference';
const permAnchor = '\n\n---\n\n## Permissions';

const startIdx = readme.indexOf(fullHeading);
if (startIdx >= 0) {
    const endIdx = readme.indexOf(permAnchor, startIdx);
    if (endIdx < 0) {
        console.error('Found fullHeading but no closing anchor before ## Permissions');
        process.exit(1);
    }
    readme = readme.slice(0, startIdx) + frag + readme.slice(endIdx);
} else {
    const needle =
        '- **`/blacklist`**, **`/unblacklist`** — **Administrator** (or developer).\n\n---\n\n## Permissions';
    if (!readme.includes(needle)) {
        console.error('README: missing merge anchor (blacklist bullet + ## Permissions)');
        process.exit(1);
    }
    readme = readme.replace(
        needle,
        '- **`/blacklist`**, **`/unblacklist`** — **Administrator** (or developer).\n\n' +
            frag +
            permAnchor,
    );
}

const oldToc = `8. [Slash commands](#slash-commands)
9. [Permissions](#permissions)
10. [Premium (summary)](#premium-summary)
11. [Operations](#operations)
12. [Further reading](#further-reading)`;

const newToc = `8. [Slash commands](#slash-commands)
9. [Full slash command option reference](#full-slash-command-option-reference)
10. [Permissions](#permissions)
11. [Premium (summary)](#premium-summary)
12. [Operations](#operations)
13. [Further reading](#further-reading)`;

if (readme.includes(oldToc)) {
    readme = readme.replace(oldToc, newToc);
}

fs.writeFileSync(readmePath, readme, 'utf8');
console.log('Updated README.md (Full slash command option reference + TOC).');
