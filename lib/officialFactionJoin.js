'use strict';

const { EmbedBuilder } = require('discord.js');
const { Faction } = require('../models');
const { getUser, getSystemConfig, joinFactionAtomic, updateUser } = require('./db');
const { FACTION_JOIN_AFTER_LEAVE_COOLDOWN_MS } = require('./factionChallenge');
const { isGuildExcludedFromGlobalCounts } = require('./publicStatsExclude');
const {
    getFactionDisplayEmoji,
    formatFactionDualLabel,
    syncFactionMemberRoles,
} = require('./factionGuild');
const { ARENA_SCORE } = require('./pointBranding');
const { CANONICAL_FACTION_EMOJI, formatOfficialFactionListOxford } = require('./globalFactions');
const { ensureFactionRole, ensureFactionChannel } = require('./factionProvisioning');

/** Sidebar color per official team (Discord embed accent). */
const FACTION_JOIN_EMBED_COLORS = Object.freeze({
    Phoenixes: 0xe67e22,
    Unicorns: 0xe91e63,
    Fireflies: 0xf1c40f,
    Dragons: 0xe74c3c,
    Wolves: 0x78909c,
    Eagles: 0x3498db,
});

/**
 * @param {object} p
 * @param {string} p.joinName
 * @param {string} p.joinEm
 * @param {string} p.joinDual
 * @param {string} p.globalNote — sentence(s) about standings / wars (markdown ok)
 * @param {string} [p.provisionWarnings]
 */
function buildFactionJoinSuccessEmbed({ joinName, joinEm, joinDual, globalNote, provisionWarnings }) {
    const color = FACTION_JOIN_EMBED_COLORS[joinName] ?? 0x1abc9c;
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${joinEm} Welcome to ${joinDual}`)
        .setDescription(`Official team (global): **${joinName}** — same spelling on **/factions** everywhere.`)
        .addFields(
            {
                name: 'Ranked standings',
                value: globalNote,
                inline: false,
            },
            {
                name: ARENA_SCORE,
                value: 'Your score in *this server* is personal / server-only — not the global war board.',
                inline: false,
            },
        )
        .setFooter({ text: 'Recruit others · /faction_recruit (share a redeem code)' });
    if (provisionWarnings && provisionWarnings.trim()) {
        embed.addFields({
            name: 'Server setup',
            value: provisionWarnings.trim().slice(0, 1024),
            inline: false,
        });
    }
    return embed;
}

async function resolveFactionDocForJoin(joinName) {
    let factionDoc = await Faction.findOne({ name: joinName });
    if (!factionDoc) {
        const em = CANONICAL_FACTION_EMOJI[joinName];
        if (em) {
            try {
                factionDoc = await Faction.create({
                    name: joinName,
                    emoji: em,
                    desc: `The proud ${joinName} faction.`,
                });
            } catch (err) {
                if (err.code === 11000) {
                    factionDoc = await Faction.findOne({ name: joinName });
                } else {
                    throw err;
                }
            }
        } else {
            return null;
        }
    }
    return factionDoc;
}

/**
 * Same rules as `/faction join` (official global factions or existing `Faction` doc).
 * @returns {Promise<{ ok: true, joinName: string, embeds: import('discord.js').EmbedBuilder[], joinHeadline: string } | { ok: false, content: string }>}
 */
async function joinOfficialFactionInGuild(interaction, joinName) {
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const guild = interaction.guild;
    if (!guildId || !guild) {
        return { ok: false, content: 'Use this in a server.' };
    }
    const user = await getUser(guildId, userId);
    if (user.faction) {
        return {
            ok: false,
            content: `❌ You are already in **${user.faction}**. Use \`/faction leave\` or **Premium** \`/faction switch\`.`,
        };
    }
    if (
        !user.isPremium &&
        user.lastFactionLeaveAt &&
        Date.now() - user.lastFactionLeaveAt < FACTION_JOIN_AFTER_LEAVE_COOLDOWN_MS
    ) {
        const hrs = Math.ceil(
            (FACTION_JOIN_AFTER_LEAVE_COOLDOWN_MS - (Date.now() - user.lastFactionLeaveAt)) / 3600000,
        );
        return {
            ok: false,
            content:
                `⏳ After **/faction leave**, free accounts wait **~${hrs}h** before joining again.\n` +
                `💎 **Premium** can use **/faction switch** instead (separate **7-day** cooldown between switches).`,
        };
    }
    const factionDoc = await resolveFactionDocForJoin(joinName);
    if (!factionDoc) {
        return {
            ok: false,
            content:
                `❌ No faction named **${joinName}**. Official teams: ${formatOfficialFactionListOxford()} — use \`/factions\`.\n` +
                `_Admins can **rename** or change **emoji** per server with \`/faction_rename\` and \`/faction_emoji\` (global names stay the same)._`,
        };
    }
    const joinResult = await joinFactionAtomic(guildId, userId, joinName, {
        updateFactionMembers: !isGuildExcludedFromGlobalCounts(guildId),
    });
    if (!joinResult.ok) {
        return {
            ok: false,
            content: `❌ You are already in **${joinResult.currentFaction || joinName}**. Use \`/faction leave\` or **Premium** \`/faction switch\`.`,
        };
    }
    await updateUser(guildId, userId, (u) => {
        u.lastFactionLeaveAt = null;
    });
    let sysFaction = await getSystemConfig(guildId);
    await syncFactionMemberRoles(guild, userId, sysFaction, joinName);

    // Auto-provision faction role + channel
    let provisionWarnings = '';
    try {
        const roleResult = await ensureFactionRole(guild, joinName, sysFaction);
        if (roleResult.error) {
            provisionWarnings += `\n⚠️ Could not auto-create faction role: ${roleResult.error}`;
        } else if (roleResult.roleId) {
            if (roleResult.created) {
                // Re-fetch config so syncFactionMemberRoles sees the new role
                sysFaction = await getSystemConfig(guildId);
                await syncFactionMemberRoles(guild, userId, sysFaction, joinName);
            }
            const channelResult = await ensureFactionChannel(guild, joinName, sysFaction, roleResult.roleId);
            if (channelResult.error) {
                provisionWarnings += `\n⚠️ Could not auto-create faction channel: ${channelResult.error}`;
            }
        }
    } catch (_) {
        // Provisioning is best-effort; don't fail the join
    }

    const globalNote = isGuildExcludedFromGlobalCounts(guildId)
        ? '_This server is excluded from global faction totals (test/support)._'
        : 'Official order comes from **ranked** faction wars. When one is live, enroll with `/faction_challenge join`. Casual / unranked challenges only affect this server.';
    const joinEm = getFactionDisplayEmoji(joinName, sysFaction, factionDoc.emoji);
    const joinDual = formatFactionDualLabel(joinName, sysFaction);
    const embed = buildFactionJoinSuccessEmbed({
        joinName,
        joinEm,
        joinDual,
        globalNote,
        provisionWarnings,
    });
    const joinHeadline = `✅ ${joinEm} **${joinDual}** — you're in!`;
    return { ok: true, joinName, embeds: [embed], joinHeadline };
}

module.exports = { joinOfficialFactionInGuild, resolveFactionDocForJoin };
