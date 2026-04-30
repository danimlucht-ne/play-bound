'use strict';

/**
 * Load after dotenv in index.js. Express error handler is registered in src/server/webhook.js.
 *
 * PlayBound uses Express 5; @opentelemetry/instrumentation-express only supports express@4 (see
 * instrumentation range `>=4.0.0 <5`). We use httpIntegration for request tracing and keep
 * setupExpressErrorHandler for errors. disableInstrumentationWarnings avoids a spurious
 * "express is not instrumented" message from setupExpressErrorHandler's ensureIsWrapped check.
 */
let Sentry;
try {
    Sentry = require('@sentry/node');
} catch (e) {
    console.error('[Sentry] @sentry/node is not installed. From repo root run: npm install', e && e.message);
}

let nodeProfilingIntegration;
try {
    if (Sentry) {
        ({ nodeProfilingIntegration } = require('@sentry/profiling-node'));
    }
} catch (e) {
    console.warn('[Sentry] @sentry/profiling-node unavailable; profiling disabled.', e && e.message);
}

function clamp01(n) {
    if (Number.isNaN(n) || n < 0) return 0;
    if (n > 1) return 1;
    return n;
}

function sampleRateFromEnv(key, whenUnsetProd, whenUnsetDev) {
    const raw = process.env[key];
    const isProd = process.env.NODE_ENV === 'production';
    if (raw === undefined || String(raw).trim() === '') {
        return isProd ? whenUnsetProd : whenUnsetDev;
    }
    return clamp01(parseFloat(String(raw), 10));
}

function sendDefaultPii() {
    const v = process.env.SENTRY_SEND_DEFAULT_PII;
    if (v === undefined || v === '') {
        return process.env.NODE_ENV !== 'production';
    }
    return v === '1' || String(v).toLowerCase() === 'true';
}

function sentryRelease() {
    const explicit = process.env.SENTRY_RELEASE && String(process.env.SENTRY_RELEASE).trim();
    if (explicit) return explicit;
    const fromCi =
        process.env.GIT_COMMIT_SHA ||
        process.env.VERCEL_GIT_COMMIT_SHA ||
        process.env.RENDER_GIT_COMMIT ||
        process.env.HEROKU_SLUG_COMMIT ||
        process.env.COMMIT_REF ||
        process.env.GITHUB_SHA;
    if (fromCi && String(fromCi).trim()) return String(fromCi).trim();
    try {
        const { version, name } = require('../package.json');
        if (version) return `${name || 'playbound'}@${version}`;
    } catch (_) {
        /* ignore */
    }
    return undefined;
}

let sentryEnabled = false;
if (Sentry && process.env.SENTRY_DSN && process.env.NODE_ENV !== 'test') {
    const traces = sampleRateFromEnv('SENTRY_TRACES_SAMPLE_RATE', 0.05, 0.15);
    let profiles = sampleRateFromEnv('SENTRY_PROFILES_SAMPLE_RATE', 0.05, 0.1);
    if (traces === 0) {
        profiles = 0;
    } else {
        profiles = Math.min(profiles, traces);
    }

    const integrations = [Sentry.httpIntegration()];
    if (typeof nodeProfilingIntegration === 'function') {
        integrations.push(nodeProfilingIntegration());
    }

    const release = sentryRelease();
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
        ...(release ? { release } : {}),
        sendDefaultPii: sendDefaultPii(),
        disableInstrumentationWarnings: true,
        integrations,
        tracesSampleRate: traces,
        profilesSampleRate: typeof nodeProfilingIntegration === 'function' ? profiles : 0,
    });
    sentryEnabled = true;
}

module.exports = { Sentry, sentryEnabled, getSentryRelease: sentryRelease };
