'use strict';

/**
 * Quarterly / yearly faction & server seasons on top of ranked wars (match points).
 * UTC boundaries. Does not modify lifetime Faction.matchPoints — only seasonal aggregates.
 */

const {
    Season,
    FactionSeasonStats,
    ServerSeasonStats,
    SeasonAuditLog,
    Faction,
    User,
} = require('../models');
const { isGuildExcludedFromGlobalCounts } = require('./publicStatsExclude');

const WAR_PARTICIPATION_WEIGHT = 0.25;
const AVG_OFFICIAL_TOP_WEIGHT = 2;

function seasonAutomationEnabled() {
    if (process.env.SEASON_AUTOMATION_ENABLED === '0' || process.env.SEASON_AUTOMATION_ENABLED === 'false') return false;
    return true;
}

function seasonRewardsEnabled() {
    if (process.env.SEASON_REWARDS_ENABLED === '0' || process.env.SEASON_REWARDS_ENABLED === 'false') return false;
    return true;
}

function yearlySeasonRewardsEnabled() {
    if (process.env.YEARLY_SEASON_REWARDS_ENABLED === '0' || process.env.YEARLY_SEASON_REWARDS_ENABLED === 'false') return false;
    return true;
}

/** @returns {{ year: number, quarter: number }} */
function utcQuarterForDate(d) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const q = Math.floor(m / 3) + 1;
    return { year: y, quarter: q };
}

function quarterSeasonKey(year, quarter) {
    return `${year}-Q${quarter}`;
}

/** @returns {{ startAt: Date, endAt: Date }} */
function quarterBoundsUtc(year, quarter) {
    const start = new Date(Date.UTC(year, (quarter - 1) * 3, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, quarter * 3, 0, 23, 59, 59, 999));
    return { startAt: start, endAt: end };
}

function yearSeasonKey(year) {
    return `${year}-Y`;
}

function yearBoundsUtc(year) {
    return {
        startAt: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)),
        endAt: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
    };
}

function computeServerComposite(s) {
    const played = Number(s.rankedWarsHosted || 0);
    const wins = Number(s.warsWon || 0);
    const ties = Number(s.warsTied || 0);
    const cnt = Number(s.countOfficialTop || 0);
    const sumTop = Number(s.sumOfficialTop || 0);
    const avgTop = cnt > 0 ? sumTop / cnt : 0;
    return wins * 3 + ties * 1 + played * WAR_PARTICIPATION_WEIGHT + avgTop * AVG_OFFICIAL_TOP_WEIGHT;
}

async function audit(action, detail) {
    try {
        await SeasonAuditLog.create({ action, detail: detail || {}, createdAt: new Date() });
    } catch (e) {
        console.error('[Seasons] audit log failed', e);
    }
}

/**
 * Ensure DB has an active quarter season row for `d` (UTC).
 * @returns {Promise<import('mongoose').Document|null>}
 */
