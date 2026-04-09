'use strict';

const express = require('express');
const mongoRouter = require('../../../lib/mongoRouter');
const { User, ShopItem, SystemConfig } = require('../../../models');
const { cached } = require('./cache');

const SHOP_TTL_MS = Number(process.env.API_SHOP_TTL_MS) || 60000;

function createShopRouter() {
    const router = express.Router();

    router.get('/', async (req, res) => {
        try {
            const sess = req.pbSession;
            const guildId = req.query.guildId ? String(req.query.guildId) : null;
            const uid = sess ? sess.discordUserId : null;
            const cacheKey = `shop:${guildId || 'global'}:${uid || 'anon'}`;

            const data = await cached(cacheKey, SHOP_TTL_MS, () =>
                mongoRouter.runWithForcedModels(mongoRouter.getModelsProd(), async () => {
                    const globalItems = await ShopItem.find({}).lean();
                    const items = globalItems.map((item) => ({
                        id: item.id,
                        name: item.name,
                        price: item.price,
                        desc: item.desc,
                        type: item.type,
                        premiumOnly: item.premiumOnly || false,
                        source: 'global',
                    }));

                    if (guildId) {
                        const cfg = await SystemConfig.findOne({ guildId })
                            .select('shopItems')
                            .lean();
                        if (cfg && Array.isArray(cfg.shopItems)) {
                            for (let i = 0; i < cfg.shopItems.length; i++) {
                                const si = cfg.shopItems[i];
                                items.push({
                                    id: si.id || `server_${i}`,
                                    name: si.name || '',
                                    price: si.price || 0,
                                    desc: si.desc || '',
                                    type: si.type || 'consumable',
                                    premiumOnly: si.premiumOnly || false,
                                    source: 'server',
                                    serverShopIndex: i,
                                });
                            }
                        }
                    }

                    if (uid) {
                        const userDoc = guildId
                            ? await User.findOne({ userId: uid, guildId }).select('inventory currentCosmetics').lean()
                            : null;
                        const inventory = userDoc?.inventory || [];
                        const cosmetics = userDoc?.currentCosmetics || {};
                        const cosmeticValues = new Set(
                            cosmetics instanceof Map
                                ? [...cosmetics.values()]
                                : Object.values(cosmetics),
                        );

                        for (const item of items) {
                            item.owned = inventory.includes(item.id) || cosmeticValues.has(item.id);
                            item.equipped = cosmeticValues.has(item.id);
                        }
                    }

                    return { items, cachedAt: new Date().toISOString() };
                }),
            );

            res.json(data);
        } catch (e) {
            console.error('[API] GET /api/shop', e);
            res.status(500).json({ error: 'shop_unavailable' });
        }
    });

    return router;
}

module.exports = { createShopRouter };
