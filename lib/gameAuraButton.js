'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const AURA_PREFIX = 'pb_aura_';

function auraBoostRow(gameKey) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${AURA_PREFIX}${gameKey}`)
            .setLabel('✨ Boost session (~1.35× pts for everyone)')
            .setStyle(ButtonStyle.Success),
    );
}

function parseAuraGameKey(customId) {
    if (!customId || !customId.startsWith(AURA_PREFIX)) return null;
    return customId.slice(AURA_PREFIX.length);
}

module.exports = {
    AURA_PREFIX,
    auraBoostRow,
    parseAuraGameKey,
};
