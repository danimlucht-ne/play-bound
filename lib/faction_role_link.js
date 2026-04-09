'use strict';

const { updateSystemConfig } = require('./db');
const { assertBotCanAssignRole } = require('./factionGuild');

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function executeFactionRoleLink(interaction) {
    const faction = interaction.options.getString('faction');
    const role = interaction.options.getRole('role');
    const guild = interaction.guild;

    const err = assertBotCanAssignRole(guild, role);
    if (err) {
        return interaction.reply({ content: `❌ ${err}`, ephemeral: true });
    }

    await updateSystemConfig(interaction.guildId, (c) => {
        if (!c.factionRoleMap) c.factionRoleMap = {};
        c.factionRoleMap[faction] = role.id;
    });

    return interaction.reply({
        content: `✅ **${faction}** is now linked to ${role}.\nOn **/faction join** or **switch**, members receive this role and lose other linked faction roles.`,
        ephemeral: true,
    });
}

module.exports = { executeFactionRoleLink };
