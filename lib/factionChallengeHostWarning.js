'use strict';

const { getSystemConfig } = require('./db');
const { getFactionChallengeOverlapWarning } = require('./factionChallenge');

/**
 * Ephemeral suffix for Administrator / Bot Manager when starting a game that overlaps an active faction challenge.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {string} guildId
 * @param {number} delayMs
 * @param {string} gameTag
 * @returns {Promise<string>}
 */
async function getFactionChallengeStaffOverlapSuffix(interaction, guildId, delayMs, gameTag) {
    const config = await getSystemConfig(guildId);
    const isOwner = interaction.member?.permissions?.has('Administrator');
    const hasManager = config.managerRoleId && interaction.member?.roles?.cache?.has(config.managerRoleId);
    if (!isOwner && !hasManager) return '';
    const note = await getFactionChallengeOverlapWarning(guildId, delayMs, gameTag);
    return note ? `\n\n${note}` : '';
}

module.exports = { getFactionChallengeStaffOverlapSuffix };
