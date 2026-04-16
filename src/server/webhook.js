'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const mongoRouter = require('../../lib/mongoRouter');
const { isShuttingDown } = require('../../lib/botLifecycle');
const { trackPremiumConversion } = require('../../lib/premiumAnalytics');
const { createPublicApiRouter } = require('./api/publicRoutes');
const { createAuthDiscordRouter, loadSessionMiddleware } = require('./api/authDiscord');
const { createMeRouter } = require('./api/meRoutes');
const { createMeStatsRouter } = require('./api/meStatsRoutes');
const { createMeFactionRouter } = require('./api/meFactionRoutes');
const { createMeAchievementsRouter } = require('./api/meAchievementsRoutes');
const { createShopRouter } = require('./api/shopRoutes');
const { createAdminShopRouter } = require('./api/adminShopRoutes');
const { createAdminChannelRouter } = require('./api/adminChannelRoutes');
const { createAdminAdjustmentsRouter } = require('./api/adminAdjustmentsRoutes');
const { createAdminPanelRouter } = require('./api/adminPanelRoutes');

/**
 * Shared HTTP app: Stripe webhook, health, and future `/api/*` + static UI.
 * Mount `express.json()` only after the raw-body `/webhook` route.
 *
 * @param {object} botCtx
 * @param {import('discord.js').Client} botCtx.client
 * @param {object} botCtx.state - `src/bot/state`
 * @param {Function} botCtx.scheduleGame
 * @param {Function} botCtx.resumeScheduledGames
 * @param {object} botCtx.triggers - game end triggers from `createGameEndTriggers`
 * @returns {import('express').Express}
 */
/**
 * @param {string|null|undefined} p
 * @returns {string|null}
 */
function resolvedEnvPath(p) {
    if (p == null || String(p).trim() === '') return null;
    const s = String(p).trim();
    return path.isAbsolute(s) ? s : path.resolve(process.cwd(), s);
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function contentTypeForLegalFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.txt' || ext === '.md') return 'text/plain; charset=utf-8';
    return 'text/html; charset=utf-8';
}

/**
 * Serve terms/privacy for the canonical URLs `/terms.html` and `/privacy.html`.
 * Plain `.txt` / `.md` is supported so policies can be maintained without writing HTML.
 *
 * Priority: `LEGAL_TERMS_FILE` / `LEGAL_PRIVACY_FILE`, then `LEGAL_CONTENT_DIR`
 * (`*.html` then `*.txt`), then `PUBLIC_DIR` (`*.html` then `*.txt`).
 *
 * @param {import('express').Response} res
 * @param {'terms' | 'privacy'} doc
 * @param {string|null} resolvedPublic
 * @param {boolean} hasPublic
 * @returns {boolean} true if a file was sent
 */
function tryServeLegalDocument(res, doc, resolvedPublic, hasPublic) {
    const htmlBase = doc === 'terms' ? 'terms.html' : 'privacy.html';
    const txtBase = doc === 'terms' ? 'terms.txt' : 'privacy.txt';
    const envFile = doc === 'terms' ? process.env.LEGAL_TERMS_FILE : process.env.LEGAL_PRIVACY_FILE;

    /** @param {string} absPath */
    const tryFile = (absPath) => {
        if (!absPath) return false;
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) return false;
        res.type(contentTypeForLegalFile(absPath));
        res.sendFile(path.resolve(absPath));
        return true;
    };

    const direct = resolvedEnvPath(envFile);
    if (tryFile(direct)) return true;

    const dir = resolvedEnvPath(process.env.LEGAL_CONTENT_DIR);
    if (dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        if (tryFile(path.join(dir, htmlBase))) return true;
        if (tryFile(path.join(dir, txtBase))) return true;
    }

    if (hasPublic && resolvedPublic && fs.existsSync(resolvedPublic)) {
        if (tryFile(path.join(resolvedPublic, htmlBase))) return true;
        if (tryFile(path.join(resolvedPublic, txtBase))) return true;
    }

    return false;
}

