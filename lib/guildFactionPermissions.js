'use strict';

const { isBotDeveloper } = require('./isBotDeveloper');

/**
 * @param {import('discord.js').GuildMember|null|undefined} member
 * @param {{ factionLeaderRoleId?: string|null }} guildConfig — `SystemConfig` or lean
 * @returns {boolean}
 */
function isFactionLeader(member, guildConfig) {
    if (!member?.roles?.cache) return false;
    const id = guildConfig?.factionLeaderRoleId;
    if (!id) return false;
    return member.roles.cache.has(id);
}

/**
 * Who may create / end faction challenges (still subject to Premium, daily limits, etc.).
 * @param {import('discord.js').GuildMember|null|undefined} member
 * @param {string|null|undefined} userId — Discord user id (for developer override)
 * @param {{ managerRoleId?: string|null, factionLeaderRoleId?: string|null }} guildConfig
 */
function canManageFactionChallenges(member, userId, guildConfig) {
    if (userId && isBotDeveloper(userId)) return true;
    if (!member?.permissions) return false;
    if (member.permissions.has('Administrator')) return true;
    if (guildConfig?.managerRoleId && member.roles?.cache?.has(guildConfig.managerRoleId)) return true;
    if (isFactionLeader(member, guildConfig)) return true;
    return false;
}

module.exports = {
    isFactionLeader,
    canManageFactionChallenges,
};
