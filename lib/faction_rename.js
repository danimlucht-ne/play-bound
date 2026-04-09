'use strict';

const { updateSystemConfig } = require('./db');

const MAX_LEN = 80;

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function executeFactionRename(interaction) {
    const faction = interaction.options.getString('faction');
    let name = interaction.options.getString('name');
    name = name.trim();
    if (!name) {
        return interaction.reply({ content: '❌ Name cannot be empty.', ephemeral: true });
    }
    if (name.length > MAX_LEN) {
        return interaction.reply({ content: `❌ Name must be **${MAX_LEN}** characters or fewer.`, ephemeral: true });
    }

    await updateSystemConfig(interaction.guildId, (c) => {
        if (!c.factionDisplayNames) c.factionDisplayNames = {};
        c.factionDisplayNames[faction] = name;
    });

    return interaction.reply({
        content:
            `**Server faction display settings**\n\n` +
            `✅ **Updated server display for ${faction}.** Global faction unchanged.\n\n` +
            `**Server display name:** ${name}\n` +
            `**Global faction:** ${faction} (always — \`/faction join\` and commands use this name)\n\n` +
            `To change how this faction looks with an **emoji** in *this* server only, use **\`/faction_emoji\`**.\n\n` +
            `_Display rename/emoji are **local**; they do **not** rename the global faction._`,
        ephemeral: true,
    });
}

module.exports = { executeFactionRename };
