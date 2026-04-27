'use strict';

const express = require('express');
const mongoRouter = require('../../../lib/mongoRouter');
const { User } = require('../../../models');
const { cached } = require('./cache');

const STATS_TTL_MS = Number(process.env.API_ME_STATS_TTL_MS) || 60000;

function createMeStatsRouter() {
    const router = express.Router();

    router.get('/', async (req, res) => {
        const sess = req.pbSession;
        if (!sess) {
            return res.status(401).json({ error: 'login_required' });
        }
        try {
            const uid = sess.discordUserId;
            // Personal stats: include every guild the user appears in (same as per-server /profile),
            // not PUBLIC_STATS_EXCLUDE_GUILD_IDS (that filter is for global marketing aggregates only).
            const cacheKey = `me:stats:v2:${uid}`;

            const data = await cached(cacheKey, STATS_TTL_MS, () =>
                mongoRouter.runWithForcedModels(mongoRouter.getModelsProd(), async () => {
                    const matchUser = { userId: uid };

                    const [agg] = await User.aggregate([
                        { $match: matchUser },
                        {
                            $group: {
                                _id: null,
                                totalGamesWon: { $sum: '$stats.gamesWon' },
                                trivia: { $sum: '$stats.triviaWins' },
                                serverdle: { $sum: '$stats.serverdleWins' },
                                unscramble: { $sum: '$stats.unscrambleWins' },
                                tune: { $sum: '$stats.tuneWins' },
                                caption: { $sum: '$stats.captionWins' },
                                sprint: { $sum: '$stats.sprintWins' },
                                guess: { $sum: '$stats.guessWins' },
                                mastermind: { $sum: '$stats.mastermindWins' },
                            },
                        },
                    ]);

                    const [serverAgg] = await User.aggregate([
                        { $match: matchUser },
                        {
                            $match: {
                                $expr: {
                                    $gt: [
                                        {
                                            $add: [
                                                { $ifNull: ['$stats.gamesWon', 0] },
                                            ],
                                        },
                                        0,
                                    ],
                                },
                            },
                        },
                        { $group: { _id: '$guildId' } },
                        { $count: 'n' },
                    ]);

                    return {
                        totalGamesWon: Math.round(Number(agg?.totalGamesWon || 0)),
                        perGame: {
                            trivia: Math.round(Number(agg?.trivia || 0)),
                            serverdle: Math.round(Number(agg?.serverdle || 0)),
                            unscramble: Math.round(Number(agg?.unscramble || 0)),
                            tune: Math.round(Number(agg?.tune || 0)),
                            caption: Math.round(Number(agg?.caption || 0)),
                            sprint: Math.round(Number(agg?.sprint || 0)),
                            guess: Math.round(Number(agg?.guess || 0)),
                            mastermind: Math.round(Number(agg?.mastermind || 0)),
                        },
                        serverCount: Math.round(Number(serverAgg?.n || 0)),
                        cachedAt: new Date().toISOString(),
                    };
                }),
            );

            res.json(data);
        } catch (e) {
            console.error('[API] GET /api/me/stats', e);
            res.status(500).json({ error: 'stats_unavailable' });
        }
    });

    return router;
}

module.exports = { createMeStatsRouter };
