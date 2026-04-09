'use strict';

const express = require('express');
const mongoRouter = require('../../../lib/mongoRouter');
const { User, SystemConfig } = require('../../../models');
const { resolveAchievementMeta } = require('../../../lib/achievements');
const { cached } = require('./cache');

const ACH_TTL_MS = Number(process.env.API_ME_ACH_TTL_MS) || 60000;

function createMeAchievementsRouter() {
    const router = express.Router();

    router.get('/', async (req, res) => {
        const sess = req.pbSession;
        if (!sess) {
            return res.status(401).json({ error: 'login_required' });
        }
        try {
            const uid = sess.discordUserId;
            const cacheKey = `me:achievements:v2:${uid}`;

            const data = await cached(cacheKey, ACH_TTL_MS, () =>
                mongoRouter.runWithForcedModels(mongoRouter.getModelsProd(), async () => {
                    const userDocs = await User.find({ userId: uid })
                        .select('achievements guildId')
                        .lean();

                    const allKeys = new Set();
                    const guildIds = new Set();
                    for (const doc of userDocs) {
                        guildIds.add(doc.guildId);
                        for (const key of doc.achievements || []) {
                            allKeys.add(key);
                        }
                    }

                    const configs = await SystemConfig.find({
                        guildId: { $in: [...guildIds] },
                    })
                        .select('guildId customAchievements')
                        .lean();

                    const achievements = [];
                    for (const key of allKeys) {
                        let meta = null;
                        for (const cfg of configs) {
                            meta = resolveAchievementMeta(key, cfg);
                            if (meta) break;
                        }
                        if (!meta) {
                            meta = resolveAchievementMeta(key, { customAchievements: [] });
                        }
                        achievements.push({
                            key,
                            name: meta ? meta.name : key,
                            desc: meta ? meta.desc : null,
                        });
                    }

                    return {
                        achievements,
                        cachedAt: new Date().toISOString(),
                    };
                }),
            );

            res.json(data);
        } catch (e) {
            console.error('[API] GET /api/me/achievements', e);
            res.status(500).json({ error: 'achievements_unavailable' });
        }
    });

    return router;
}

module.exports = { createMeAchievementsRouter };
