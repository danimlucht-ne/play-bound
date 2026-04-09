#!/usr/bin/env node
'use strict';

/**
 * Prints Markdown tables for README from deploy-commands.js `commands` JSON.
 * Run: node scripts/generate-slash-readme-tables.js
 */

const { commands } = require('../deploy-commands');

/** @see https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-option-structure */
const OPTION_TYPE = {
    1: 'Subcommand',
    2: 'Subcommand group',
    3: 'String',
    4: 'Integer',
    5: 'Boolean',
    6: 'User',
    7: 'Channel',
    8: 'Role',
    9: 'Mentionable',
    10: 'Number',
    11: 'Attachment',
};

function escCell(s) {
    if (s == null) return '—';
    return String(s)
        .replace(/\|/g, '\\|')
        .replace(/\r?\n/g, ' ')
        .trim();
}

function formatChoices(opt) {
    if (opt.autocomplete) return '`autocomplete`';
    if (!opt.choices || !opt.choices.length) return '—';
    return opt.choices.map((c) => `\`${c.value}\` (${c.name})`).join('; ');
}

function formatMinMax(opt) {
    const parts = [];
    if (opt.min_value != null) parts.push(`min ${opt.min_value}`);
    if (opt.max_value != null) parts.push(`max ${opt.max_value}`);
    if (opt.min_length != null) parts.push(`minLen ${opt.min_length}`);
    if (opt.max_length != null) parts.push(`maxLen ${opt.max_length}`);
    return parts.length ? parts.join(', ') : '—';
}

function optionRows(opts, indent = '') {
    if (!opts || !opts.length) return `${indent}*(no options)*\n`;
    let md = `${indent}| Option | Type | Required | Description | Min/max | Choices |\n`;
    md += `${indent}|--------|------|----------|-------------|---------|---------|\n`;
    for (const o of opts) {
        const t = OPTION_TYPE[o.type] || `type_${o.type}`;
        md += `${indent}| \`${o.name}\` | ${t} | ${o.required ? 'Yes' : 'No'} | ${escCell(o.description)} | ${escCell(formatMinMax(o))} | ${escCell(formatChoices(o))} |\n`;
    }
    return md;
}

function renderCommand(cmd) {
    let md = `### \`/${cmd.name}\`\n\n`;
    md += `*${escCell(cmd.description)}*\n\n`;
    const opts = cmd.options || [];
    const subcommands = opts.filter((o) => o.type === 1);
    const subGroups = opts.filter((o) => o.type === 2);

    if (subGroups.length) {
        for (const g of subGroups) {
            md += `#### \`/${cmd.name}\` → \`${g.name}\`\n\n`;
            md += `*${escCell(g.description)}*\n\n`;
            const inner = (g.options || []).filter((o) => o.type === 1);
            for (const sc of inner) {
                md += `##### \`${sc.name}\`\n\n`;
                md += `*${escCell(sc.description)}*\n\n`;
                md += optionRows(sc.options || []);
                md += '\n';
            }
        }
    }

    if (subcommands.length) {
        for (const sc of subcommands) {
            md += `#### \`/${cmd.name} ${sc.name}\`\n\n`;
            md += `*${escCell(sc.description)}*\n\n`;
            md += optionRows(sc.options || []);
            md += '\n';
        }
        return md;
    }

    if (!subGroups.length) {
        md += optionRows(opts);
        md += '\n';
    }
    return md;
}

function main() {
    const sorted = [...commands].sort((a, b) => a.name.localeCompare(b.name));
    console.log('## Full slash command option reference\n');
    console.log(
        'Generated from [`deploy-commands.js`](deploy-commands.js) (`commands` JSON). Refresh `README.md` with **`npm run docs:slash-readme`**, or print only:\n\n```bash\nnode scripts/generate-slash-readme-tables.js\n```\n\n---\n',
    );
    for (const cmd of sorted) {
        process.stdout.write(renderCommand(cmd));
    }
}

main();
