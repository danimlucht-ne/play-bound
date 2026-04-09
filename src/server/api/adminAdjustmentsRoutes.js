'use strict';

const express = require('express');
const mongoRouter = require('../../../lib/mongoRouter');
const { User } = require('../../../models');
const { cached } = require('./cache');
const { requireAdminSession, scopeGuildIds, guildIdsForQuery } = require('./adminAuth');

const ADMIN_ADJUST_TTL_MS = Number(process.env.API_ADMIN_ADJUST_TTL_MS) || 60000;

function withProdModels(handler) {
    return async (req, res) => {
        await mongoRouter.runWithForcedModels(mongoRouter.getModelsProd(), async () => {
            await Promise.resolve(handler(req, res));
        });
    };
}

function actorFromLabel(label) {
    const s = String(label || '');
    if (!s.startsWith('admin_adjust:')) return null;
    const rest = s.slice('admin_adjust:'.length);
    return rest || null;
}

/**
 * @param {import('discord.js').Client|null} client
 * @param {string} id
 */
async function displayNameForUser(client, id) {
    if (!id) return 'Unknown';
    if (client && client.isReady()) {
        try {
            const u = await client.users.fetch(id);
            return u.globalName || u.username || id;
        } catch {
            /* fall through */
        }
    }
    return id;
}

function createAdminAdjustmentsRouter() {
    const router = express.Router();

    router.use(requireAdminSession);

    router.get('/guilds', async (req, res) => {
        try {
            const { client } = req.app.locals.playbound || {};
            const ids = scopeGuildIds(client, req.pbSession);
            const guilds = ids
                .map((id) => {
                    const g = client.guilds.cache.get(id);
                    return { id, name: g?.name ? String(g.name) : `Server ${id}` };
                })
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
            res.json({ guilds, cachedAt: new Date().toISOString() });
        } catch (e) {
            console.error('[API] GET /api/admin/guilds', e);
            res.status(500).json({ error: 'guilds_unavailable' });
        }
    });

    router.get('/adjustments/recent', withProdModels(async (req, res) => {
        try {
            const { client } = req.app.locals.playbound || {};
            const scoped = scopeGuildIds(client, req.pbSession);
            const guildIds = guildIdsForQuery(scoped, req.query.guildId);
            if (guildIds === null) {
                return res.status(403).json({ error: 'forbidden_guild' });
            }
            if (guildIds.length === 0) {
                return res.json({ entries: [], guildId: null, cachedAt: new Date().toISOString() });
            }

            const cacheKey = `admin:recent:${req.pbSession.discordUserId}:${guildIds.slice().sort().join(',')}`;
            const data = await cached(cacheKey, ADMIN_ADJUST_TTL_MS, async () => {
                const rows = await User.aggregate([
                    { $match: { guildId: { $in: guildIds } } },
                    { $unwind: '$pointLedger' },
                    { $match: { 'pointLedger.label': { $regex: '^admin_adjust:' } } },
                    { $sort: { 'pointLedger.at': -1 } },
                    { $limit: 5 },
                    {
                        $project: {
                            at: '$pointLedger.at',
                            amount: '$pointLedger.amount',
                            reason: '$pointLedger.reason',
                            label: '$pointLedger.label',
                            guildId: '$guildId',
                            targetUserId: '$userId',
                        },
                    },
                ]);

                const entries = [];
                for (const r of rows) {
                    const actorUserId = actorFromLabel(r.label);
                    const [targetUsername, actorUsername] = await Promise.all([
                        displayNameForUser(client, r.targetUserId),
                        displayNameForUser(client, actorUserId),
                    ]);
                    entries.push({
                        at: r.at ? new Date(r.at).toISOString() : null,
                        guildId: r.guildId,
                        targetUserId: r.targetUserId,
                        targetUsername,
                        amount: Math.round(Number(r.amount || 0)),
                        actorUserId,
                        actorUsername,
                        reason: r.reason ? String(r.reason).slice(0, 180) : null,
                    });
                }
                return {
                    entries,
                    guildId: guildIds.length === 1 ? guildIds[0] : null,
                    cachedAt: new Date().toISOString(),
                };
            });
            res.json(data);
        } catch (e) {
            console.error('[API] GET /api/admin/adjustments/recent', e);
            res.status(500).json({ error: 'adjustments_unavailable' });
        }
    }));

    router.get('/adjustments/summary', withProdModels(async (req, res) => {
        try {
            const { client } = req.app.locals.playbound || {};
            const scoped = scopeGuildIds(client, req.pbSession);
            const guildIds = guildIdsForQuery(scoped, req.query.guildId);
            if (guildIds === null) {
                return res.status(403).json({ error: 'forbidden_guild' });
            }
            if (guildIds.length === 0) {
                return res.json({
                    count: 0,
                    netPoints: 0,
                    distinctAdmins: 0,
                    guildId: null,
                    cachedAt: new Date().toISOString(),
                });
            }

            const since = new Date(Date.now() - 7 * 86400000);
            const cacheKey = `admin:sum7:${req.pbSession.discordUserId}:${guildIds.slice().sort().join(',')}`;
            const data = await cached(cacheKey, ADMIN_ADJUST_TTL_MS, async () => {
                const rows = await User.aggregate([
                    { $match: { guildId: { $in: guildIds } } },
                    { $unwind: '$pointLedger' },
                    {
                        $match: {
                            'pointLedger.label': { $regex: '^admin_adjust:' },
                            'pointLedger.at': { $gte: since },
                        },
                    },
                    {
                        $facet: {
                            agg: [
                                {
                                    $group: {
                                        _id: null,
                                        count: { $sum: 1 },
                                        netPoints: { $sum: '$pointLedger.amount' },
                                    },
                                },
                            ],
                            actors: [
                                {
                                    $addFields: {
                                        actorId: {
                                            $arrayElemAt: [{ $split: ['$pointLedger.label', ':'] }, 1],
                                        },
                                    },
                                },
                                { $match: { actorId: { $nin: [null, ''] } } },
                                { $group: { _id: '$actorId' } },
                                { $count: 'n' },
                            ],
                        },
                    },
                ]);

                const facet = rows[0] || { agg: [], actors: [] };
                const agg = facet.agg[0] || { count: 0, netPoints: 0 };
                const distinctAdmins = facet.actors && facet.actors[0] ? Math.round(Number(facet.actors[0].n || 0)) : 0;

                return {
                    count: Math.round(Number(agg.count || 0)),
                    netPoints: Math.round(Number(agg.netPoints || 0)),
                    distinctAdmins,
                    guildId: guildIds.length === 1 ? guildIds[0] : null,
                    cachedAt: new Date().toISOString(),
                };
            });
            res.json(data);
        } catch (e) {
            console.error('[API] GET /api/admin/adjustments/summary', e);
            res.status(500).json({ error: 'adjustments_unavailable' });
        }
    }));

    return router;
}

module.exports = { createAdminAdjustmentsRouter, actorFromLabel, displayNameForUser, scopeGuildIds, guildIdsForQuery };
