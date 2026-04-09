'use strict';

const express = require('express');
const mongoRouter = require('../../../lib/mongoRouter');
const { User, FactionChallenge } = require('../../../models');
const { getGlobalFactionStandingsFromUsers } = require('../../../lib/globalFactionAggregates');
const { cached } = require('./cache');

const FACTION_TTL_MS = Number(process.env.API_ME_FACTION_TTL_MS) || 60000;

function createMeFactionRouter() {
    const router = express.Router();

    router.get('/', async (req, res) => {
        const sess = req.pbSession;
        if (!sess) {
            return res.status(401).json({ error: 'login_required' });
        }
        try {
            const uid = sess.discordUserId;
            const cacheKey = `me:factions:v2:${uid}`;

            const data = await cached(cacheKey, FACTION_TTL_MS, () =>
                mongoRouter.runWithForcedModels(mongoRouter.getModelsProd(), async () => {
                    const userRows = await User.find({
                        userId: uid,
                        faction: { $nin: [null, ''] },
                    })
                        .select('guildId faction')
                        .lean();

                    if (!userRows.length) {
                        return {
                            factions: [],
                            faction: null,
                            warCount: 0,
                            recentWars: [],
                            cachedAt: new Date().toISOString(),
                        };
                    }

                    const standings = await getGlobalFactionStandingsFromUsers();

                    const factions = userRows.map((row) => {
                        const name = row.faction;
                        const idx = standings.findIndex((f) => f.name === name);
                        const factionData = idx >= 0 ? standings[idx] : null;
                        return {
                            guildId: String(row.guildId),
                            name,
                            emoji: factionData?.emoji || '⚔️',
                            matchPoints: factionData?.matchPoints || 0,
                            rank: idx >= 0 ? idx + 1 : null,
                        };
                    });

                    const factionNames = [...new Set(factions.map((f) => f.name))];
                    const warOr = [
                        { participantsA: uid },
                        { participantsB: uid },
                        ...factionNames.map((fn) => ({ [`participantsByFaction.${fn}`]: uid })),
                    ];

                    const warCount = await FactionChallenge.countDocuments({ $or: warOr });

                    const recentWars = await FactionChallenge.find({
                        status: 'ended',
                        endedAt: { $ne: null },
                        $or: warOr,
                    })
                        .sort({ endedAt: -1 })
                        .limit(10)
                        .select('winnerFaction factionA factionB endedAt participantsByFaction')
                        .lean();

                    const primary = factions[0];
                    const legacyFaction = primary
                        ? {
                              name: primary.name,
                              emoji: primary.emoji,
                              matchPoints: primary.matchPoints,
                              rank: primary.rank,
                          }
                        : null;

                    function userFactionForWar(w) {
                        const pbf = w.participantsByFaction;
                        if (pbf && typeof pbf === 'object') {
                            for (const fname of Object.keys(pbf)) {
                                const v = pbf[fname];
                                if (v != null && String(v) === String(uid)) return fname;
                            }
                        }
                        return primary ? primary.name : null;
                    }

                    return {
                        factions,
                        faction: legacyFaction,
                        warCount,
                        recentWars: recentWars.map((w) => ({
                            challengeId: String(w._id),
                            winnerFaction: w.winnerFaction || null,
                            userFaction: userFactionForWar(w),
                            endedAt: w.endedAt ? w.endedAt.toISOString() : null,
                        })),
                        cachedAt: new Date().toISOString(),
                    };
                }),
            );

            res.json(data);
        } catch (e) {
            console.error('[API] GET /api/me/faction', e);
            res.status(500).json({ error: 'faction_unavailable' });
        }
    });

    return router;
}

module.exports = { createMeFactionRouter };
