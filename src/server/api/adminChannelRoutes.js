'use strict';

const express = require('express');
const { ChannelType } = require('discord.js');
const mongoRouter = require('../../../lib/mongoRouter');
const { requireAdminSession, requireGuildAccess } = require('./adminAuth');

const CHANNEL_FIELDS = [
    'announceChannel',
    'welcomeChannel',
    'birthdayChannel',
    'achievementChannel',
    'leaderboardChannel',
    'storyChannel',
];

function createAdminChannelRouter() {
    const router = express.Router();
    router.use(requireAdminSession);

    router.get('/', async (req, res) => {
        const acc = requireGuildAccess(req, req.query.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;

        try {
            const { client } = req.app.locals.playbound || {};
            const guild = client?.guilds?.cache?.get(guildId);
            const channels = [];
            if (guild) {
                for (const ch of guild.channels.cache.values()) {
                    if (ch.type === ChannelType.GuildText) {
                        channels.push({ id: ch.id, name: ch.name });
                    }
                }
                channels.sort((a, b) => a.name.localeCompare(b.name));
            }

            const { SystemConfig } = mongoRouter.getModelsForGuild(guildId);
            const cfg = await SystemConfig.findOne({ guildId })
                .select(CHANNEL_FIELDS.join(' '))
                .lean();

            const assignments = {};
            for (const f of CHANNEL_FIELDS) {
                assignments[f] = cfg?.[f] || null;
            }

            res.json({ channels, assignments, cachedAt: new Date().toISOString() });
        } catch (e) {
            console.error('[API] GET /api/admin/channels', e);
            res.status(500).json({ error: 'channels_unavailable' });
        }
    });

    router.patch('/', async (req, res) => {
        const acc = requireGuildAccess(req, req.body?.guildId);
        if (!acc.ok) return res.status(acc.status).json(acc.body);
        const { guildId } = acc;

        const updates = req.body?.updates;
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'updates_required' });
        }

        try {
            const { client } = req.app.locals.playbound || {};
            const guild = client?.guilds?.cache?.get(guildId);
            const validChannelIds = new Set();
            if (guild) {
                for (const ch of guild.channels.cache.values()) {
                    if (ch.type === ChannelType.GuildText) {
                        validChannelIds.add(ch.id);
                    }
                }
            }

            const $set = {};
            for (const [field, channelId] of Object.entries(updates)) {
                if (!CHANNEL_FIELDS.includes(field)) continue;
                if (channelId === null || channelId === '') {
                    $set[field] = null;
                } else {
                    if (!validChannelIds.has(String(channelId))) {
                        return res.status(400).json({ error: 'invalid_channel', field, channelId });
                    }
                    $set[field] = String(channelId);
                }
            }

            if (Object.keys($set).length > 0) {
                const { SystemConfig } = mongoRouter.getModelsForGuild(guildId);
                await SystemConfig.updateOne({ guildId }, { $set });
            }

            res.json({ ok: true });
        } catch (e) {
            console.error('[API] PATCH /api/admin/channels', e);
            res.status(500).json({ error: 'channels_update_failed' });
        }
    });

    return router;
}

module.exports = { createAdminChannelRouter };
