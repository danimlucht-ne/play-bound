'use strict';

const express = require('express');
const mongoRouter = require('../../../lib/mongoRouter');
const { User, Game, SystemConfig, ReferralFirstGamePayout } = require('../../../models');
const { cached } = require('./cache');
const {
    getExcludedGuildIds,
    publicStatsCacheKeySuffix,
    guildIdNotExcludedMatch,
} = require('../../../lib/publicStatsExclude');
const { getGlobalFactionStandingsFromUsers } = require('../../../lib/globalFactionAggregates');
const {
    getCurrentSeasonOverview,
    getHallOfChampions,
    getSeasonStandingsForKey,
} = require('../../../lib/factionSeasons');
const { competitiveLedgerLabelsForMatch } = require('../../../lib/competitivePoints');
const { ensureRotationForDate } = require('../../../lib/gamePlatform/rotation');
const { getSettings, allResolvedGames, resolveGame } = require('../../../lib/gamePlatform/configStore');
const { commands: slashCommandsDeployJson } = require('../../../deploy-commands');

const STATS_TTL_MS = Number(process.env.API_STATS_TTL_MS) || 120000;
const LEADERBOARD_TTL_MS = Number(process.env.API_LEADERBOARD_TTL_MS) || 120000;

const DAY_MS = 86400000;

function clampInt(n, min, max, fallback) {
    const x = parseInt(String(n), 10);
    if (!Number.isFinite(x)) return fallback;
    return Math.min(max, Math.max(min, x));
}

/** Command names to omit from public listings (e.g. top.gg) even when description is generic. */
const SLASH_COMMAND_LISTING_EXCLUDED_NAMES = new Set([
    'admin_premium',
    'premium_analytics',
    'broadcast',
    'dev_points',
    'blacklist',
    'unblacklist',
    'listgames',
    'endgame',
    'wipe_leaderboard',
    'bootstrap_support_server',
    'setup_panels',
    'wipe_panel_channels',
    'wipe_bootstrap_messages',
    'wipe_all_managed_channels',
]);

/**
 * @param {Array<Record<string, unknown>>} cmds Discord application command JSON (from `deploy-commands.js`)
 * @returns {Array<Record<string, unknown>>}
 */
function filterSlashCommandsForPublicListing(cmds) {
    return cmds.filter((c) => {
        const name = String(c.name || '');
        if (SLASH_COMMAND_LISTING_EXCLUDED_NAMES.has(name)) return false;
        const d = String(c.description || '').trim();
        if (/^(ADMIN|DEVELOPER)\s*:/i.test(d)) return false;
        return true;
    });
}

/**
 * @param {import('discord.js').Client|null} client
 * @param {Array<Record<string, unknown>>} entries
 * @param {string} idKey
 */
async function attachUserFields(client, entries, idKey) {
    const out = [];
    for (const e of entries) {
        const id = e[idKey];
        let username = null;
        let globalName = null;
        if (client && client.isReady() && id) {
            try {
                const u = await client.users.fetch(String(id));
                username = u.username;
                globalName = u.globalName;
            } catch {
                /* unknown / inaccessible user */
            }
        }
        const displayName = globalName || username || null;
        out.push({
            ...e,
            username: username || null,
            globalName: globalName || null,
            displayName: displayName || 'Unknown user',
        });
    }
    return out;
}

function withProdModels(handler) {
    return async (req, res) => {
        await mongoRouter.runWithForcedModels(mongoRouter.getModelsProd(), async () => {
            await Promise.resolve(handler(req, res));
        });
    };
}

