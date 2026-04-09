'use strict';

const { logOpsEvent } = require('./opsEventLog');

let shuttingDown = false;
/** @type {Array<() => void | Promise<void>>} */
const shutdownHooks = [];

function isShuttingDown() {
    return shuttingDown;
}

/**
 * Register cleanup (e.g. clearTimeout on scheduled games). Runs before HTTP close and client.destroy.
 * @param {() => void | Promise<void>} fn
 */
function registerShutdownHook(fn) {
    shutdownHooks.push(fn);
}

function getShuttingDownUserMessage() {
    const m = process.env.PLAYBOUND_SHUTDOWN_USER_MESSAGE || process.env.PLAYBOUND_SHUTDOWN_MESSAGE;
    if (m != null && String(m).trim() !== '') {
        return String(m).trim();
    }
    return '⏳ The bot is restarting. Please try again in a few seconds.';
}

async function runShutdownHooks() {
    for (const fn of shutdownHooks) {
        try {
            await fn();
        } catch (e) {
            console.error('[Lifecycle] shutdown hook failed:', e?.message || e);
        }
    }
}

/**
 * @param {string} signal
 * @param {{ client: import('discord.js').Client|null, httpServer: import('http').Server|null, drainMs?: number }} opts
 */
async function gracefulShutdown(signal, opts) {
    const client = opts.client;
    const httpServer = opts.httpServer;
    const drainMs = opts.drainMs ?? Math.max(3000, Number(process.env.PLAYBOUND_SHUTDOWN_DRAIN_MS) || 15000);

    if (shuttingDown) {
        return;
    }
    shuttingDown = true;

    console.log(`[Lifecycle] ${signal} — graceful shutdown (drain ≤ ${drainMs}ms)`);
    logOpsEvent('shutdown', { phase: 'start', signal, drainMs });

    try {
        if (client?.isReady?.() && client.user) {
            client.user.setPresence({
                activities: [{ name: 'Restarting…', type: 3 }],
                status: 'idle',
            });
        }
    } catch (_) {
        /* ignore */
    }

    const forceTimer = setTimeout(() => {
        console.error('[Lifecycle] drain timeout — exiting');
        logOpsEvent('shutdown', { phase: 'timeout', signal });
        process.exit(1);
    }, drainMs);

    await runShutdownHooks();

    if (httpServer) {
        await new Promise((resolve) => {
            httpServer.close((err) => {
                if (err) {
                    console.error('[Lifecycle] httpServer.close:', err.message || err);
                }
                resolve();
            });
        });
    }

    try {
        if (client) {
            await client.destroy();
        }
    } catch (e) {
        console.error('[Lifecycle] client.destroy:', e?.message || e);
    }

    clearTimeout(forceTimer);
    logOpsEvent('shutdown', { phase: 'complete', signal });
    console.log('[Lifecycle] clean exit');
    process.exit(0);
}

/**
 * @param {{ client: import('discord.js').Client|null, httpServer: import('http').Server|null }} ctx
 */
function installSignalHandlers(ctx) {
    const run = (sig) => {
        gracefulShutdown(sig, ctx).catch((e) => {
            console.error('[Lifecycle] gracefulShutdown error:', e);
            process.exit(1);
        });
    };
    process.on('SIGINT', () => run('SIGINT'));
    process.on('SIGTERM', () => run('SIGTERM'));
}

module.exports = {
    isShuttingDown,
    registerShutdownHook,
    getShuttingDownUserMessage,
    gracefulShutdown,
    installSignalHandlers,
};
