'use strict';

function requireAdminSession(req, res, next) {
    const s = req.pbSession;
    if (!s) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    if (!s.isDeveloper && (!s.adminGuildIds || s.adminGuildIds.length === 0)) {
        return res.status(403).json({ error: 'forbidden' });
    }
    next();
}

/**
 * @param {import('discord.js').Client|null} client
 * @param {object} sess
 */
function scopeGuildIds(client, sess) {
    if (!client) return [];
    if (sess.isDeveloper) {
        return [...client.guilds.cache.keys()];
    }
    return (sess.adminGuildIds || []).filter((id) => client.guilds.cache.has(id));
}

/**
 * @param {string[]} scoped
 * @param {string|undefined} queryGuildId
 * @returns {string[]|null} null if query requests a guild the user cannot access
 */
function guildIdsForQuery(scoped, queryGuildId) {
    if (queryGuildId == null || queryGuildId === '') return scoped;
    const g = String(queryGuildId);
    if (!scoped.includes(g)) return null;
    return [g];
}

/**
 * @param {import('express').Request} req
 * @param {string|null|undefined} guildId
 * @returns {{ ok: true, guildId: string } | { ok: false, status: number, body: object }}
 */
function requireGuildAccess(req, guildId) {
    if (!guildId || String(guildId).trim() === '') {
        return { ok: false, status: 400, body: { error: 'guildId_required' } };
    }
    const { client } = req.app.locals.playbound || {};
    const scoped = scopeGuildIds(client, req.pbSession);
    if (!scoped.includes(String(guildId))) {
        return { ok: false, status: 403, body: { error: 'forbidden_guild' } };
    }
    return { ok: true, guildId: String(guildId) };
}

module.exports = {
    requireAdminSession,
    scopeGuildIds,
    guildIdsForQuery,
    requireGuildAccess,
};
