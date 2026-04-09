'use strict';

const { Faction, FactionChallenge, User } = require('../models');
const { CANONICAL_FACTION_EMOJI, GLOBAL_FACTION_KEYS } = require('./factionKeys');
const { getExcludedGuildIds, guildIdNotExcludedMatch } = require('./publicStatsExclude');

/** Lean `Faction`-shaped row when the DB has no doc yet for an official team. */
function defaultOfficialFactionLean(name) {
    return {
        name,
        emoji: CANONICAL_FACTION_EMOJI[name] || '⚔️',
        desc: '',
        totalPoints: 0,
        matchPoints: 0,
        rankedWins: 0,
        rankedLosses: 0,
        rankedTies: 0,
        rawWarContributionTotal: 0,
        seasonHighlightLabel: null,
        seasonHighlightUntil: null,
    };
}

/**
 * Global faction standings: official **match points** from ranked wars + member counts from User.
 * @returns {Promise<Array<{ name: string, emoji?: string, desc?: string, matchPoints: number, rankedWins: number, rankedLosses: number, rankedTies: number, rawWarContributionTotal: number, legacyChallengePoints: number, members: number, seasonHighlightLabel: string|null, seasonHighlightActive: boolean }>>}
 */
async function getGlobalFactionStandingsFromUsers() {
    const gEx = guildIdNotExcludedMatch();
    const meta = await Faction.find({})
        .select(
            'name emoji desc totalPoints matchPoints rankedWins rankedLosses rankedTies rawWarContributionTotal seasonHighlightLabel seasonHighlightUntil',
        )
        .lean();
    const metaByName = new Map(meta.map((m) => [m.name, m]));
    const officialSet = new Set(GLOBAL_FACTION_KEYS);
    const merged = [
        ...GLOBAL_FACTION_KEYS.map((name) => metaByName.get(name) || defaultOfficialFactionLean(name)),
        ...meta.filter((m) => !officialSet.has(m.name)),
    ];
    const totals = await User.aggregate([
        {
            $match: {
                userId: { $ne: 'SYSTEM' },
                faction: { $nin: [null, ''] },
                ...gEx,
            },
        },
        {
            $group: {
                _id: '$faction',
                members: { $sum: 1 },
            },
        },
    ]);
    const byName = new Map(totals.map((t) => [t._id, t]));
    return merged
        .map((f) => {
            const t = byName.get(f.name);
            const hlUntil = f.seasonHighlightUntil ? new Date(f.seasonHighlightUntil).getTime() : 0;
            const seasonHighlightActive =
                Boolean(f.seasonHighlightLabel) && hlUntil > Date.now();
            return {
                name: f.name,
                emoji: f.emoji || CANONICAL_FACTION_EMOJI[f.name] || '⚔️',
                desc: f.desc,
                matchPoints: Math.round(Number(f.matchPoints || 0)),
                rankedWins: Math.round(Number(f.rankedWins || 0)),
                rankedLosses: Math.round(Number(f.rankedLosses || 0)),
                rankedTies: Math.round(Number(f.rankedTies || 0)),
                rawWarContributionTotal: Math.round(Number(f.rawWarContributionTotal || 0)),
                legacyChallengePoints: Math.round(Number(f.totalPoints || 0)),
                members: Math.round(Number(t?.members || 0)),
                seasonHighlightLabel: f.seasonHighlightLabel || null,
                seasonHighlightActive,
            };
        })
        .sort((a, b) => {
            if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints;
            if (b.rankedWins !== a.rankedWins) return b.rankedWins - a.rankedWins;
            if (b.rawWarContributionTotal !== a.rawWarContributionTotal) return b.rawWarContributionTotal - a.rawWarContributionTotal;
            return String(a.name).localeCompare(String(b.name));
        });
}

/**
 * Global totals for one faction name (excluded guilds omitted for member count; points are global stored).
 */
async function getGlobalFactionTotalsForName(factionName) {
    if (!factionName) {
        return {
            matchPoints: 0,
            rankedWins: 0,
            rankedLosses: 0,
            rankedTies: 0,
            rawWarContributionTotal: 0,
            legacyChallengePoints: 0,
            members: 0,
        };
    }
    const fac = await Faction.findOne({ name: factionName })
        .select('totalPoints matchPoints rankedWins rankedLosses rankedTies rawWarContributionTotal')
        .lean();
    const gEx = guildIdNotExcludedMatch();
    const rows = await User.aggregate([
        {
            $match: {
                userId: { $ne: 'SYSTEM' },
                faction: factionName,
                ...gEx,
            },
        },
        {
            $group: {
                _id: null,
                members: { $sum: 1 },
            },
        },
    ]);
    const r = rows[0];
    return {
        matchPoints: Math.round(Number(fac?.matchPoints || 0)),
        rankedWins: Math.round(Number(fac?.rankedWins || 0)),
        rankedLosses: Math.round(Number(fac?.rankedLosses || 0)),
        rankedTies: Math.round(Number(fac?.rankedTies || 0)),
        rawWarContributionTotal: Math.round(Number(fac?.rawWarContributionTotal || 0)),
        legacyChallengePoints: Math.round(Number(fac?.totalPoints || 0)),
        members: Math.round(Number(r?.members || 0)),
    };
}

/**
 * Top guilds by summed **challenge** raw totals for a faction (ended challenges with snapshots only).
 */
async function getTopGuildsForFactionChallengePoints(factionName, limit = 5) {
    const ex = getExcludedGuildIds();
    const match = {
        status: 'ended',
        challengeMode: { $ne: 'unranked' },
        [`finalRawTotalsByFaction.${factionName}`]: { $exists: true, $ne: null },
    };
    if (ex.length) match.guildId = { $nin: ex };

    const challenges = await FactionChallenge.find(match).select('guildId finalRawTotalsByFaction').lean();
    const byGuild = new Map();
    for (const c of challenges) {
        const blob = c.finalRawTotalsByFaction;
        if (!blob || typeof blob !== 'object') continue;
        const pts = Number(blob[factionName]);
        if (!Number.isFinite(pts) || pts <= 0) continue;
        byGuild.set(c.guildId, (byGuild.get(c.guildId) || 0) + pts);
    }
    const sorted = [...byGuild.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);

    const gEx = guildIdNotExcludedMatch();
    const memberRows = await User.aggregate([
        { $match: { faction: factionName, userId: { $ne: 'SYSTEM' }, ...gEx } },
        { $group: { _id: '$guildId', n: { $sum: 1 } } },
    ]);
    const memberByGuild = new Map(memberRows.map((m) => [m._id, m.n]));

    return sorted.map(([guildId, pts]) => ({
        guildId,
        pts: Math.round(pts),
        n: memberByGuild.get(guildId) || 0,
    }));
}

module.exports = {
    getGlobalFactionStandingsFromUsers,
    getGlobalFactionTotalsForName,
    getTopGuildsForFactionChallengePoints,
};