async function ensureActiveQuarterSeasonForDate(d = new Date()) {
    const { year, quarter } = utcQuarterForDate(d);
    const key = quarterSeasonKey(year, quarter);
    const { startAt, endAt } = quarterBoundsUtc(year, quarter);

    const doc = await Season.findOneAndUpdate(
        { seasonKey: key, type: 'quarter' },
        {
            $setOnInsert: {
                seasonKey: key,
                type: 'quarter',
                year,
                quarter,
                startAt,
                endAt,
                status: 'active',
            },
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    if (doc.status === 'completed') return null;
    return doc;
}

/**
 * After a ranked war is merged globally, add seasonal stats (same idempotence as global merge).
 * @param {string} guildId
 * @param {import('mongoose').Document} challenge — ended, globalTotalsApplied
 * @param {object} payload — from buildEndgameGlobalMergePayload
 */
/**
 * One Discord user (highest max Arena score across guild rows) in the winning faction.
 * @param {string} factionName
 * @param {string} achievementKey
 */
async function grantFactionSeasonMvpAchievement(factionName, achievementKey) {
    if (!factionName || !achievementKey) return;
    const mvpRows = await User.aggregate([
        { $match: { faction: factionName, userId: { $ne: 'SYSTEM' } } },
        { $group: { _id: '$userId', mp: { $max: '$competitivePoints' } } },
        { $sort: { mp: -1, _id: 1 } },
        { $limit: 1 },
    ]).exec();
    const mvpId = mvpRows[0]?._id;
    if (!mvpId) return;
    await User.updateMany({ userId: mvpId }, { $addToSet: { achievements: achievementKey } }).catch(() => {});
}

async function recordRankedWarSeasonStats(guildId, challenge, payload) {
    if (!seasonAutomationEnabled()) return;
    if (isGuildExcludedFromGlobalCounts(guildId)) return;

    const now = challenge.endedAt ? new Date(challenge.endedAt) : new Date();
    const season = await ensureActiveQuarterSeasonForDate(now);
    if (!season || season.status !== 'active') return;

    const seasonKey = season.seasonKey;
    const names = Object.keys(payload.matchPointsByFaction || {});

    for (const factionName of names) {
        const mp = Math.round(Number(payload.matchPointsByFaction[factionName] || 0));
        const w = Math.round(Number(payload.winsInc[factionName] || 0));
        const l = Math.round(Number(payload.lossesInc[factionName] || 0));
        const t = Math.round(Number(payload.tiesInc[factionName] || 0));
        const raw = Math.round(Number(payload.rawTotals[factionName] || 0));
        const official = Number(payload.officialByFaction[factionName] || 0);

        const inc = {
            matchPoints: mp,
            wins: w,
            losses: l,
            ties: t,
            rawContributionTotal: raw,
            officialScoreTotal: Number.isFinite(official) ? official : 0,
        };
        await FactionSeasonStats.findOneAndUpdate(
            { seasonKey, factionName },
            {
                $setOnInsert: { seasonKey, factionName, finalized: false, rank: null },
                $inc: inc,
            },
            { upsert: true },
        );
    }

    const rawVals = Object.values(payload.rawTotals || {}).map((x) => Math.round(Number(x) || 0));
    const totalRaw = rawVals.reduce((a, b) => a + b, 0);
    const officials = Object.values(payload.officialByFaction || {}).map((x) => Number(x) || 0);
    const topOfficial = officials.length ? Math.max(...officials) : 0;
    const winner = challenge.winnerFaction || null;
    const isFullTie = !winner;

    await ServerSeasonStats.findOneAndUpdate(
        { seasonKey, guildId },
        {
            $setOnInsert: { seasonKey, guildId, finalized: false, rank: null },
            $inc: {
                rankedWarsHosted: 1,
                totalRawContribution: totalRaw,
                sumOfficialTop: topOfficial,
                countOfficialTop: 1,
                warsTied: isFullTie ? 1 : 0,
                warsWon: !isFullTie ? 1 : 0,
            },
        },
        { upsert: true },
    );

}

function sortFactionSeasonRows(rows) {
    return [...rows].sort((a, b) => {
        if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints;
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.officialScoreTotal !== a.officialScoreTotal) return b.officialScoreTotal - a.officialScoreTotal;
        return String(a.factionName).localeCompare(String(b.factionName));
    });
}

function sortServerSeasonRows(rows) {
    return [...rows].sort((a, b) => {
        const ca = computeServerComposite(a);
        const cb = computeServerComposite(b);
        if (cb !== ca) return cb - ca;
        if (b.warsWon !== a.warsWon) return b.warsWon - a.warsWon;
        if (b.rankedWarsHosted !== a.rankedWarsHosted) return b.rankedWarsHosted - a.rankedWarsHosted;
        return String(a.guildId).localeCompare(String(b.guildId));
    });
}

/**
 * @param {string} seasonKey e.g. 2026-Q1
 * @param {import('discord.js').Client|null} client
 */
async function finalizeQuarterSeason(seasonKey, client = null) {
    const season = await Season.findOne({ seasonKey, type: 'quarter' });
    if (!season || season.status !== 'active') return { ok: false, reason: 'not_active' };

    const fRows = await FactionSeasonStats.find({ seasonKey }).lean();
    const sortedF = sortFactionSeasonRows(fRows);
    let rnk = 1;
    for (const row of sortedF) {
        await FactionSeasonStats.updateOne(
            { _id: row._id },
            { $set: { rank: rnk, finalized: true, compositeScore: row.matchPoints } },
        );
        rnk += 1;
    }

    const sRows = await ServerSeasonStats.find({ seasonKey }).lean();
    const sortedS = sortServerSeasonRows(sRows);
    rnk = 1;
    for (const row of sortedS) {
        const comp = computeServerComposite(row);
        await ServerSeasonStats.updateOne(
            { _id: row._id },
            { $set: { rank: rnk, finalized: true, serverCompositeScore: comp } },
        );
        rnk += 1;
    }

    const winnerF = sortedF[0]?.factionName || null;
    const topF = sortedF.slice(0, 3).map((x) => x.factionName);
    const winnerG = sortedS[0]?.guildId || null;
    const topG = sortedS.slice(0, 5).map((x) => x.guildId);

    const qLabel = `Q${season.quarter} ${season.year}`;
    const badgeKey = `SEASON_Q${season.quarter}_${season.year}_FACTION_CHAMP`;

    await Season.updateOne(
        { _id: season._id },
        {
            $set: {
                status: 'completed',
                finalizedAt: new Date(),
                winningFactionName: winnerF,
                topFactionNames: topF,
                winningGuildId: winnerG,
                topGuildIds: topG,
                rewardMeta: {
                    quarterLabel: qLabel,
                    factionAchievementKey: badgeKey,
                },
            },
        },
    );

    if (seasonRewardsEnabled() && winnerF) {
        const until = nextQuarterStartUtc(season.year, season.quarter);
        await Faction.updateOne(
            { name: winnerF },
            {
                $set: {
                    seasonHighlightLabel: `${qLabel} Champions`,
                    seasonHighlightUntil: until,
                },
                $addToSet: { seasonQuarterWins: seasonKey },
            },
        ).catch(() => {});

        await User.updateMany(
            { faction: winnerF, userId: { $ne: 'SYSTEM' } },
            { $addToSet: { achievements: badgeKey } },
        ).catch(() => {});
    }

    const quarterTopServerKey = `SEASON_Q${season.quarter}_${season.year}_TOP_SERVER`;
    const quarterMvpKey = `SEASON_Q${season.quarter}_${season.year}_FACTION_MVP`;
    if (seasonRewardsEnabled() && winnerG) {
        await User.updateMany(
            { guildId: winnerG, userId: { $ne: 'SYSTEM' } },
            { $addToSet: { achievements: quarterTopServerKey } },
        ).catch(() => {});
    }
    if (seasonRewardsEnabled() && winnerF) {
        await grantFactionSeasonMvpAchievement(winnerF, quarterMvpKey);
    }

    await audit('quarter_finalized', {
        seasonKey,
        winningFactionName: winnerF,
        winningGuildId: winnerG,
    });

    const y = season.year;
    const q = season.quarter;
    if (y != null && q != null) {
        const nq = q >= 4 ? { ny: y + 1, nq: 1 } : { ny: y, nq: q + 1 };
        const nk = quarterSeasonKey(nq.ny, nq.nq);
        const nb = quarterBoundsUtc(nq.ny, nq.nq);
        await Season.findOneAndUpdate(
            { seasonKey: nk, type: 'quarter' },
            {
                $setOnInsert: {
                    seasonKey: nk,
                    type: 'quarter',
                    year: nq.ny,
                    quarter: nq.nq,
                    startAt: nb.startAt,
                    endAt: nb.endAt,
                    status: 'active',
                },
            },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
        );
    }

    if (season.quarter === 4) {
        await finalizeYearSeason(season.year, client);
    }

    return { ok: true, seasonKey, winningFactionName: winnerF, winningGuildId: winnerG };
}

function nextQuarterStartUtc(year, quarter) {
    if (quarter >= 4) return new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
    return new Date(Date.UTC(year, quarter * 3, 1, 0, 0, 0, 0));
}

/**
 * Aggregate four quarters into a year championship season row.
 */
async function finalizeYearSeason(year, client = null) {
    const yKey = yearSeasonKey(year);
    const existing = await Season.findOne({ seasonKey: yKey, type: 'year' });
    if (existing?.status === 'completed') return { ok: false, reason: 'already_done' };

    const qKeys = [1, 2, 3, 4].map((q) => quarterSeasonKey(year, q));
    const agg = await FactionSeasonStats.aggregate([
        { $match: { seasonKey: { $in: qKeys } } },
        {
            $group: {
                _id: '$factionName',
                matchPoints: { $sum: '$matchPoints' },
                wins: { $sum: '$wins' },
                losses: { $sum: '$losses' },
                ties: { $sum: '$ties' },
                officialScoreTotal: { $sum: '$officialScoreTotal' },
                rawContributionTotal: { $sum: '$rawContributionTotal' },
            },
        },
    ]);

    const rows = agg.map((a) => ({
        factionName: a._id,
        matchPoints: Math.round(a.matchPoints || 0),
        wins: Math.round(a.wins || 0),
        losses: Math.round(a.losses || 0),
        ties: Math.round(a.ties || 0),
        officialScoreTotal: Number(a.officialScoreTotal || 0),
        rawContributionTotal: Math.round(a.rawContributionTotal || 0),
    }));
    const sorted = sortFactionSeasonRows(rows);

    const { startAt, endAt } = yearBoundsUtc(year);
    const winnerF = sorted[0]?.factionName || null;
    const topF = sorted.slice(0, 3).map((x) => x.factionName);
    const badgeKey = `SEASON_YEAR_${year}_FACTION_CHAMP`;

    await Season.findOneAndUpdate(
        { seasonKey: yKey, type: 'year' },
        {
            $set: {
                seasonKey: yKey,
                type: 'year',
                year,
                quarter: null,
                startAt,
                endAt,
                status: 'completed',
                finalizedAt: new Date(),
                winningFactionName: winnerF,
                topFactionNames: topF,
                winningGuildId: null,
                topGuildIds: [],
                yearFactionSnapshot: sorted,
                rewardMeta: { yearLabel: String(year), factionAchievementKey: badgeKey },
            },
        },
        { upsert: true },
    );

    if (yearlySeasonRewardsEnabled() && winnerF) {
        await Faction.updateOne(
            { name: winnerF },
            { $addToSet: { seasonYearWins: year } },
        ).catch(() => {});
        await User.updateMany(
            { faction: winnerF, userId: { $ne: 'SYSTEM' } },
            { $addToSet: { achievements: badgeKey } },
        ).catch(() => {});
    }

    const sAgg = await ServerSeasonStats.aggregate([
        { $match: { seasonKey: { $in: qKeys } } },
        {
            $group: {
                _id: '$guildId',
                rankedWarsHosted: { $sum: '$rankedWarsHosted' },
                warsWon: { $sum: '$warsWon' },
                warsTied: { $sum: '$warsTied' },
                totalRawContribution: { $sum: '$totalRawContribution' },
                sumOfficialTop: { $sum: '$sumOfficialTop' },
                countOfficialTop: { $sum: '$countOfficialTop' },
            },
        },
    ]);
    const sRows = sAgg.map((a) => ({
        guildId: a._id,
        rankedWarsHosted: a.rankedWarsHosted || 0,
        warsWon: a.warsWon || 0,
        warsTied: a.warsTied || 0,
        totalRawContribution: a.totalRawContribution || 0,
        sumOfficialTop: a.sumOfficialTop || 0,
        countOfficialTop: a.countOfficialTop || 0,
    }));
    const sortedS = sortServerSeasonRows(sRows);
    const winnerG = sortedS[0]?.guildId || null;

    if (winnerG) {
        await Season.updateOne({ seasonKey: yKey, type: 'year' }, { $set: { winningGuildId: winnerG, topGuildIds: sortedS.slice(0, 5).map((x) => x.guildId) } });
    }

    const yearTopServerKey = `SEASON_YEAR_${year}_TOP_SERVER`;
    const yearMvpKey = `SEASON_YEAR_${year}_FACTION_MVP`;
    if (yearlySeasonRewardsEnabled() && winnerG) {
        await User.updateMany(
            { guildId: winnerG, userId: { $ne: 'SYSTEM' } },
            { $addToSet: { achievements: yearTopServerKey } },
        ).catch(() => {});
    }
    if (yearlySeasonRewardsEnabled() && winnerF) {
        await grantFactionSeasonMvpAchievement(winnerF, yearMvpKey);
    }

    await audit('year_finalized', { seasonKey: yKey, winningFactionName: winnerF, winningGuildId: winnerG });
    void client;
    return { ok: true, seasonKey: yKey, winningFactionName: winnerF, winningGuildId: winnerG };
}

/** Hourly: complete overdue quarter seasons. */
async function processSeasonBoundaries(client = null) {
    if (!seasonAutomationEnabled()) return;
    const now = new Date();
    const overdue = await Season.find({
        type: 'quarter',
        status: 'active',
        endAt: { $lt: now },
    })
        .sort({ endAt: 1 })
        .lean();

    for (const s of overdue) {
        try {
            await finalizeQuarterSeason(s.seasonKey, client);
        } catch (e) {
            console.error('[Seasons] finalize failed', s.seasonKey, e);
        }
    }
}

async function getCurrentSeasonOverview() {
    const now = new Date();
    const { year, quarter } = utcQuarterForDate(now);
    const key = quarterSeasonKey(year, quarter);
    const { startAt, endAt } = quarterBoundsUtc(year, quarter);

    let season = await Season.findOne({ seasonKey: key, type: 'quarter' }).lean();
    if (!season || season.status !== 'active') {
        season = {
            seasonKey: key,
            type: 'quarter',
            year,
            quarter,
            startAt,
            endAt,
            status: 'active',
        };
    }

    const fStats = await FactionSeasonStats.find({ seasonKey: key }).sort({ matchPoints: -1, wins: -1 }).limit(10).lean();
    const sStats = await ServerSeasonStats.find({ seasonKey: key }).lean();
    const sSorted = sortServerSeasonRows(sStats).slice(0, 10);

    const msLeft = Math.max(0, new Date(season.endAt).getTime() - now.getTime());
    const daysLeft = Math.ceil(msLeft / 86400000);

    const lastQuarter = await Season.findOne({ type: 'quarter', status: 'completed' })
        .sort({ finalizedAt: -1 })
        .select('seasonKey winningFactionName winningGuildId finalizedAt rewardMeta')
        .lean();

    return {
        seasonKey: key,
        year,
        quarter,
        startAt: season.startAt,
        endAt: season.endAt,
        status: season.status || 'active',
        daysRemainingApprox: daysLeft,
        lastQuarterWinnerFaction: lastQuarter?.winningFactionName || null,
        lastQuarterWinnerGuildId: lastQuarter?.winningGuildId || null,
        lastQuarterKey: lastQuarter?.seasonKey || null,
        topFactions: fStats.map((r, i) => ({
            rank: i + 1,
            factionName: r.factionName,
            matchPoints: r.matchPoints || 0,
            wins: r.wins || 0,
            losses: r.losses || 0,
            ties: r.ties || 0,
        })),
        topServers: sSorted.map((r, i) => ({
            rank: i + 1,
            guildId: r.guildId,
            serverCompositeScore: computeServerComposite(r),
            warsWon: r.warsWon || 0,
            rankedWarsHosted: r.rankedWarsHosted || 0,
        })),
    };
}

async function getHallOfChampions(limit = 12) {
    const past = await Season.find({ status: 'completed', type: 'quarter' })
        .sort({ finalizedAt: -1 })
        .limit(limit)
        .select('seasonKey year quarter winningFactionName winningGuildId finalizedAt rewardMeta')
        .lean();
    const years = await Season.find({ status: 'completed', type: 'year' })
        .sort({ year: -1 })
        .limit(8)
        .select('seasonKey year winningFactionName winningGuildId finalizedAt')
        .lean();
    return { quarters: past, years };
}

async function getSeasonStandingsForKey(seasonKey) {
    const fac = await FactionSeasonStats.find({ seasonKey })
        .sort({ matchPoints: -1, wins: -1, officialScoreTotal: -1 })
        .lean();
    const srv = await ServerSeasonStats.find({ seasonKey }).lean();
    const srvSorted = sortServerSeasonRows(srv);
    return {
        seasonKey,
        factions: fac.map((r, i) => ({
            rank: r.rank != null ? r.rank : i + 1,
            factionName: r.factionName,
            matchPoints: r.matchPoints || 0,
            wins: r.wins || 0,
            losses: r.losses || 0,
            ties: r.ties || 0,
            officialScoreTotal: r.officialScoreTotal || 0,
            rawContributionTotal: r.rawContributionTotal || 0,
            finalized: !!r.finalized,
        })),
        servers: srvSorted.map((r, i) => ({
            rank: r.rank != null ? r.rank : i + 1,
            guildId: r.guildId,
            serverCompositeScore: computeServerComposite(r),
            warsWon: r.warsWon || 0,
            warsTied: r.warsTied || 0,
            rankedWarsHosted: r.rankedWarsHosted || 0,
            finalized: !!r.finalized,
        })),
    };
}

module.exports = {
    utcQuarterForDate,
    quarterSeasonKey,
    quarterBoundsUtc,
    ensureActiveQuarterSeasonForDate,
    recordRankedWarSeasonStats,
    finalizeQuarterSeason,
    finalizeYearSeason,
    processSeasonBoundaries,
    getCurrentSeasonOverview,
    getHallOfChampions,
    getSeasonStandingsForKey,
    computeServerComposite,
    seasonAutomationEnabled,
    seasonRewardsEnabled,
    yearlySeasonRewardsEnabled,
};
