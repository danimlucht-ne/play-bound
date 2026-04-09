'use strict';

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { parseCookies, buildSetCookie } = require('./httpCookies');
const { createSession, destroySession, getSession } = require('./sessionStore');

const DISCORD_API = 'https://discord.com/api/v10';
const ADMIN_PERMISSION = 1n << 3n; // Administrator

/** First entry when `CORS_ORIGIN` is comma-separated (avoid invalid redirect URL). */
function firstCorsOrigin() {
    const part = String(process.env.CORS_ORIGIN || '')
        .split(',')[0]
        .trim();
    return part || null;
}

function hasCorsOriginsConfigured() {
    return Boolean(String(process.env.CORS_ORIGIN || '').trim());
}

function createAuthDiscordRouter() {
    const router = express.Router();

    router.get('/discord/login', (req, res) => {
        const clientId = process.env.CLIENT_ID;
        const redirectUri = process.env.OAUTH_REDIRECT_URI;
        if (!clientId || !redirectUri) {
            return res.status(503).type('text').send('OAuth is not configured (CLIENT_ID and OAUTH_REDIRECT_URI).');
        }
        const state = crypto.randomBytes(24).toString('hex');
        res.setHeader('Set-Cookie', [
            buildSetCookie('pb_oauth_state', state, { maxAge: 600 }),
        ]);
        const url = new URL('https://discord.com/oauth2/authorize');
        url.searchParams.set('client_id', clientId);
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('scope', 'identify guilds');
        url.searchParams.set('state', state);
        url.searchParams.set('prompt', 'consent');
        res.redirect(url.toString());
    });

    router.get('/discord/callback', async (req, res) => {
        const clientId = process.env.CLIENT_ID;
        const clientSecret = process.env.DISCORD_CLIENT_SECRET;
        const redirectUri = process.env.OAUTH_REDIRECT_URI;
        const { code, state } = req.query;
        const cookies = parseCookies(req.headers.cookie);
        if (!code || !state || state !== cookies.pb_oauth_state) {
            return res.status(400).type('text').send('Invalid OAuth state or missing code.');
        }
        if (!clientId || !clientSecret || !redirectUri) {
            return res.status(503).type('text').send('OAuth is not configured.');
        }

        const { client } = req.app.locals.playbound || {};
        if (!client) {
            return res.status(503).type('text').send('Bot client not ready.');
        }

        try {
            const tokenRes = await axios.post(
                'https://discord.com/api/oauth2/token',
                new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    grant_type: 'authorization_code',
                    code: String(code),
                    redirect_uri: redirectUri,
                }),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
            );
            const { access_token } = tokenRes.data;
            if (!access_token) {
                return res.status(400).type('text').send('No access token from Discord.');
            }

            const [meRes, guildsRes] = await Promise.all([
                axios.get(`${DISCORD_API}/users/@me`, {
                    headers: { Authorization: `Bearer ${access_token}` },
                }),
                axios.get(`${DISCORD_API}/users/@me/guilds`, {
                    headers: { Authorization: `Bearer ${access_token}` },
                }),
            ]);

            const discordUserId = String(meRes.data.id);
            const username = String(meRes.data.username || '');
            const globalName = meRes.data.global_name ? String(meRes.data.global_name) : null;

            const isDeveloper = String(process.env.DEVELOPER_ID || '') === discordUserId;

            const adminGuildIds = [];
            if (!isDeveloper && guildsRes.data && Array.isArray(guildsRes.data)) {
                for (const g of guildsRes.data) {
                    try {
                        const perm = BigInt(g.permissions);
                        if ((perm & ADMIN_PERMISSION) === ADMIN_PERMISSION && client.guilds.cache.has(g.id)) {
                            adminGuildIds.push(g.id);
                        }
                    } catch {
                        /* skip malformed */
                    }
                }
            }

            const sid = createSession({
                discordUserId,
                accessToken: access_token,
                username,
                globalName,
                adminGuildIds,
                isDeveloper,
            });

            const crossSite = hasCorsOriginsConfigured();
            const clearState = buildSetCookie('pb_oauth_state', '', { maxAge: 0 });
            const sidCookie = buildSetCookie('pb_sid', sid, {
                maxAge: 7 * 86400,
                sameSite: crossSite ? 'None' : 'Lax',
                secure: crossSite || process.env.NODE_ENV === 'production',
            });
            res.setHeader('Set-Cookie', [clearState, sidCookie]);

            const landing = process.env.OAUTH_SUCCESS_REDIRECT || firstCorsOrigin() || '/';
            res.redirect(302, landing);
        } catch (e) {
            console.error('[OAuth] callback error:', e.response?.data || e.message);
            res.status(500).type('text').send('OAuth failed. Try again.');
        }
    });

    router.post('/logout', (req, res) => {
        const cookies = parseCookies(req.headers.cookie);
        destroySession(cookies.pb_sid);
        const crossSite = hasCorsOriginsConfigured();
        res.setHeader(
            'Set-Cookie',
            buildSetCookie('pb_sid', '', {
                maxAge: 0,
                sameSite: crossSite ? 'None' : 'Lax',
                secure: crossSite || process.env.NODE_ENV === 'production',
            }),
        );
        res.json({ ok: true });
    });

    router.get('/logout', (req, res) => {
        const cookies = parseCookies(req.headers.cookie);
        destroySession(cookies.pb_sid);
        const crossSite = hasCorsOriginsConfigured();
        res.setHeader(
            'Set-Cookie',
            buildSetCookie('pb_sid', '', {
                maxAge: 0,
                sameSite: crossSite ? 'None' : 'Lax',
                secure: crossSite || process.env.NODE_ENV === 'production',
            }),
        );
        const landing = process.env.OAUTH_SUCCESS_REDIRECT || firstCorsOrigin() || '/';
        res.redirect(302, landing);
    });

    return router;
}

function loadSessionMiddleware(req, res, next) {
    const cookies = parseCookies(req.headers.cookie);
    req.pbSession = getSession(cookies.pb_sid) || null;
    next();
}

module.exports = { createAuthDiscordRouter, loadSessionMiddleware };
