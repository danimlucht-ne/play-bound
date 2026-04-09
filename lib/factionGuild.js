'use strict';

const { GLOBAL_FACTION_KEYS } = require('./factionKeys');

/**
 * Display name for a faction in embeds (guild override or canonical name).
 * @param {string|null|undefined} faction
 * @param {import('../models').SystemConfig|null} [config]
 */
function getFactionDisplayName(faction, config) {
    if (!faction) return '—';
    const map = config && config.factionDisplayNames;
    const custom = map && map[faction];
    if (custom && String(custom).trim()) return String(custom).trim();
    return faction;
}

/**
 * Display emoji for a faction in this server (override or canonical from `Faction` doc).
 * @param {string|null|undefined} faction
 * @param {import('../models').SystemConfig|null} [config]
 * @param {string|null|undefined} canonicalEmoji — from global `Faction.emoji` when known
 */
function getFactionDisplayEmoji(faction, config, canonicalEmoji) {
    if (!faction) return canonicalEmoji && String(canonicalEmoji).trim() ? String(canonicalEmoji).trim() : '⚔️';
    const map = config && config.factionDisplayEmojis;
    const custom = map && map[faction];
    if (custom && String(custom).trim()) return String(custom).trim();
    if (canonicalEmoji != null && String(canonicalEmoji).trim()) return String(canonicalEmoji).trim();
    return '⚔️';
}

/**
 * Server-facing label: `Fire Lizards (Eagles)` when display name differs from global identity; otherwise `Eagles`.
 * @param {string|null|undefined} canonicalFactionName
 * @param {import('../models').SystemConfig|null} [config]
 */
function formatFactionDualLabel(canonicalFactionName, config) {
    if (!canonicalFactionName) return '—';
    const display = getFactionDisplayName(canonicalFactionName, config);
    if (display === canonicalFactionName) return canonicalFactionName;
    return `${display} (${canonicalFactionName})`;
}

/**
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').Role} role
 * @returns {string|null} Error message, or null if OK
 */
function assertBotCanAssignRole(guild, role) {
    const me = guild.members.me;
    if (!me) return 'Bot member not available in this guild.';
    if (!role) return 'Role not found.';
    if (role.managed) return 'That role is managed by an integration; pick a normal server role.';
    if (me.roles.highest.position <= role.position) {
        return 'Move the **PlayBound** bot role **above** the target role in Server Settings → Roles, then try again.';
    }
    return null;
}

/**
 * Apply faction-linked roles: remove other faction roles, add target (or strip all if `factionName` is null).
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 * @param {import('../models').SystemConfig} config
 * @param {string|null} factionName — `null` if user left factions
 */
async function syncFactionMemberRoles(guild, userId, config, factionName) {
    const map = config && config.factionRoleMap;
    if (!map) return;

    const roleIds = GLOBAL_FACTION_KEYS.map((k) => map[k]).filter(Boolean);
    if (roleIds.length === 0) return;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    const targetId = factionName && map[factionName] ? map[factionName] : null;

    for (const rid of roleIds) {
        if (rid === targetId) continue;
        if (member.roles.cache.has(rid)) {
            await member.roles.remove(rid, 'Faction role sync').catch(() => {});
        }
    }

    if (targetId && !member.roles.cache.has(targetId)) {
        await member.roles.add(targetId, 'Faction membership').catch(() => {});
    }
}

module.exports = {
    getFactionDisplayName,
    getFactionDisplayEmoji,
    formatFactionDualLabel,
    assertBotCanAssignRole,
    syncFactionMemberRoles,
};
