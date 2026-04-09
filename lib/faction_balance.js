'use strict';

const { User } = require('../models');
const { getSystemConfig, getUser } = require('./db');
const { formatFactionDualLabel, getFactionDisplayEmoji } = require('./factionGuild');
const { GLOBAL_FACTION_KEYS, CANONICAL_FACTION_EMOJI } = require('./factionKeys');

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function executeFactionBalance(interaction) {
    const guildId = interaction.guildId;
    const config = await getSystemConfig(guildId);
    const viewer = await getUser(guildId, interaction.user.id);

    const counts = [];
    for (const key of GLOBAL_FACTION_KEYS) {
        const n = await User.countDocuments({ guildId, faction: key });
        counts.push({ key, n });
    }

    const totalFac = counts.reduce((s, c) => s + c.n, 0);

    const lines = counts.map(({ key, n }) => {
        const label = formatFactionDualLabel(key, config);
        const em = getFactionDisplayEmoji(key, config, CANONICAL_FACTION_EMOJI[key]);
        const pct =
            viewer.isPremium && totalFac > 0
                ? ` (${((100 * n) / totalFac).toFixed(1)}% of faction members here)`
                : '';
        return `${em} **${label}** — **${n}** member${n === 1 ? '' : 's'}${pct}`;
    });

    const minN = Math.min(...counts.map((c) => c.n));
    const lowest = counts.filter((c) => c.n === minN);
    let extra = '';
    if (counts.some((c) => c.n !== minN) || minN === 0) {
        extra = `\n⚠️ **Needs players:** ${lowest.map((c) => formatFactionDualLabel(c.key, config)).join(' · ')}`;
    }

    const premiumNote = viewer.isPremium
        ? totalFac > 0
            ? `\n\n💎 **Premium:** **${totalFac}** members here across the three factions — percentages are **local** headcount only (not war scoring).`
            : '\n\n💎 **Premium:** no faction members tallied here yet.'
        : '';

    return interaction.reply({
        content:
            `**Faction headcount (this server)**\n` +
            `_Server display names may differ; **(Name)** is the global faction._\n\n` +
            `${lines.join('\n')}${extra}${premiumNote}`,
        ephemeral: true,
    });
}

module.exports = { executeFactionBalance };
