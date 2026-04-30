'use strict';

/**
 * Send a test event. From repo root: npm run sentry:ping
 */
require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || '.env' });

if (process.env.NODE_ENV === 'test') {
    process.env.NODE_ENV = 'development';
}

const { Sentry, sentryEnabled, getSentryRelease } = require('../lib/instrument');

if (!Sentry) {
    console.error('@sentry/node did not load. Run: npm install');
    process.exit(1);
}
if (!sentryEnabled) {
    console.error('Sentry is not enabled. Set SENTRY_DSN in .env and ensure NODE_ENV is not test.');
    process.exit(1);
}

Sentry.captureMessage('PlayBound: manual ping (npm run sentry:ping)', 'info');
Sentry.flush(5000)
    .then(() => {
        console.log('Done. Check Sentry → Issues.');
        console.log('Environment:', process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development');
        console.log('Release:', getSentryRelease() || '(none)');
        process.exit(0);
    })
    .catch((e) => {
        console.error('Flush failed:', e);
        process.exit(1);
    });
