'use strict';

const crypto = require('crypto');

/** @type {Map<string, { discordUserId: string, accessToken: string, username: string, globalName: string|null, adminGuildIds: string[], isDeveloper: boolean, createdAt: number }>} */
const sessions = new Map();

const MAX_AGE_MS = 7 * 86400000;

function createSession(payload) {
    const id = crypto.randomBytes(32).toString('hex');
    sessions.set(id, { ...payload, createdAt: Date.now() });
    return id;
}

function getSession(id) {
    if (!id || typeof id !== 'string') return null;
    const s = sessions.get(id);
    if (!s) return null;
    if (Date.now() - s.createdAt > MAX_AGE_MS) {
        sessions.delete(id);
        return null;
    }
    return s;
}

function destroySession(id) {
    if (id) sessions.delete(id);
}

module.exports = { createSession, getSession, destroySession };
