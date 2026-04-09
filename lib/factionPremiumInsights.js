'use strict';

const { User, FactionSeasonStats } = require('../models');
const { getParticipantIds, getScoreByUser } = require('./factionChallenge');

function teamCountedPointSum(challenge, factionName) {
    let sum = 0;
    for (const uid of getParticipantIds(challenge, factionName)) {
        sum += getScoreByUser(challenge, uid);
    }
    return sum;
}

/**
 * Match-point gaps on the official board (read-only context).
 * @param {Array<{ name: string, matchPoints: number }>} standings
 * @param {string} userFactionName
 * @returns {string|null}
 */
function formatPremiumGlobalBoardGap(standings, userFactionName) {
    if (!userFactionName || !standings?.length) return null;
    const idx = standings.findIndex((f) => f.name === userFactionName);
    if (idx < 0) return null;
    const row = standings[idx];
    const parts = [`Board position **#${idx + 1}** of **${standings.length}** factions.`];
    if (idx > 0) {
        const above = standings[idx - 1];
        const gap = (above.matchPoints || 0) - (row.matchPoints || 0);
        parts.push(`**${gap}** match pts behind **${above.name}** (${above.matchPoints} vs ${row.matchPoints}).`);
    }
    if (idx < standings.length - 1) {
        const below = standings[idx + 1];
        const lead = (row.matchPoints || 0) - (below.matchPoints || 0);
        parts.push(`**${lead}** match pts ahead of **${below.name}**.`);
    }
    parts.push('_Match points only move from **ranked** war outcomes — same for everyone._');
    return parts.join('\n');
}

/**
 * Enrolled roster: team counted-war total and your share vs team average (base score only).
 * @param {import('mongoose').Document} challenge
 * @returns {string|null}
 */
function formatPremiumWarRosterInsight(challenge, userId, userFactionName, enrolled) {
    if (!enrolled || !userFactionName || !challenge) return null;
    const ids = [...getParticipantIds(challenge, userFactionName)];
    const n = ids.length;
    if (n === 0) return null;
    const total = teamCountedPointSum(challenge, userFactionName);
    const avg = total / n;
    const mine = getScoreByUser(challenge, userId);
    const delta = mine - avg;
    const sign = delta >= 0 ? '+' : '';
    return (
        `Roster **${n}** · Team **counted** war total **${total.toLocaleString()}** (_base mini-game score only_)\n` +
        `Avg per enrolled player: **${avg.toFixed(1)}** · You: **${mine.toLocaleString()}** (${sign}${delta.toFixed(1)} vs avg)\n` +
        `_Insight only — same caps and rules for every player._`
    );
}

/**
 * @param {string} seasonKey
 * @param {string} factionName
 * @returns {Promise<string|null>}
 */
async function formatPremiumSeasonFactionPlacement(seasonKey, factionName) {
    if (!seasonKey || !factionName) return null;
    const rows = await FactionSeasonStats.find({ seasonKey })
        .select('factionName matchPoints wins losses ties')
        .sort({ matchPoints: -1, wins: -1, losses: 1, factionName: 1 })
        .lean();
    const idx = rows.findIndex((r) => r.factionName === factionName);
    if (idx < 0) {
        return (
            `**${factionName}** has no seasonal row yet — **ranked** war **match points** this quarter will show up here.\n` +
            '_Season MP follows the same rules as the global board._'
        );
    }
    const r = rows[idx];
    const parts = [
        `**${factionName}** · **#${idx + 1}** this quarter among factions with data (**${r.matchPoints}** season MP · W ${r.wins} · L ${r.losses} · T ${r.ties}).`,
    ];
    if (idx > 0) {
        const above = rows[idx - 1];
        const gap = (above.matchPoints || 0) - (r.matchPoints || 0);
        parts.push(`**${gap}** season MP behind **${above.factionName}**.`);
    }
    parts.push('_Premium shows placement only — it does not change scoring._');
    return parts.join('\n');
}

/**
 * @param {string} guildId
 * @param {string} userFaction
 * @param {number} competitivePoints
 * @returns {Promise<string|null>}
 */
async function formatPremiumServerArenaRank(guildId, userFaction, competitivePoints) {
    if (!guildId || !userFaction) return null;
    const pts = Number(competitivePoints) || 0;
    const ahead = await User.countDocuments({
        guildId,
        faction: userFaction,
        userId: { $ne: 'SYSTEM' },
        competitivePoints: { $gt: pts },
    });
    const total = await User.countDocuments({
        guildId,
        faction: userFaction,
        userId: { $ne: 'SYSTEM' },
    });
    if (total === 0) return null;
    const rank = ahead + 1;
    return `**#${rank}** of **${total}** in this server on your faction by **Arena score** (_activity here, not global war standings_).`;
}

module.exports = {
    formatPremiumGlobalBoardGap,
    formatPremiumWarRosterInsight,
    formatPremiumSeasonFactionPlacement,
    formatPremiumServerArenaRank,
};
