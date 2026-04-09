'use strict';

const express = require('express');
const { SystemConfig } = require('../../../models');
const { requireAdminSession, requireGuildAccess } = require('./adminAuth');

function validateShopItem(item) {
    if (!item || typeof item !== 'object') return 'invalid_item';
    if (!item.name || String(item.name).trim() === '') return 'name_required';
    const price = parseInt(String(item.price), 10);
    if (!Number.isFinite(price) || price < 1) return 'price_must_be_positive_integer';
    return null;
}

function createAdminShopRouter() {
    const router = express.Router();
    router.use(requireAdminSession);

    router.post('/', async (req, res) => {
        const acc = requireGuildAccess(req, req.body?.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;

        const item = req.body?.item;
        const err = validateShopItem(item);
        if (err) return res.status(400).json({ error: err });

        try {
            const entry = {
                name: String(item.name).trim(),
                price: parseInt(String(item.price), 10),
                desc: String(item.desc || '').trim(),
                type: String(item.type || 'consumable').trim(),
                premiumOnly: item.premiumOnly === true,
            };
            await SystemConfig.updateOne({ guildId }, { $push: { shopItems: entry } });
            res.json({ ok: true });
        } catch (e) {
            console.error('[API] POST /api/admin/shop', e);
            res.status(500).json({ error: 'shop_update_failed' });
        }
    });

    router.put('/:itemIndex', async (req, res) => {
        const acc = requireGuildAccess(req, req.body?.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;

        const idx = parseInt(req.params.itemIndex, 10);
        if (!Number.isFinite(idx) || idx < 0) {
            return res.status(400).json({ error: 'invalid_index' });
        }

        const item = req.body?.item;
        const err = validateShopItem(item);
        if (err) return res.status(400).json({ error: err });

        try {
            const cfg = await SystemConfig.findOne({ guildId }).select('shopItems').lean();
            if (!cfg || !cfg.shopItems || idx >= cfg.shopItems.length) {
                return res.status(404).json({ error: 'item_not_found' });
            }

            const entry = {
                name: String(item.name).trim(),
                price: parseInt(String(item.price), 10),
                desc: String(item.desc || '').trim(),
                type: String(item.type || 'consumable').trim(),
                premiumOnly: item.premiumOnly === true,
            };
            await SystemConfig.updateOne(
                { guildId },
                { $set: { [`shopItems.${idx}`]: entry } },
            );
            res.json({ ok: true });
        } catch (e) {
            console.error('[API] PUT /api/admin/shop/:idx', e);
            res.status(500).json({ error: 'shop_update_failed' });
        }
    });

    router.delete('/:itemIndex', async (req, res) => {
        const acc = requireGuildAccess(req, req.body?.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;

        const idx = parseInt(req.params.itemIndex, 10);
        if (!Number.isFinite(idx) || idx < 0) {
            return res.status(400).json({ error: 'invalid_index' });
        }

        try {
            const cfg = await SystemConfig.findOne({ guildId }).select('shopItems').lean();
            if (!cfg || !cfg.shopItems || idx >= cfg.shopItems.length) {
                return res.status(404).json({ error: 'item_not_found' });
            }

            await SystemConfig.updateOne(
                { guildId },
                { $unset: { [`shopItems.${idx}`]: 1 } },
            );
            await SystemConfig.updateOne(
                { guildId },
                { $pull: { shopItems: null } },
            );
            res.json({ ok: true });
        } catch (e) {
            console.error('[API] DELETE /api/admin/shop/:idx', e);
            res.status(500).json({ error: 'shop_update_failed' });
        }
    });

    return router;
}

module.exports = { createAdminShopRouter, validateShopItem };
