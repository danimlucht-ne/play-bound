'use strict';

const { updateSystemConfig } = require('./db');
const { normalizeAchievementEmoji } = require('./achievements');

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function executeFactionEmoji(interaction) {
    const faction = interaction.options.getString('faction');
    const clear = interaction.options.getBoolean('clear') === true;
    const emojiRaw = interaction.options.getString('emoji');

    if (clear) {
        await updateSystemConfig(interaction.guildId, (c) => {
            if (!c.factionDisplayEmojis) c.factionDisplayEmojis = {};
            c.factionDisplayEmojis[faction] = null;
        });
        return interaction.reply({
            content:
                `✅ **Cleared server display emoji** for **${faction}**. Global faction unchanged — the official emoji from the faction profile shows again here.`,
            ephemeral: true,
        });
    }

    if (emojiRaw == null || !String(emojiRaw).trim()) {
        return interaction.reply({
            content: '❌ Provide an **emoji**, or set **clear** to remove the custom emoji.',
            ephemeral: true,
        });
    }

    const emojiNorm = normalizeAchievementEmoji(emojiRaw);
    if (emojiNorm == null) {
        return interaction.reply({
            content: '❌ Invalid **emoji**. Use a Unicode emoji, or paste a custom emoji from this server (`<:name:id>`).',
            ephemeral: true,
        });
    }

    await updateSystemConfig(interaction.guildId, (c) => {
        if (!c.factionDisplayEmojis) c.factionDisplayEmojis = {};
        c.factionDisplayEmojis[faction] = emojiNorm;
    });

    return interaction.reply({
        content:
            `**Server faction display settings**\n\n` +
            `✅ **Updated server display emoji for ${faction}.** Global faction unchanged.\n\n` +
            `**Server display emoji:** ${emojiNorm}\n` +
            `**Global faction:** ${faction}\n\n` +
            `_This only affects **this server**. It does **not** change the global faction._`,
        ephemeral: true,
    });
}

module.exports = { executeFactionEmoji };