function createPublicApiRouter() {
    const router = express.Router();

    /** Discovery + deploy checks (avoids mistaking a stale API host for “broken” clients). */
    router.get('/', (req, res) => {
        res.json({
            ok: true,
            service: 'playbound-api',
            get: [
                '/api/public-config',
                '/api/stats/global',
                '/api/leaderboard/players',
                '/api/leaderboard/factions',
                '/api/leaderboard/recruiters',
                '/api/seasons/current',
                '/api/seasons/hall',
                '/api/seasons/:seasonKey/standings',
                '/api/games/today',
                '/api/commands',
            ],
        });
    });

    /**
     * Slash commands as JSON (same shape Discord uses for application commands).
     * Query: `filter=topgg` (or `public`) — drop obvious staff/dev-only commands for bot listing sites.
     */
    router.get('/commands', (req, res) => {
        const filter = String(req.query.filter || '').toLowerCase();
        const useListingFilter = filter === 'topgg' || filter === 'public';
        const commands = useListingFilter
            ? filterSlashCommandsForPublicListing(slashCommandsDeployJson)
            : slashCommandsDeployJson;
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.json({
            ok: true,
            service: 'playbound-api',
            filter: useListingFilter ? 'topgg' : 'all',
            generatedAt: new Date().toISOString(),
            count: commands.length,
            /** Discord API v10 application command objects */
            commands,
        });
    });

    router.get('/public-config', (req, res) => {
        const clientId = process.env.CLIENT_ID || '';
        const invite =
            process.env.BOT_INVITE_URL ||
            (clientId
                ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&permissions=8&integration_type=0&scope=bot%20applications.commands`
                : null);
        res.json({
            botInviteUrl: invite,
            supportServerInvite: process.env.SUPPORT_SERVER_INVITE || null,
            premiumMonthlyUrl: process.env.STRIPE_PAYMENT_LINK_MONTHLY || null,
            premiumYearlyUrl: process.env.STRIPE_PAYMENT_LINK_YEARLY || null,
            clientId: clientId || null,
        });
    });

    router.get('/stats/global', withProdModels(async (req, res) => {
        try {
            const ck = `stats:global${publicStatsCacheKeySuffix()}`;
            const data = await cached(ck, STATS_TTL_MS, async () => {
                const since = new Date(Date.now() - DAY_MS);
                const weekSince = new Date(Date.now() - 7 * DAY_MS);
                const gEx = guildIdNotExcludedMatch();

                const competitiveLabels = competitiveLedgerLabelsForMatch();
                const [totalServers, gamesLast24h, gamesPlayedAllTime, pointsAgg, referralMilestonesLast7d] =
                    await Promise.all([
                        SystemConfig.countDocuments(gEx),
                        Game.countDocuments({ startTime: { $gte: since }, ...gEx }),
                        Game.countDocuments({ status: 'ended', ...gEx }),
                        User.aggregate([
                            { $match: { ...gEx } },
                            { $unwind: { path: '$pointLedger', preserveNullAndEmptyArrays: false } },
                            {
                                $match: {
                                    'pointLedger.at': { $gte: since },
                                    'pointLedger.amount': { $gt: 0 },
                                    'pointLedger.label': { $in: competitiveLabels },
                                },
                            },
                            { $group: { _id: null, total: { $sum: '$pointLedger.amount' } } },
                        ]),
                        ReferralFirstGamePayout.countDocuments({
                            createdAt: { $gte: weekSince },
                            ...gEx,
                        }),
                    ]);
                const pointsLast24h = Math.round(Number(pointsAgg[0]?.total || 0));
                return {
                    totalServers,
                    gamesLast24h,
                    playersLast24h: null,
                    pointsLast24h,
                    gamesPlayedAllTime,
                    referralMilestonesLast7d,
                    cachedAt: new Date().toISOString(),
                };
            });
            res.json(data);
        } catch (e) {
            console.error('[API] GET /api/stats/global', e);
            res.status(500).json({ error: 'stats_unavailable' });
        }
    }));

    router.get('/leaderboard/players', withProdModels(async (req, res) => {
        try {
            const limit = clampInt(req.query.limit, 1, 25, 10);
            const rawBoard = String(req.query.board || 'arena').toLowerCase().replace(/-/g, '_');
            /** @type {{ field: string, board: string, label: string }} */
            let spec = { field: 'competitivePoints', board: 'arena', label: 'Arena score (all-time)' };
            if (rawBoard === 'weekly_credits') {
                spec = { field: 'weeklyPoints', board: 'weekly_credits', label: 'Credits (weekly cadence)' };
            } else if (rawBoard === 'monthly_credits') {
                spec = { field: 'monthlyPoints', board: 'monthly_credits', label: 'Credits (monthly cadence)' };
            } else if (rawBoard !== 'arena') {
                return res.status(400).json({ error: 'invalid_board', allowed: ['arena', 'weekly_credits', 'monthly_credits'] });
            }

            const cacheKey = `leaderboard:players:${limit}:${spec.board}${publicStatsCacheKeySuffix()}`;
            const { client } = req.app.locals.playbound || {};
            const gEx = guildIdNotExcludedMatch();

            const data = await cached(cacheKey, LEADERBOARD_TTL_MS, async () => {
                const match = { userId: { $ne: 'SYSTEM' }, ...gEx };
                const sumField = spec.field;
                const rows = await User.aggregate([
                    { $match: match },
                    {
                        $group: {
                            _id: '$userId',
                            points: { $sum: `$${sumField}` },
                            streak: { $max: '$currentStreak' },
                        },
                    },
                    { $sort: { points: -1 } },
                    { $limit: limit },
                ]);
                const entries = rows.map((r) => ({
                    userId: r._id,
                    points: Math.round(Number(r.points || 0)),
                    streak: Math.round(Number(r.streak || 0)),
                }));
                const withNames = await attachUserFields(client, entries, 'userId');
                return {
                    board: spec.board,
                    boardLabel: spec.label,
                    entries: withNames,
                    cachedAt: new Date().toISOString(),
                };
            });
            res.json(data);
        } catch (e) {
            console.error('[API] GET /api/leaderboard/players', e);
            res.status(500).json({ error: 'leaderboard_unavailable' });
        }
    }));

    router.get('/leaderboard/factions', withProdModels(async (req, res) => {
        try {
            const cacheKey = `leaderboard:factions${publicStatsCacheKeySuffix()}`;
            const data = await cached(cacheKey, LEADERBOARD_TTL_MS, async () => {
                const sorted = await getGlobalFactionStandingsFromUsers();
                const entries = sorted.map((e, i) => ({
                    rank: i + 1,
                    name: e.name,
                    emoji: e.emoji,
                    matchPoints: e.matchPoints,
                    rankedWins: e.rankedWins,
                    rankedLosses: e.rankedLosses,
                    rankedTies: e.rankedTies,
                    rawWarContributionTotal: e.rawWarContributionTotal,
                    legacyChallengePoints: e.legacyChallengePoints,
                    members: e.members,
                    totalPoints: e.legacyChallengePoints,
                    seasonHighlightLabel: e.seasonHighlightActive ? e.seasonHighlightLabel : null,
                }));

                return { entries, cachedAt: new Date().toISOString() };
            });
            res.json(data);
        } catch (e) {
            console.error('[API] GET /api/leaderboard/factions', e);
            res.status(500).json({ error: 'leaderboard_unavailable' });
        }
    }));

    router.get('/seasons/current', withProdModels(async (req, res) => {
        try {
            const cacheKey = `seasons:current${publicStatsCacheKeySuffix()}`;
            const data = await cached(cacheKey, LEADERBOARD_TTL_MS, async () => {
                const overview = await getCurrentSeasonOverview();
                return { ...overview, cachedAt: new Date().toISOString() };
            });
            res.json(data);
        } catch (e) {
            console.error('[API] GET /api/seasons/current', e);
            res.status(500).json({ error: 'seasons_unavailable' });
        }
    }));

    router.get('/seasons/hall', withProdModels(async (req, res) => {
        try {
            const limit = clampInt(req.query.limit, 4, 24, 12);
            const cacheKey = `seasons:hall:${limit}${publicStatsCacheKeySuffix()}`;
            const data = await cached(cacheKey, LEADERBOARD_TTL_MS, async () => {
                const hall = await getHallOfChampions(limit);
                return { ...hall, cachedAt: new Date().toISOString() };
            });
            res.json(data);
        } catch (e) {
            console.error('[API] GET /api/seasons/hall', e);
            res.status(500).json({ error: 'seasons_unavailable' });
        }
    }));

    router.get('/seasons/:seasonKey/standings', withProdModels(async (req, res) => {
        try {
            const seasonKey = String(req.params.seasonKey || '').replace(/[^0-9\-QqYy]/g, '');
            if (!seasonKey || seasonKey.length < 6) {
                return res.status(400).json({ error: 'invalid_season_key' });
            }
            const cacheKey = `seasons:standings:${seasonKey}${publicStatsCacheKeySuffix()}`;
            const data = await cached(cacheKey, LEADERBOARD_TTL_MS, async () => getSeasonStandingsForKey(seasonKey));
            res.json({ ...data, cachedAt: new Date().toISOString() });
        } catch (e) {
            console.error('[API] GET /api/seasons/:seasonKey/standings', e);
            res.status(500).json({ error: 'seasons_unavailable' });
        }
    }));

    router.get('/games/today', withProdModels(async (req, res) => {
        try {
            const cacheKey = `games:today${publicStatsCacheKeySuffix()}`;
            const data = await cached(cacheKey, LEADERBOARD_TTL_MS, async () => {
                const rot = await ensureRotationForDate();
                const settings = await getSettings();
                const catalog = allResolvedGames(settings);
                const activeMeta = rot.activeTags.map((t) => {
                    const g = resolveGame(t, settings);
                    if (!g) return null;
                    return {
                        tag: t,
                        displayName: g.displayName,
                        category: g.category,
                        rankedEligible: !!g.rankedEligible,
                        featuredToday: rot.featuredTag === t,
                    };
                }).filter(Boolean);
                const featured = rot.featuredTag ? resolveGame(rot.featuredTag, settings) : null;
                return {
                    dayUtc: rot.dayUtc,
                    activeTags: rot.activeTags,
                    featuredTag: rot.featuredTag || null,
                    featuredDisplayName: featured ? featured.displayName : null,
                    featuredCasualBonusPct: Number(settings.featuredCasualBonusPct) || 0,
                    activeGames: activeMeta,
                    catalogSummary: catalog.map((g) => ({
                        tag: g.tag,
                        displayName: g.displayName,
                        category: g.category,
                        enabled: g.enabled,
                        rankedEligible: !!g.rankedEligible,
                    })),
                    microcopy: {
                        featuredCasualOnly:
                            'Featured Game of the Day: bonus casual credits only — does not affect official faction war scoring.',
                        rankedNote:
                            'Ranked-eligible tags can credit official wars when the war’s game filter includes them. Social games default to casual-only for ranked.',
                    },
                    cachedAt: new Date().toISOString(),
                };
            });
            res.json(data);
        } catch (e) {
            console.error('[API] GET /api/games/today', e);
            res.status(500).json({ error: 'games_unavailable' });
        }
    }));

    router.get('/leaderboard/recruiters', withProdModels(async (req, res) => {
        try {
            const limit = clampInt(req.query.limit, 1, 10, 5);
            const cacheKey = `leaderboard:recruiters:${limit}${publicStatsCacheKeySuffix()}`;
            const { client } = req.app.locals.playbound || {};
            const ex = getExcludedGuildIds();

            const data = await cached(cacheKey, LEADERBOARD_TTL_MS, async () => {
                const match = ex.length ? { guildId: { $nin: ex } } : {};
                const rows = await ReferralFirstGamePayout.aggregate([
                    { $match: match },
                    { $group: { _id: '$referrerUserId', successfulReferrals: { $sum: 1 } } },
                    { $match: { successfulReferrals: { $gt: 0 } } },
                    { $sort: { successfulReferrals: -1 } },
                    { $limit: limit },
                ]);
                const entries = rows.map((r) => ({
                    userId: r._id,
                    successfulReferrals: Math.round(Number(r.successfulReferrals || 0)),
                    completedGuildCount: Math.round(Number(r.successfulReferrals || 0)),
                }));
                const withNames = await attachUserFields(client, entries, 'userId');
                return {
                    entries: withNames,
                    cachedAt: new Date().toISOString(),
                };
            });
            res.json(data);
        } catch (e) {
            console.error('[API] GET /api/leaderboard/recruiters', e);
            res.status(500).json({ error: 'leaderboard_unavailable' });
        }
    }));

    return router;
}

module.exports = { createPublicApiRouter };
