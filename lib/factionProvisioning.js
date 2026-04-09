'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { SystemConfig } = require('../models');

/**
 * Ensure a Discord role exists for the faction in this guild.
 * If `config.factionRoleMap[factionName]` already has an entry, verifies the role
 * still exists in Discord; if deleted, clears the stale ID and re-creates.
 * Otherwise creates `{FACTION_NAME}_MEMBER` and persists to SystemConfig.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} factionName — canonical faction name (e.g. 'Dragons')
 * @param {import('../models').SystemConfig} config
 * @returns {Promise<{ roleId: string|null, created: boolean, error: string|null }>}
 */
async function ensureFactionRole(guild, factionName, config) {
    try {
        const existingRoleId = config.factionRoleMap && config.factionRoleMap[factionName];

        // If we have a stored role ID, verify it still exists in Discord
        if (existingRoleId) {
            const role = await guild.roles.fetch(existingRoleId).catch(() => null);
            if (role) {
                return { roleId: existingRoleId, created: false, error: null };
            }
            // Role was deleted externally — clear the stale ID
            await SystemConfig.findOneAndUpdate(
                { guildId: guild.id },
                { $set: { [`factionRoleMap.${factionName}`]: null } },
            );
        }

        // Create the role
        const roleName = `${factionName.toUpperCase()}_MEMBER`;
        const role = await guild.roles.create({
            name: roleName,
            reason: 'PlayBound faction auto-provision',
        });

        // Persist to SystemConfig
        await SystemConfig.findOneAndUpdate(
            { guildId: guild.id },
            { $set: { [`factionRoleMap.${factionName}`]: role.id } },
        );

        return { roleId: role.id, created: true, error: null };
    } catch (err) {
        const msg = err && err.code === 50013
            ? 'Missing Manage Roles permission'
            : (err.message || 'Unknown error creating faction role');
        return { roleId: null, created: false, error: msg };
    }
}

/**
 * Ensure a private text channel exists for the faction in this guild.
 * If `config.factionChannelMap[factionName]` already has an entry, verifies the channel
 * still exists in Discord; if deleted, clears the stale ID and re-creates.
 * Otherwise creates `{faction-name}-hq` with permission overwrites locked to the
 * faction role and the bot.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} factionName — canonical faction name (e.g. 'Dragons')
 * @param {import('../models').SystemConfig} config
 * @param {string} roleId — the faction role ID to grant access
 * @returns {Promise<{ channelId: string|null, created: boolean, error: string|null }>}
 */
async function ensureFactionChannel(guild, factionName, config, roleId) {
    try {
        const existingChannelId = config.factionChannelMap && config.factionChannelMap[factionName];

        // If we have a stored channel ID, verify it still exists in Discord
        if (existingChannelId) {
            const channel = await guild.channels.fetch(existingChannelId).catch(() => null);
            if (channel) {
                return { channelId: existingChannelId, created: false, error: null };
            }
            // Channel was deleted externally — clear the stale ID
            await SystemConfig.findOneAndUpdate(
                { guildId: guild.id },
                { $set: { [`factionChannelMap.${factionName}`]: null } },
            );
        }

        // Create the channel with permission overwrites
        const channelName = `${factionName.toLowerCase()}-hq`;
        const channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                },
                {
                    id: roleId,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                },
                {
                    id: guild.members.me.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                },
            ],
        });

        // Persist to SystemConfig
        await SystemConfig.findOneAndUpdate(
            { guildId: guild.id },
            { $set: { [`factionChannelMap.${factionName}`]: channel.id } },
        );

        return { channelId: channel.id, created: true, error: null };
    } catch (err) {
        const msg = err && err.code === 50013
            ? 'Missing Manage Channels permission'
            : (err.message || 'Unknown error creating faction channel');
        return { channelId: null, created: false, error: msg };
    }
}

module.exports = { ensureFactionRole, ensureFactionChannel };
