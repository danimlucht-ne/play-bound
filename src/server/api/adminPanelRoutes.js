'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const {
    User,
    Game,
    RecurringGame,
    FactionChallenge,
    SystemConfig,
    ReferralFirstGamePayout,
    ReferralProfile,
    Season,
    SeasonAuditLog,
    GamePlatformDay,
    GamePlatformDailyStats,
    GamePlatformAuditLog,
    LegalPolicyConfig,
} = require('../../../models');
const factionSeasons = require('../../../lib/factionSeasons');
const { getGameSchedulingDenialMessage } = require('../../../lib/maintenanceScheduling');
const { requireAdminSession, scopeGuildIds, requireGuildAccess } = require('./adminAuth');
const { displayNameForUser, actorFromLabel } = require('./adminAdjustmentsRoutes');
const {
    getUser,
    addManualPointAdjustment,
    getSystemConfig,
    updateSystemConfig,
    refreshLeaderboard,
    resolveLeaderboardSort,
} = require('../../../lib/db');
const { adminTerminateGame } = require('../../../lib/adminGameMutations');
const {
    computeScores,
    pickChallengeWinner,
    expireStaleChallenges,
    getActiveChallenge,
    isRoyale,
    isChallengeRanked,
    grantFactionVictoryRoleIfConfigured,
    isUserEnrolledInActiveFactionChallenge,
    applyEndedChallengeToGlobalTotals,
} = require('../../../lib/factionChallenge');
const { grantWarEndPersonalCredits } = require('../../../lib/factionWarEconomyPayout');
const { getGlobalFactionStandingsFromUsers } = require('../../../lib/globalFactionAggregates');
const { countFactionChallengesOfTypeToday } = require('../../../lib/factionChallengeDailyLimits');
const { isBotDeveloper } = require('../../../lib/isBotDeveloper');
const { canManageFactionChallenges } = require('../../../lib/guildFactionPermissions');
const { ACHIEVEMENTS, resolveAchievementMeta } = require('../../../lib/achievements');
const { automatedServerPostsEnabled } = require('../../../lib/automatedPosts');
const { shouldPingEveryone } = require('../../../lib/announcements');
const { getSettings, updateSettings, allResolvedGames, resolveGame } = require('../../../lib/gamePlatform/configStore');
const { ensureRotationForDate, setManualDayOverride, utcDayString } = require('../../../lib/gamePlatform/rotation');
const { getAnalyticsRange } = require('../../../lib/gamePlatform/analytics');
const { previewPlatformScore } = require('../../../lib/gamePlatform/scoring');
const { GAME_REGISTRY, PLATFORM_GAME_TAGS } = require('../../../lib/gamePlatform/registry');
const mongoRouter = require('../../../lib/mongoRouter');
const {
    LEGAL_POLICY_DOC_ID,
    getLegalPolicyAdminSnapshot,
    invalidateLegalVersionCache,
} = require('../../../lib/legalPolicyVersions');

const DAY_MS = 86400000;