function createHttpApp(botCtx) {
    const app = express();
    app.locals.playbound = botCtx;

    const resolvedPublic = process.env.PUBLIC_DIR ? path.resolve(process.cwd(), process.env.PUBLIC_DIR) : null;
    const hasPublic = Boolean(resolvedPublic && fs.existsSync(resolvedPublic));
    if (hasPublic) {
        app.locals.playboundPublicDir = resolvedPublic;
    }

    const generalLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 100,
        standardHeaders: true,
        legacyHeaders: false,
    });
    const webhookLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
    });
    app.use(generalLimiter);

    // Legal docs (env + optional plain text) before static — see `.env.example` LEGAL_* / LEGAL_CONTENT_DIR.
    app.get('/terms.html', (req, res, next) => {
        if (tryServeLegalDocument(res, 'terms', resolvedPublic, hasPublic)) return;
        return hasPublic ? next() : res.status(404).type('text/plain').send('Not found');
    });
    app.get('/privacy.html', (req, res, next) => {
        if (tryServeLegalDocument(res, 'privacy', resolvedPublic, hasPublic)) return;
        return hasPublic ? next() : res.status(404).type('text/plain').send('Not found');
    });

    if (hasPublic) {
        app.use(express.static(resolvedPublic));
    } else {
        app.get('/', (req, res) => res.send('PlayBound Bot is online!'));
    }
    app.get('/health', (req, res) => {
        if (isShuttingDown()) {
            return res.status(503).json({ status: 'shutting_down' });
        }
        res.json({ status: 'ok' });
    });
    app.get('/webhook', (req, res) => res.send('Webhook endpoint is active (POST only).'));

    app.post('/webhook', webhookLimiter, express.raw({ type: 'application/json' }), async (req, res) => {
        const paymentProvider = process.env.PAYMENT_PROVIDER || 'stripe';
        if (paymentProvider !== 'stripe') {
            console.warn(`[Webhook] Received Stripe event but PAYMENT_PROVIDER=${paymentProvider}. Ignoring.`);
            return res.json({ received: true });
        }

        const sig = req.headers['stripe-signature'];
        let event;

        try {
            event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
        } catch (err) {
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        if (event.type === 'checkout.session.completed') {
            try {
                const session = event.data.object;

                let discordUserId = session.metadata.discord_id;
                if (!discordUserId && session.custom_fields) {
                    const field = session.custom_fields.find((f) => f.label.toLowerCase().includes('discord user id'));
                    if (field) discordUserId = field.text.value;
                }

                if (discordUserId) {
                    if (session.customer) {
                        await stripe.customers.update(session.customer, { metadata: { discord_id: discordUserId } });
                    }

                    const grantResult = await mongoRouter.updateUserByDiscordIdEverywhere(discordUserId, {
                        isPremium: true,
                        premiumSource: 'stripe',
                    });
                    if (grantResult === 0) {
                        console.warn(
                            `[Stripe] WARNING: No user documents found for Discord ID ${discordUserId}. Payment received but premium not granted — user may not have interacted with the bot yet or entered an incorrect ID.`,
                        );
                    } else {
                        console.log(
                            `[Stripe] Granted Premium to user ${discordUserId} (${grantResult} documents updated)`,
                        );
                        await trackPremiumConversion({ userId: discordUserId, source: 'stripe' }).catch((e) =>
                            console.error('[Stripe] trackPremiumConversion:', e.message),
                        );
                    }
                }
            } catch (err) {
                console.error('[Stripe] Error processing checkout.session.completed:', err);
            }
        }

        if (event.type === 'customer.subscription.deleted') {
            try {
                const subscription = event.data.object;
                const customer = await stripe.customers.retrieve(subscription.customer);
                const discordUserId = customer.metadata.discord_id;

                if (discordUserId) {
                    const revokeResult = await mongoRouter.updateUserByDiscordIdEverywhere(discordUserId, {
                        isPremium: false,
                        premiumSource: null,
                    });
                    if (revokeResult === 0) {
                        console.warn(
                            `[Stripe] WARNING: No user documents found for Discord ID ${discordUserId} during premium revocation.`,
                        );
                    } else {
                        console.log(
                            `[Stripe] Revoked Premium from user ${discordUserId} (${revokeResult} documents updated)`,
                        );
                    }

                    await mongoRouter.forEachUserDocumentByDiscordId(discordUserId, async (u) => {
                        if (u.currentCosmetics) {
                            let changed = false;
                            const premiumIds = ['premium_badge_diamond', 'premium_color_crystal'];
                            for (const [slot, itemId] of u.currentCosmetics.entries()) {
                                if (premiumIds.includes(itemId)) {
                                    u.currentCosmetics.delete(slot);
                                    changed = true;
                                }
                            }
                            if (changed) {
                                u.markModified('currentCosmetics');
                                await u.save();
                            }
                        }
                    });
                }
            } catch (err) {
                console.error('[Stripe] Error processing subscription.deleted:', err);
            }
        }

        res.json({ received: true });
    });

    app.use(express.json({ limit: '2mb' }));

    app.use((req, res, next) => {
        if (!req.path.startsWith('/api')) {
            return next();
        }
        const raw = process.env.CORS_ORIGIN || '';
        const allowedOrigins = raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        if (allowedOrigins.length === 0) {
            return next();
        }
        const requestOrigin = req.headers.origin;
        if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
            res.setHeader('Access-Control-Allow-Origin', requestOrigin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (req.method === 'OPTIONS') {
            return res.sendStatus(204);
        }
        return next();
    });

    app.get('/api/health', (req, res) => {
        const { client } = req.app.locals.playbound || {};
        const draining = isShuttingDown();
        const body = {
            status: draining ? 'shutting_down' : 'ok',
            discordReady: Boolean(client && client.isReady()),
        };
        if (draining) {
            return res.status(503).json(body);
        }
        res.json(body);
    });

    app.use('/api/auth', createAuthDiscordRouter());
    app.use('/api/me/stats', loadSessionMiddleware, createMeStatsRouter());
    app.use('/api/me/faction', loadSessionMiddleware, createMeFactionRouter());
    app.use('/api/me/achievements', loadSessionMiddleware, createMeAchievementsRouter());
    app.use('/api/me', loadSessionMiddleware, createMeRouter());
    app.use('/api/shop', loadSessionMiddleware, createShopRouter());
    app.use('/api/admin/shop', loadSessionMiddleware, createAdminShopRouter());
    app.use('/api/admin/channels', loadSessionMiddleware, createAdminChannelRouter());
    app.use('/api/admin', loadSessionMiddleware, createAdminAdjustmentsRouter());
    app.use('/api/admin', loadSessionMiddleware, createAdminPanelRouter());
    app.use('/api', createPublicApiRouter());

    return app;
}

/**
 * @param {import('express').Express} app
 * @param {number} [port]
 */
/**
 * @param {import('express').Express} app
 * @param {number} [port]
 * @returns {import('http').Server}
 */
function listenHttpServer(app, port = Number(process.env.PORT) || 3000) {
    const server = app.listen(port, () => console.log(`HTTP server (webhook + API) listening on port ${port}`));
    return server;
}

module.exports = { createHttpApp, listenHttpServer };