/**
 * @param {unknown} v
 * @param {string} field
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
function parseLegalVersionField(v, field) {
    const s = String(v ?? '').trim();
    if (!s || s.length > 64) return { ok: false, error: `invalid_${field}` };
    if (!/^[\w.-]+$/.test(s)) return { ok: false, error: `invalid_${field}` };
    return { ok: true, value: s };
}

function clampLimit(n, def = 50, max = 100) {
    const x = parseInt(String(n), 10);
    if (!Number.isFinite(x)) return def;
    return Math.min(max, Math.max(1, x));
}

function logAdmin(actorId, action, detail) {
    console.log(`[AdminPanel] actor=${actorId} action=${action} ${detail || ''}`);
}

function inMemoryActiveCountForGuild(state, guildId) {
    let n = 0;
    const maps = [
        state.activeSprints,
        state.activeCaptions,
        state.activeTunes,
        state.activeUnscrambles,
        state.activeMovieGames,
        state.activeDuels,
    ];
    for (const m of maps) {
        for (const v of m.values()) {
            if (v && v.guildId === guildId) n += 1;
        }
    }
    for (const ga of state.activeGiveaways.values()) {
        if (ga && ga.guildId === guildId) n += 1;
    }
    return n;
}

function createAdminPanelRouter() {
    const router = express.Router();
    router.use(requireAdminSession);

    router.get('/eligibility', async (req, res) => {
        try {
            const { client } = req.app.locals.playbound || {};
            const ids = scopeGuildIds(client, req.pbSession);
            const guilds = ids
                .map((id) => {
                    const g = client.guilds.cache.get(id);
                    return {
                        id,
                        name: g?.name ? String(g.name) : `Server ${id}`,
                        icon: g?.iconURL?.({ size: 64 }) || null,
                    };
                })
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
            res.json({
                eligible: true,
                isDeveloper: Boolean(req.pbSession.isDeveloper),
                guilds,
                cachedAt: new Date().toISOString(),
            });
        } catch (e) {
            console.error('[API] GET /api/admin/eligibility', e);
            res.status(500).json({ error: 'eligibility_unavailable' });
        }
    });

    router.get('/overview', async (req, res) => {
        const acc = requireGuildAccess(req, req.query.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;
        try {
            const { client, state } = req.app.locals.playbound || {};
            const since24 = new Date(Date.now() - DAY_MS);

            const [activeDb, scheduledDb, recurring, activeChallenge, ledgerAgg] = await Promise.all([
                Game.countDocuments({ guildId, status: 'active' }),
                Game.countDocuments({ guildId, status: 'scheduled' }),
                RecurringGame.countDocuments({ guildId }),
                FactionChallenge.countDocuments({ guildId, status: 'active' }),
                User.aggregate([
                    { $match: { guildId } },
                    { $unwind: { path: '$pointLedger', preserveNullAndEmptyArrays: false } },
                    {
                        $match: {
                            'pointLedger.at': { $gte: since24 },
                            'pointLedger.amount': { $gt: 0 },
                        },
                    },
                    { $group: { _id: null, issued: { $sum: '$pointLedger.amount' } } },
                ]),
            ]);

            const memScheduled = [...(state?.scheduledGames?.values() || [])].filter((s) => s.guildId === guildId).length;

            let totalServers = null;
            if (req.pbSession.isDeveloper) {
                totalServers = await SystemConfig.countDocuments();
            }

            res.json({
                guildId,
                activeGamesDb: activeDb,
                inMemorySessions: inMemoryActiveCountForGuild(state || {}, guildId),
                scheduledGamesDb: scheduledDb,
                scheduledInMemory: memScheduled,
                recurringGames: recurring,
                activeFactionChallenge: activeChallenge > 0,
                pointsIssued24h: Math.round(Number(ledgerAgg[0]?.issued || 0)),
                players24h: null,
                totalServersGlobal: totalServers,
                cachedAt: new Date().toISOString(),
            });
        } catch (e) {
            console.error('[API] GET /api/admin/overview', e);
            res.status(500).json({ error: 'overview_unavailable' });
        }
    });

    router.get('/games', async (req, res) => {
        const acc = requireGuildAccess(req, req.query.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;
        try {
            const { state } = req.app.locals.playbound || {};
            const [activeRows, schedRows, recurRows] = await Promise.all([
                Game.find({ guildId, status: 'active' }).sort({ startTime: -1 }).limit(50).lean(),
                Game.find({ guildId, status: 'scheduled' }).sort({ startTime: 1 }).limit(50).lean(),
                RecurringGame.find({ guildId }).sort({ nextRun: 1 }).limit(50).lean(),
            ]);

            const sidSet = new Set(
                [...(state?.scheduledGames?.keys() || [])].filter((sid) => {
                    const e = state.scheduledGames.get(sid);
                    return e && e.guildId === guildId;
                }),
            );

            const active = activeRows.map((g) => ({
                id: g.threadId || String(g._id),
                type: g.type,
                threadId: g.threadId,
                channelId: g.channelId,
                startTime: g.startTime,
                status: g.status,
            }));

            const scheduled = schedRows.map((g) => {
                const sid = g.state?.sid;
                const inMem = sid && sidSet.has(sid);
                return {
                    sid: sid || null,
                    type: g.type,
                    channelId: g.channelId,
                    startTime: g.startTime,
                    inMemory: inMem,
                    statePreview: JSON.stringify(g.state || {}).slice(0, 200),
                };
            });

            const recurring = recurRows.map((g) => ({
                id: String(g._id),
                type: g.type,
                intervalHours: g.intervalHours,
                nextRun: g.nextRun,
                channelId: g.channelId,
            }));

            res.json({ guildId, active, scheduled, recurring, cachedAt: new Date().toISOString() });
        } catch (e) {
            console.error('[API] GET /api/admin/games', e);
            res.status(500).json({ error: 'games_unavailable' });
        }
    });

    router.get('/economy', async (req, res) => {
        const acc = requireGuildAccess(req, req.query.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;
        try {
            const { client } = req.app.locals.playbound || {};
            const cfg = await getSystemConfig(guildId);
            const { sort } = resolveLeaderboardSort(cfg);
            const top = await User.find({ guildId, userId: { $ne: 'SYSTEM' } })
                .sort(sort)
                .limit(15)
                .select({ userId: 1, points: 1, weeklyPoints: 1, monthlyPoints: 1 })
                .lean();

            const since24 = new Date(Date.now() - DAY_MS);
            const since7 = new Date(Date.now() - 7 * DAY_MS);
            const [agg24, agg7, manual] = await Promise.all([
                User.aggregate([
                    { $match: { guildId } },
                    { $unwind: '$pointLedger' },
                    { $match: { 'pointLedger.at': { $gte: since24 } } },
                    {
                        $group: {
                            _id: null,
                            net: { $sum: '$pointLedger.amount' },
                            positive: { $sum: { $cond: [{ $gt: ['$pointLedger.amount', 0] }, '$pointLedger.amount', 0] } },
                        },
                    },
                ]),
                User.aggregate([
                    { $match: { guildId } },
                    { $unwind: '$pointLedger' },
                    { $match: { 'pointLedger.at': { $gte: since7 } } },
                    {
                        $group: {
                            _id: null,
                            net: { $sum: '$pointLedger.amount' },
                            positive: { $sum: { $cond: [{ $gt: ['$pointLedger.amount', 0] }, '$pointLedger.amount', 0] } },
                        },
                    },
                ]),
                User.aggregate([
                    { $match: { guildId } },
                    { $unwind: '$pointLedger' },
                    { $match: { 'pointLedger.label': { $regex: '^admin_adjust:' } } },
                    { $sort: { 'pointLedger.at': -1 } },
                    { $limit: 20 },
                    {
                        $project: {
                            at: '$pointLedger.at',
                            amount: '$pointLedger.amount',
                            label: '$pointLedger.label',
                            reason: '$pointLedger.reason',
                            targetUserId: '$userId',
                        },
                    },
                ]),
            ]);

            const manualRows = [];
            for (const r of manual) {
                const actorId = actorFromLabel(r.label);
                const [targetUsername, actorUsername] = await Promise.all([
                    displayNameForUser(client, r.targetUserId),
                    displayNameForUser(client, actorId),
                ]);
                manualRows.push({
                    at: r.at,
                    targetUserId: r.targetUserId,
                    targetUsername,
                    amount: r.amount,
                    actorUserId: actorId,
                    actorUsername,
                    reason: r.reason || null,
                });
            }

            const topNamed = await Promise.all(
                top.map(async (u) => ({
                    userId: u.userId,
                    points: u.points || 0,
                    weeklyPoints: u.weeklyPoints || 0,
                    monthlyPoints: u.monthlyPoints || 0,
                    displayName: await displayNameForUser(client, u.userId),
                })),
            );

            res.json({
                guildId,
                topPlayers: topNamed,
                ledger24h: {
                    net: Math.round(Number(agg24[0]?.net || 0)),
                    positiveOnly: Math.round(Number(agg24[0]?.positive || 0)),
                },
                ledger7d: {
                    net: Math.round(Number(agg7[0]?.net || 0)),
                    positiveOnly: Math.round(Number(agg7[0]?.positive || 0)),
                },
                recentManualAdjustments: manualRows,
                cachedAt: new Date().toISOString(),
            });
        } catch (e) {
            console.error('[API] GET /api/admin/economy', e);
            res.status(500).json({ error: 'economy_unavailable' });
        }
    });

    router.get('/factions', async (req, res) => {
        const acc = requireGuildAccess(req, req.query.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;
        try {
            const globalStandings = await getGlobalFactionStandingsFromUsers();
            const dist = await User.aggregate([
                { $match: { guildId, userId: { $ne: 'SYSTEM' }, faction: { $nin: [null, ''] } } },
                { $group: { _id: '$faction', n: { $sum: 1 } } },
            ]);
            await expireStaleChallenges(guildId, req.app.locals.playbound?.client);
            const [duelsUsedToday, royalesUsedToday] = await Promise.all([
                countFactionChallengesOfTypeToday(guildId, 'duel'),
                countFactionChallengesOfTypeToday(guildId, 'royale'),
            ]);

            const recentEnded = await FactionChallenge.find({ guildId, status: 'ended' })
                .sort({ endedAt: -1 })
                .limit(12)
                .select(
                    'factionA factionB battleFactions challengeType endedAt winnerFaction finalRawTotalsByFaction officialScoreByFaction matchPointsAwarded rankedResultSummary globalTotalsApplied challengeMode gameType gameTypes',
                )
                .lean();
            const recentCompletedChallenges = recentEnded.map((c) => ({
                id: String(c._id),
                endedAt: c.endedAt,
                winnerFaction: c.winnerFaction,
                challengeType: c.challengeType || (isRoyale(c) ? 'royale' : 'duel'),
                royale: isRoyale(c),
                challengeMode: c.challengeMode || 'ranked',
                ranked: isChallengeRanked(c),
                matchup: isRoyale(c)
                    ? (c.battleFactions || []).join(' vs ')
                    : `${c.factionA} vs ${c.factionB}`,
                snapshot: c.finalRawTotalsByFaction && typeof c.finalRawTotalsByFaction === 'object' ? c.finalRawTotalsByFaction : null,
                officialScores: c.officialScoreByFaction && typeof c.officialScoreByFaction === 'object' ? c.officialScoreByFaction : null,
                matchPointsAwarded: c.matchPointsAwarded && typeof c.matchPointsAwarded === 'object' ? c.matchPointsAwarded : null,
                recapLine: c.rankedResultSummary || null,
                globalMergeDone: c.globalTotalsApplied === true,
            }));

            const challenges = await FactionChallenge.find({ guildId, status: 'active' }).limit(5).lean();
            const enriched = [];
            for (const ch of challenges) {
                const { valueA, valueB, teams } = computeScores(ch);
                enriched.push({
                    id: String(ch._id),
                    factionA: ch.factionA,
                    factionB: ch.factionB,
                    battleFactions: ch.battleFactions,
                    gameType: ch.gameType,
                    endAt: ch.endAt,
                    royale: isRoyale(ch),
                    challengeMode: ch.challengeMode || 'ranked',
                    ranked: isChallengeRanked(ch),
                    scoreA: valueA,
                    scoreB: valueB,
                    teams: teams || null,
                });
            }

            res.json({
                guildId,
                dailyLimits: { duelsUsed: duelsUsedToday, duelsMax: 2, royalesUsed: royalesUsedToday, royalesMax: 1 },
                globalStandings,
                memberDistribution: dist.map((d) => ({ faction: d._id, members: d.n })),
                recentCompletedChallenges,
                activeChallenges: enriched,
                cachedAt: new Date().toISOString(),
            });
        } catch (e) {
            console.error('[API] GET /api/admin/factions', e);
            res.status(500).json({ error: 'factions_unavailable' });
        }
    });

    router.get('/referrals', async (req, res) => {
        const acc = requireGuildAccess(req, req.query.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;
        try {
            const cfg = await SystemConfig.findOne({ guildId }).select({
                referralReferredByUserId: 1,
                referralClaimedAt: 1,
                referralFirstGameRewardGranted: 1,
            }).lean();

            const payouts = await ReferralFirstGamePayout.find({ guildId }).sort({ createdAt: -1 }).limit(30).lean();
            const topReferrers = await ReferralProfile.find({})
                .sort({ referralSuccessfulCount: -1 })
                .limit(10)
                .select({ userId: 1, referralCode: 1, referralSuccessfulCount: 1 })
                .lean();

            const { client } = req.app.locals.playbound || {};
            const topNamed = await Promise.all(
                topReferrers.map(async (r) => ({
                    userId: r.userId,
                    referralCode: r.referralCode,
                    successfulCount: r.referralSuccessfulCount || 0,
                    displayName: await displayNameForUser(client, r.userId),
                })),
            );

            res.json({
                guildId,
                thisGuild: {
                    referredByUserId: cfg?.referralReferredByUserId || null,
                    claimedAt: cfg?.referralClaimedAt || null,
                    firstGameRewardGranted: cfg?.referralFirstGameRewardGranted === true,
                },
                firstGamePayouts: payouts.map((p) => ({
                    referrerUserId: p.referrerUserId,
                    createdAt: p.createdAt,
                })),
                topReferrers: topNamed,
                cachedAt: new Date().toISOString(),
            });
        } catch (e) {
            console.error('[API] GET /api/admin/referrals', e);
            res.status(500).json({ error: 'referrals_unavailable' });
        }
    });

    router.get('/automation', async (req, res) => {
        const acc = requireGuildAccess(req, req.query.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;
        try {
            const cfg = await getSystemConfig(guildId);
            const announcements = await Game.find({ guildId, status: 'scheduled', type: 'Scheduled_Announcement' })
                .limit(20)
                .lean();

            res.json({
                guildId,
                announceChannel: cfg.announceChannel || null,
                announcePingEveryone: cfg.announcePingEveryone,
                automatedServerPostsEnabled: automatedServerPostsEnabled(cfg),
                scheduledAnnouncementsInDb: announcements.map((g) => ({
                    sid: g.state?.sid,
                    startTime: g.startTime,
                    preview: (g.state?.message || '').toString().slice(0, 120),
                })),
                recurringCount: await RecurringGame.countDocuments({ guildId }),
                cachedAt: new Date().toISOString(),
            });
        } catch (e) {
            console.error('[API] GET /api/admin/automation', e);
            res.status(500).json({ error: 'automation_unavailable' });
        }
    });

    router.get('/roles', async (req, res) => {
        const acc = requireGuildAccess(req, req.query.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;
        try {
            const cfg = await getSystemConfig(guildId);
            const rewards = [];
            const map = cfg.roleRewards;
            if (map) {
                const entries = typeof map.entries === 'function' ? [...map.entries()] : Object.entries(map);
                for (const [key, roleId] of entries) {
                    const meta = resolveAchievementMeta(key, cfg);
                    rewards.push({
                        achievementKey: key,
                        roleId,
                        achievementName: meta?.name || key,
                    });
                }
            }
            res.json({
                guildId,
                managerRoleId: cfg.managerRoleId || null,
                factionLeaderRoleId: cfg.factionLeaderRoleId || null,
                autoRoleId: cfg.autoRoleId || null,
                allowMemberHostedGames: cfg.allowMemberHostedGames === true,
                roleRewards: rewards,
                builtInAchievementKeys: Object.keys(ACHIEVEMENTS).slice(0, 80),
                cachedAt: new Date().toISOString(),
            });
        } catch (e) {
            console.error('[API] GET /api/admin/roles', e);
            res.status(500).json({ error: 'roles_unavailable' });
        }
    });

    router.get('/audit', async (req, res) => {
        const acc = requireGuildAccess(req, req.query.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;
        try {
            const { client } = req.app.locals.playbound || {};
            const limit = clampLimit(req.query.limit, 50, 100);
            const targetUserId = req.query.targetUserId ? String(req.query.targetUserId) : null;
            const actorUserId = req.query.actorUserId ? String(req.query.actorUserId) : null;
            const from = req.query.from ? new Date(String(req.query.from)) : null;
            const to = req.query.to ? new Date(String(req.query.to)) : null;
            const windowDays = req.query.window === '30d' ? 30 : req.query.window === '24h' ? 1 : 7;
            const since = new Date(Date.now() - windowDays * DAY_MS);

            const preMatch = { guildId };
            if (targetUserId) preMatch.userId = targetUserId;

            const pipeline = [
                { $match: preMatch },
                { $unwind: '$pointLedger' },
                { $match: { 'pointLedger.label': { $regex: '^admin_adjust:' } } },
            ];
            if (from && !Number.isNaN(from.getTime())) {
                pipeline.push({ $match: { 'pointLedger.at': { $gte: from } } });
            }
            if (to && !Number.isNaN(to.getTime())) {
                pipeline.push({ $match: { 'pointLedger.at': { $lte: to } } });
            }
            if (actorUserId) {
                pipeline.push({ $match: { 'pointLedger.label': `admin_adjust:${actorUserId}` } });
            }

            const facetPipeline = [
                ...pipeline,
                {
                    $facet: {
                        rows: [{ $sort: { 'pointLedger.at': -1 } }, { $limit: limit }],
                        summary: [
                            {
                                $group: {
                                    _id: null,
                                    count: { $sum: 1 },
                                    net: { $sum: '$pointLedger.amount' },
                                },
                            },
                        ],
                    },
                },
            ];

            let facetResult;
            try {
                [facetResult] = await User.aggregate(facetPipeline);
            } catch (aggErr) {
                console.error('[API] audit aggregate', aggErr);
                return res.status(500).json({ error: 'audit_aggregate_failed' });
            }
            const rows = facetResult?.rows || [];
            const summaryAgg = facetResult?.summary?.[0] || { count: 0, net: 0 };

            const windowPipeline = [
                { $match: { guildId } },
                { $unwind: '$pointLedger' },
                { $match: { 'pointLedger.label': { $regex: '^admin_adjust:' }, 'pointLedger.at': { $gte: since } } },
                {
                    $facet: {
                        sum7: [{ $group: { _id: null, c: { $sum: 1 }, n: { $sum: '$pointLedger.amount' } } }],
                        byActor: [
                            {
                                $addFields: {
                                    actorId: {
                                        $arrayElemAt: [{ $split: ['$pointLedger.label', ':'] }, 1],
                                    },
                                },
                            },
                            { $match: { actorId: { $nin: [null, ''] } } },
                            {
                                $group: {
                                    _id: '$actorId',
                                    count: { $sum: 1 },
                                    net: { $sum: '$pointLedger.amount' },
                                },
                            },
                            { $sort: { count: -1 } },
                            { $limit: 10 },
                        ],
                        byTarget: [
                            {
                                $group: {
                                    _id: '$userId',
                                    count: { $sum: 1 },
                                    net: { $sum: '$pointLedger.amount' },
                                },
                            },
                            { $sort: { count: -1 } },
                            { $limit: 10 },
                        ],
                    },
                },
            ];
            const [win] = await User.aggregate(windowPipeline);
            const topActors = win?.byActor || [];
            const topTargets = win?.byTarget || [];

            const entries = [];
            for (const r of rows) {
                const pl = r.pointLedger;
                if (!pl) continue;
                const actorId = actorFromLabel(pl.label);
                const [targetUsername, actorUsername] = await Promise.all([
                    displayNameForUser(client, r.userId),
                    displayNameForUser(client, actorId),
                ]);
                entries.push({
                    at: pl.at,
                    targetUserId: r.userId,
                    targetUsername,
                    amount: pl.amount,
                    actorUserId: actorId,
                    actorUsername,
                    reason: pl.reason || null,
                });
            }

            res.json({
                guildId,
                window: `${windowDays}d`,
                summary: {
                    count: Math.round(Number(summaryAgg.count || 0)),
                    net: Math.round(Number(summaryAgg.net || 0)),
                },
                entries,
                topActors: topActors.map((a) => ({ actorUserId: a._id, count: a.count, net: a.net })),
                topTargets: topTargets.map((t) => ({ targetUserId: t._id, count: t.count, net: t.net })),
                cachedAt: new Date().toISOString(),
            });
        } catch (e) {
            console.error('[API] GET /api/admin/audit', e);
            res.status(500).json({ error: 'audit_unavailable' });
        }
    });

    router.post('/games/end', async (req, res) => {
        const acc = requireGuildAccess(req, req.body?.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;
        const kind = req.body?.kind;
        const id = req.body?.id != null ? String(req.body.id) : '';
        if (!['active', 'scheduled', 'recurring'].includes(kind) || !id) {
            return res.status(400).json({ error: 'invalid_body' });
        }
        const { client, state, triggers } = req.app.locals.playbound || {};
        if (!client || !state || !triggers) {
            return res.status(503).json({ error: 'bot_context_unavailable' });
        }
        const result = await adminTerminateGame({ client, state, triggers, guildId }, kind, id);
        if (!result.ok) {
            const code = result.code === 'not_found' ? 404 : result.code === 'forbidden' ? 403 : 400;
            return res.status(code).json({ error: result.code, message: result.message });
        }
        logAdmin(req.pbSession.discordUserId, 'games/end', `guild=${guildId} kind=${kind} id=${id}`);
        res.json({ ok: true });
    });

    router.post('/economy/adjust', async (req, res) => {
        const acc = requireGuildAccess(req, req.body?.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;
        const client = req.app.locals.playbound?.client;
        const targetUserId = req.body?.targetUserId != null ? String(req.body.targetUserId) : '';
        const amount = parseInt(String(req.body?.amount), 10);
        const reason = (req.body?.reason != null ? String(req.body.reason) : '').trim();
        const actorId = req.pbSession.discordUserId;

        if (!targetUserId || targetUserId === 'SYSTEM') {
            return res.status(400).json({ error: 'invalid_target' });
        }
        if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 5000) {
            return res.status(400).json({ error: 'invalid_amount' });
        }
        if (reason.length < 5 || reason.length > 180) {
            return res.status(400).json({ error: 'invalid_reason' });
        }

        const targetUser = await getUser(guildId, targetUserId);
        if (amount < 0 && (targetUser.points || 0) <= 0) {
            return res.status(400).json({ error: 'already_zero' });
        }

        const enrolled =
            targetUser.faction &&
            (await isUserEnrolledInActiveFactionChallenge(guildId, targetUserId, targetUser.faction));
        if (amount > 0 && enrolled && !isBotDeveloper(actorId)) {
            return res.status(403).json({ error: 'faction_war_positive_blocked' });
        }

        const label = `admin_adjust:${actorId}`;
        const { applied, newTotal } = await addManualPointAdjustment(client, guildId, targetUserId, amount, label, reason);
        if (applied === 0) {
            return res.status(400).json({ error: 'no_change' });
        }
        logAdmin(actorId, 'economy/adjust', `guild=${guildId} target=${targetUserId} applied=${applied}`);
        res.json({ ok: true, applied, newTotal });
    });

    router.post('/economy/wipe', async (req, res) => {
        const acc = requireGuildAccess(req, req.body?.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;
        const client = req.app.locals.playbound?.client;
        const confirmation = req.body?.confirmation != null ? String(req.body.confirmation) : '';
        const g = client?.guilds?.cache?.get(guildId);
        const expected = g?.name || '';
        if (!expected || confirmation !== expected) {
            return res.status(400).json({ error: 'confirmation_mismatch', message: 'Type the exact Discord server name.' });
        }
        await User.updateMany({
            guildId,
        }, {
            $set: {
                points: 0,
                weeklyPoints: 0,
                monthlyPoints: 0,
                competitivePoints: 0,
                warPlaygamePersonalPoints: 0,
                warPlaygamePersonalDay: null,
            },
        });
        await refreshLeaderboard(client, guildId);
        logAdmin(req.pbSession.discordUserId, 'economy/wipe', `guild=${guildId}`);
        res.json({ ok: true });
    });

    router.post('/factions/challenge', async (req, res) => {
        const acc = requireGuildAccess(req, req.body?.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;
        const action = req.body?.action;
        const client = req.app.locals.playbound?.client;
        const actorId = req.pbSession.discordUserId;

        if (action === 'end') {
            const actor = await getUser(guildId, actorId);
            if (!actor.isPremium && !isBotDeveloper(actorId)) {
                return res.status(403).json({ error: 'premium_required', message: 'Ending faction challenges requires Premium (same as /faction_challenge end).' });
            }
            const cfgFcEnd = await getSystemConfig(guildId);
            let memberFcEnd = null;
            const guildFc = client?.guilds?.cache?.get(guildId);
            if (guildFc) {
                try {
                    memberFcEnd = await guildFc.members.fetch(actorId);
                } catch {
                    /* not in guild or fetch failed */
                }
            }
            if (!canManageFactionChallenges(memberFcEnd, actorId, cfgFcEnd)) {
                return res.status(403).json({
                    error: 'forbidden',
                    message:
                        'Ending a faction challenge requires Administrator, Bot Manager, or the configured Faction Leader role in Discord (same as /faction_challenge end).',
                });
            }
            await expireStaleChallenges(guildId, client);
            const ch = await getActiveChallenge(guildId);
            if (!ch) {
                return res.status(404).json({ error: 'no_active_challenge' });
            }
            ch.status = 'ended';
            ch.endedAt = new Date();
            ch.winnerFaction = pickChallengeWinner(ch);
            await ch.save();
            await applyEndedChallengeToGlobalTotals(client, guildId, ch._id);
            await grantFactionVictoryRoleIfConfigured(client, guildId, ch.winnerFaction, ch);
            await grantWarEndPersonalCredits(client, guildId, ch._id);
            logAdmin(actorId, 'factions/challenge/end', `guild=${guildId}`);
            return res.json({ ok: true, winnerFaction: ch.winnerFaction });
        }

        if (action === 'create') {
            return res.status(501).json({
                error: 'not_implemented',
                message: 'Create a faction challenge from Discord with /faction_challenge create (API create not wired yet).',
            });
        }

        return res.status(400).json({ error: 'invalid_action' });
    });

    router.post('/automation/update', async (req, res) => {
        const acc = requireGuildAccess(req, req.body?.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;
        const patch = req.body?.patch && typeof req.body.patch === 'object' ? req.body.patch : {};

        if (patch.announceChannelId != null) {
            const id = String(patch.announceChannelId).trim();
            await updateSystemConfig(guildId, (c) => {
                c.announceChannel = id || null;
            });
        }
        if (typeof patch.announcePingEveryone === 'boolean') {
            await updateSystemConfig(guildId, (c) => {
                c.announcePingEveryone = patch.announcePingEveryone;
            });
        }
        if (typeof patch.automatedServerPostsEnabled === 'boolean') {
            await updateSystemConfig(guildId, (c) => {
                c.automatedServerPostsEnabled = patch.automatedServerPostsEnabled;
            });
        }
        if (typeof patch.allowMemberHostedGames === 'boolean') {
            await updateSystemConfig(guildId, (c) => {
                c.allowMemberHostedGames = patch.allowMemberHostedGames;
            });
        }

        logAdmin(req.pbSession.discordUserId, 'automation/update', `guild=${guildId}`);
        const cfg = await getSystemConfig(guildId);
        res.json({
            ok: true,
            announceChannel: cfg.announceChannel || null,
            announcePingEveryone: cfg.announcePingEveryone,
            automatedServerPostsEnabled: automatedServerPostsEnabled(cfg),
        });
    });

    router.post('/automation/schedule', async (req, res) => {
        const acc = requireGuildAccess(req, req.body?.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;
        const actorId = req.pbSession.discordUserId;
        const actor = await getUser(guildId, actorId);
        if (!actor.isPremium) {
            return res.status(403).json({ error: 'premium_required' });
        }
        const cfg = await getSystemConfig(guildId);
        if (!automatedServerPostsEnabled(cfg)) {
            return res.status(403).json({ error: 'automated_posts_off' });
        }
        const message = req.body?.message != null ? String(req.body.message) : '';
        const channelId = req.body?.channelId != null ? String(req.body.channelId) : '';
        const delayHrs = parseInt(String(req.body?.delayHrs || 0), 10) || 0;
        const delayDays = parseInt(String(req.body?.delayDays || 0), 10) || 0;
        const delay = delayHrs * 3600000 + delayDays * 86400000;
        if (!message.trim() || !channelId) {
            return res.status(400).json({ error: 'invalid_body' });
        }

        const { client, scheduleGame } = req.app.locals.playbound || {};
        if (!scheduleGame) {
            return res.status(503).json({ error: 'schedule_unavailable' });
        }

        if (delay <= 0) {
            const chan = await client.channels.fetch(channelId).catch(() => null);
            if (!chan || typeof chan.isTextBased !== 'function' || !chan.isTextBased()) {
                return res.status(400).json({ error: 'invalid_channel' });
            }
            await chan.send(message);
            logAdmin(actorId, 'automation/schedule_immediate', `guild=${guildId}`);
            return res.json({ ok: true, immediate: true });
        }

        const maintenanceDeny = getGameSchedulingDenialMessage(Date.now() + delay);
        if (maintenanceDeny) {
            return res.status(403).json({ error: 'maintenance_window', message: maintenanceDeny });
        }

        const startFn = async () => {
            const c = await getSystemConfig(guildId);
            if (!automatedServerPostsEnabled(c)) return;
            const chan = await client.channels.fetch(channelId).catch(() => null);
            if (chan && typeof chan.isTextBased === 'function' && chan.isTextBased()) await chan.send(message);
        };
        const sid = await scheduleGame(guildId, 'Announcement', channelId, delay, startFn, { message });
        logAdmin(actorId, 'automation/schedule', `guild=${guildId} sid=${sid}`);
        res.json({ ok: true, sid });
    });

    router.post('/roles/update', async (req, res) => {
        const acc = requireGuildAccess(req, req.body?.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;
        const client = req.app.locals.playbound?.client;
        const action = req.body?.action;
        const actorId = req.pbSession.discordUserId;

        const guild = client?.guilds?.cache?.get(guildId);
        if (!guild) {
            return res.status(404).json({ error: 'guild_not_found' });
        }

        try {
            if (action === 'set_manager_role') {
                const roleId = String(req.body.roleId || '').trim();
                if (!roleId) return res.status(400).json({ error: 'role_required' });
                await updateSystemConfig(guildId, (c) => {
                    c.managerRoleId = roleId;
                });
                logAdmin(actorId, 'roles/set_manager', guildId);
                return res.json({ ok: true });
            }
            if (action === 'clear_manager_role') {
                await updateSystemConfig(guildId, (c) => {
                    c.managerRoleId = null;
                });
                logAdmin(actorId, 'roles/clear_manager', guildId);
                return res.json({ ok: true });
            }
            if (action === 'set_auto_role') {
                const roleId = String(req.body.roleId || '').trim();
                if (!roleId) return res.status(400).json({ error: 'role_required' });
                await updateSystemConfig(guildId, (c) => {
                    c.autoRoleId = roleId;
                });
                logAdmin(actorId, 'roles/set_auto', guildId);
                return res.json({ ok: true });
            }
            if (action === 'remove_auto_role') {
                await updateSystemConfig(guildId, (c) => {
                    c.autoRoleId = null;
                });
                logAdmin(actorId, 'roles/remove_auto', guildId);
                return res.json({ ok: true });
            }
            if (action === 'set_role_reward') {
                const achKey = String(req.body.achievementKey || '').trim();
                const roleId = String(req.body.roleId || '').trim();
                const cfg = await getSystemConfig(guildId);
                if (!resolveAchievementMeta(achKey, cfg)) {
                    return res.status(400).json({ error: 'unknown_achievement' });
                }
                await updateSystemConfig(guildId, (c) => {
                    if (!c.roleRewards) c.roleRewards = new Map();
                    c.roleRewards.set(achKey, roleId);
                });
                logAdmin(actorId, 'roles/set_role_reward', `${guildId} ${achKey}`);
                return res.json({ ok: true });
            }
            if (action === 'sync_auto_role' || action === 'strip_role') {
                const userActor = await getUser(guildId, actorId);
                if (!userActor.isPremium) {
                    return res.status(403).json({ error: 'premium_required' });
                }
                const cfg = await getSystemConfig(guildId);
                if (action === 'sync_auto_role') {
                    if (!cfg.autoRoleId) {
                        return res.status(400).json({ error: 'no_auto_role' });
                    }
                    const role = guild.roles.cache.get(cfg.autoRoleId);
                    if (!role) {
                        return res.status(400).json({ error: 'role_missing' });
                    }
                    let added = 0;
                    const members = await guild.members.fetch();
                    for (const [, member] of members) {
                        if (member.user.bot) continue;
                        if (!member.roles.cache.has(cfg.autoRoleId)) {
                            try {
                                await member.roles.add(cfg.autoRoleId);
                                added++;
                            } catch (_) {
                                /* hierarchy */
                            }
                        }
                    }
                    logAdmin(actorId, 'roles/sync_auto', `${guildId} added=${added}`);
                    return res.json({ ok: true, added });
                }
                const stripRoleId = String(req.body.roleId || '').trim();
                if (!stripRoleId) return res.status(400).json({ error: 'role_required' });
                const stripRole = guild.roles.cache.get(stripRoleId);
                if (!stripRole) return res.status(400).json({ error: 'role_missing' });
                let removed = 0;
                const members = await guild.members.fetch();
                for (const [, member] of members) {
                    if (member.user.bot) continue;
                    if (member.roles.cache.has(stripRoleId)) {
                        try {
                            await member.roles.remove(stripRoleId);
                            removed++;
                        } catch (_) {
                            /* skip */
                        }
                    }
                }
                logAdmin(actorId, 'roles/strip', `${guildId} removed=${removed}`);
                return res.json({ ok: true, removed });
            }
            return res.status(400).json({ error: 'invalid_action' });
        } catch (e) {
            console.error('[API] POST /api/admin/roles/update', e);
            res.status(500).json({ error: 'role_action_failed', message: e.message || String(e) });
        }
    });

    /** Bot developer only: global seasonal competition (quarters / years). */
    router.get('/seasons/state', async (req, res) => {
        if (!req.pbSession.isDeveloper) {
            return res.status(403).json({ error: 'developer_only' });
        }
        try {
            const now = new Date();
            const overdue = await Season.find({
                type: 'quarter',
                status: 'active',
                endAt: { $lt: now },
            })
                .select('seasonKey year quarter endAt')
                .sort({ endAt: 1 })
                .lean();
            const active = await Season.find({ type: 'quarter', status: 'active', endAt: { $gte: now } })
                .select('seasonKey year quarter startAt endAt')
                .lean();
            const overview = await factionSeasons.getCurrentSeasonOverview();
            const recentAudit = await SeasonAuditLog.find({})
                .sort({ createdAt: -1 })
                .limit(25)
                .select('action detail createdAt')
                .lean();
            res.json({
                overdueQuarterSeasons: overdue,
                activeQuarterSeasons: active,
                currentOverview: overview,
                auditTail: recentAudit,
                flags: {
                    seasonAutomationEnabled: factionSeasons.seasonAutomationEnabled(),
                    seasonRewardsEnabled: factionSeasons.seasonRewardsEnabled(),
                    yearlySeasonRewardsEnabled: factionSeasons.yearlySeasonRewardsEnabled(),
                },
                cachedAt: new Date().toISOString(),
            });
        } catch (e) {
            console.error('[API] GET /api/admin/seasons/state', e);
            res.status(500).json({ error: 'seasons_unavailable' });
        }
    });

    router.get('/seasons/preview', async (req, res) => {
        if (!req.pbSession.isDeveloper) {
            return res.status(403).json({ error: 'developer_only' });
        }
        const sk = req.query.seasonKey != null ? String(req.query.seasonKey).trim() : '';
        if (!sk) return res.status(400).json({ error: 'seasonKey_required' });
        try {
            const standings = await factionSeasons.getSeasonStandingsForKey(sk);
            const doc = await Season.findOne({ seasonKey: sk }).lean();
            res.json({ seasonKey: sk, season: doc, standings, cachedAt: new Date().toISOString() });
        } catch (e) {
            console.error('[API] GET /api/admin/seasons/preview', e);
            res.status(500).json({ error: 'seasons_unavailable' });
        }
    });

    router.post('/seasons/finalize-quarter', async (req, res) => {
        if (!req.pbSession.isDeveloper) {
            return res.status(403).json({ error: 'developer_only' });
        }
        const seasonKey = req.body?.seasonKey != null ? String(req.body.seasonKey).trim() : '';
        const confirm = req.body?.confirm === true;
        if (!seasonKey || !/^(\d{4})-Q[1-4]$/.test(seasonKey)) {
            return res.status(400).json({ error: 'invalid_season_key' });
        }
        if (!confirm) {
            return res.status(400).json({ error: 'confirm_required', message: 'Send confirm:true to finalize this quarter.' });
        }
        try {
            const client = req.app.locals.playbound?.client || null;
            const out = await factionSeasons.finalizeQuarterSeason(seasonKey, client);
            logAdmin(req.pbSession.discordUserId, 'seasons/finalize-quarter', seasonKey);
            res.json({ ok: true, result: out });
        } catch (e) {
            console.error('[API] POST /api/admin/seasons/finalize-quarter', e);
            res.status(500).json({ error: 'season_finalize_failed', message: e.message || String(e) });
        }
    });

    router.post('/seasons/run-boundary-check', async (req, res) => {
        if (!req.pbSession.isDeveloper) {
            return res.status(403).json({ error: 'developer_only' });
        }
        try {
            const client = req.app.locals.playbound?.client || null;
            await factionSeasons.processSeasonBoundaries(client);
            logAdmin(req.pbSession.discordUserId, 'seasons/run-boundary-check', 'ok');
            res.json({ ok: true });
        } catch (e) {
            console.error('[API] POST /api/admin/seasons/run-boundary-check', e);
            res.status(500).json({ error: 'season_check_failed', message: e.message || String(e) });
        }
    });

    /** Global mini-game platform (rotation, featured, balancing). */
    router.get('/game-platform/overview', async (req, res) => {
        if (!req.pbSession.isDeveloper) {
            return res.status(403).json({ error: 'developer_only' });
        }
        try {
            const rot = await ensureRotationForDate();
            const settings = await getSettings();
            const catalog = allResolvedGames(settings);
            const recentDays = await GamePlatformDay.find().sort({ dayUtc: -1 }).limit(8).lean();
            const stats = await getAnalyticsRange(14);
            res.json({
                rotation: rot,
                settings,
                catalog,
                recentDays,
                analytics: stats,
                registryTags: PLATFORM_GAME_TAGS,
                cachedAt: new Date().toISOString(),
            });
        } catch (e) {
            console.error('[API] GET /api/admin/game-platform/overview', e);
            res.status(500).json({ error: 'game_platform_unavailable' });
        }
    });

    router.post('/game-platform/settings', async (req, res) => {
        if (!req.pbSession.isDeveloper) {
            return res.status(403).json({ error: 'developer_only' });
        }
        try {
            const body = req.body || {};
            const doc = await updateSettings((d) => {
                if (body.featuredCasualBonusPct != null) {
                    d.featuredCasualBonusPct = Math.max(0, Math.min(0.5, Number(body.featuredCasualBonusPct)));
                }
                if (body.autoFeatured != null) d.autoFeatured = !!body.autoFeatured;
                if (body.manualFeaturedTag !== undefined) {
                    d.manualFeaturedTag = body.manualFeaturedTag ? String(body.manualFeaturedTag).toLowerCase() : null;
                }
                if (Array.isArray(body.manualActiveTags)) {
                    d.manualActiveTags = body.manualActiveTags.map((x) => String(x).toLowerCase()).filter(Boolean);
                }
                if (body.poolSizeMin != null) d.poolSizeMin = Math.round(Number(body.poolSizeMin));
                if (body.poolSizeMax != null) d.poolSizeMax = Math.round(Number(body.poolSizeMax));
                if (body.socialGamesRankedAllowed != null) d.socialGamesRankedAllowed = !!body.socialGamesRankedAllowed;
                if (body.gameOverrides && typeof body.gameOverrides === 'object') {
                    for (const [k, v] of Object.entries(body.gameOverrides)) {
                        const key = String(k).toLowerCase();
                        if (!PLATFORM_GAME_TAGS.includes(key)) continue;
                        d.gameOverrides.set(key, { ...(d.gameOverrides.get(key) || {}), ...v });
                    }
                }
            });
            await GamePlatformAuditLog.create({
                action: 'settings_update',
                actorId: req.pbSession.discordUserId,
                detail: { keys: Object.keys(body || {}) },
            });
            logAdmin(req.pbSession.discordUserId, 'game-platform/settings', 'ok');
            res.json({ ok: true, settings: doc });
        } catch (e) {
            console.error('[API] POST /api/admin/game-platform/settings', e);
            res.status(500).json({ error: 'game_platform_settings_failed', message: e.message || String(e) });
        }
    });

    router.post('/game-platform/rotation/recompute', async (req, res) => {
        if (!req.pbSession.isDeveloper) {
            return res.status(403).json({ error: 'developer_only' });
        }
        try {
            const day = req.body?.dayUtc ? String(req.body.dayUtc).slice(0, 10) : utcDayString();
            await GamePlatformDay.deleteOne({ dayUtc: day });
            const rot = await ensureRotationForDate(new Date(`${day}T12:00:00.000Z`));
            await GamePlatformAuditLog.create({
                action: 'rotation_recompute',
                actorId: req.pbSession.discordUserId,
                detail: { dayUtc: day },
            });
            logAdmin(req.pbSession.discordUserId, 'game-platform/rotation/recompute', day);
            res.json({ ok: true, rotation: rot });
        } catch (e) {
            console.error('[API] POST /api/admin/game-platform/rotation/recompute', e);
            res.status(500).json({ error: 'rotation_failed', message: e.message || String(e) });
        }
    });

    router.post('/game-platform/rotation/override-day', async (req, res) => {
        if (!req.pbSession.isDeveloper) {
            return res.status(403).json({ error: 'developer_only' });
        }
        const dayUtc = req.body?.dayUtc != null ? String(req.body.dayUtc).slice(0, 10) : '';
        const activeTags = Array.isArray(req.body?.activeTags) ? req.body.activeTags.map((x) => String(x).toLowerCase()) : [];
        const featuredTag = req.body?.featuredTag != null ? String(req.body.featuredTag).toLowerCase() : null;
        if (!dayUtc || activeTags.length === 0) {
            return res.status(400).json({ error: 'dayUtc_and_activeTags_required' });
        }
        try {
            await setManualDayOverride(dayUtc, activeTags, featuredTag);
            await GamePlatformAuditLog.create({
                action: 'rotation_override',
                actorId: req.pbSession.discordUserId,
                detail: { dayUtc, activeTags, featuredTag },
            });
            logAdmin(req.pbSession.discordUserId, 'game-platform/rotation/override-day', dayUtc);
            res.json({ ok: true, dayUtc, activeTags, featuredTag });
        } catch (e) {
            console.error('[API] POST /api/admin/game-platform/rotation/override-day', e);
            res.status(500).json({ error: 'override_failed', message: e.message || String(e) });
        }
    });

    router.post('/game-platform/preview-score', async (req, res) => {
        if (!req.pbSession.isDeveloper) {
            return res.status(403).json({ error: 'developer_only' });
        }
        const tag = req.body?.tag != null ? String(req.body.tag).toLowerCase() : '';
        const base = Number(req.body?.factionBasePoints);
        if (!tag || !Number.isFinite(base)) {
            return res.status(400).json({ error: 'tag_and_factionBasePoints_required' });
        }
        try {
            const settings = await getSettings();
            const rot = await ensureRotationForDate();
            const preview = previewPlatformScore(tag, base, settings, rot.featuredTag);
            res.json({ ok: true, preview, featuredTag: rot.featuredTag });
        } catch (e) {
            console.error('[API] POST /api/admin/game-platform/preview-score', e);
            res.status(500).json({ error: 'preview_failed', message: e.message || String(e) });
        }
    });

    router.get('/game-platform/registry', async (req, res) => {
        if (!req.pbSession.isDeveloper) {
            return res.status(403).json({ error: 'developer_only' });
        }
        res.json({ games: PLATFORM_GAME_TAGS.map((t) => GAME_REGISTRY[t]), cachedAt: new Date().toISOString() });
    });

    router.get('/legal-policy', async (req, res) => {
        if (!req.pbSession.isDeveloper) {
            return res.status(403).json({ error: 'developer_only' });
        }
        try {
            const snap = await mongoRouter.runWithForcedModels(mongoRouter.getModelsProd(), () =>
                getLegalPolicyAdminSnapshot(),
            );
            res.json({
                ...snap,
                staticPublishAvailable: Boolean(req.app.locals.playboundPublicDir),
                cachedAt: new Date().toISOString(),
            });
        } catch (e) {
            console.error('[API] GET /api/admin/legal-policy', e);
            res.status(500).json({ error: 'legal_policy_unavailable' });
        }
    });

    const LEGAL_HTML_MAX = 1_500_000;

    router.post('/legal-policy/html', async (req, res) => {
        if (!req.pbSession.isDeveloper) {
            return res.status(403).json({ error: 'developer_only' });
        }
        const root = req.app.locals.playboundPublicDir;
        if (!root || typeof root !== 'string') {
            return res.status(400).json({ error: 'public_dir_not_configured' });
        }
        const termsHtml = req.body?.termsHtml != null ? String(req.body.termsHtml) : '';
        const privacyHtml = req.body?.privacyHtml != null ? String(req.body.privacyHtml) : '';
        if (!termsHtml.trim() && !privacyHtml.trim()) {
            return res.status(400).json({ error: 'terms_or_privacy_html_required' });
        }
        if (termsHtml.length > LEGAL_HTML_MAX || privacyHtml.length > LEGAL_HTML_MAX) {
            return res.status(400).json({ error: 'html_too_large' });
        }
        try {
            const written = [];
            if (termsHtml.trim()) {
                await fs.writeFile(path.join(root, 'terms.html'), termsHtml, 'utf8');
                written.push('terms.html');
            }
            if (privacyHtml.trim()) {
                await fs.writeFile(path.join(root, 'privacy.html'), privacyHtml, 'utf8');
                written.push('privacy.html');
            }
            logAdmin(req.pbSession.discordUserId, 'legal-policy/html', written.join(','));
            res.json({ ok: true, written, publicDir: root });
        } catch (e) {
            console.error('[API] POST /api/admin/legal-policy/html', e);
            res.status(500).json({ error: 'legal_html_write_failed', message: e.message || String(e) });
        }
    });

    router.post('/legal-policy', async (req, res) => {
        if (!req.pbSession.isDeveloper) {
            return res.status(403).json({ error: 'developer_only' });
        }
        const t = parseLegalVersionField(req.body?.termsVersion, 'termsVersion');
        const p = parseLegalVersionField(req.body?.privacyVersion, 'privacyVersion');
        if (!t.ok) return res.status(400).json({ error: t.error });
        if (!p.ok) return res.status(400).json({ error: p.error });
        try {
            await mongoRouter.runWithForcedModels(mongoRouter.getModelsProd(), async () => {
                await LegalPolicyConfig.findByIdAndUpdate(
                    LEGAL_POLICY_DOC_ID,
                    {
                        $set: {
                            termsVersion: t.value,
                            privacyVersion: p.value,
                            updatedByDiscordUserId: req.pbSession.discordUserId,
                        },
                    },
                    { upsert: true, new: true, setDefaultsOnInsert: true },
                );
            });
            invalidateLegalVersionCache();
            logAdmin(
                req.pbSession.discordUserId,
                'legal-policy/update',
                `terms=${t.value} privacy=${p.value}`,
            );
            const snap = await mongoRouter.runWithForcedModels(mongoRouter.getModelsProd(), () =>
                getLegalPolicyAdminSnapshot(),
            );
            res.json({ ok: true, ...snap });
        } catch (e) {
            console.error('[API] POST /api/admin/legal-policy', e);
            res.status(500).json({ error: 'legal_policy_save_failed', message: e.message || String(e) });
        }
    });

    router.delete('/legal-policy', async (req, res) => {
        if (!req.pbSession.isDeveloper) {
            return res.status(403).json({ error: 'developer_only' });
        }
        try {
            await mongoRouter.runWithForcedModels(mongoRouter.getModelsProd(), async () => {
                await LegalPolicyConfig.deleteOne({ _id: LEGAL_POLICY_DOC_ID });
            });
            invalidateLegalVersionCache();
            logAdmin(req.pbSession.discordUserId, 'legal-policy/delete', 'revert_to_code_defaults');
            const snap = await mongoRouter.runWithForcedModels(mongoRouter.getModelsProd(), () =>
                getLegalPolicyAdminSnapshot(),
            );
            res.json({ ok: true, ...snap });
        } catch (e) {
            console.error('[API] DELETE /api/admin/legal-policy', e);
            res.status(500).json({ error: 'legal_policy_delete_failed', message: e.message || String(e) });
        }
    });

    return router;
}

module.exports = { createAdminPanelRouter };
