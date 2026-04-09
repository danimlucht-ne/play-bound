'use strict';

const mongoRouter = require('./mongoRouter');

const LEGAL_POLICY_DOC_ID = 'global';
const CACHE_MS = Number(process.env.PLAYBOUND_LEGAL_VERSION_CACHE_MS) || 5000;

/** @type {{ at: number, terms: string, privacy: string, fromDb: boolean }} */
let cache = { at: 0, terms: '', privacy: '', fromDb: false };

function constantsFallback() {
    const c = require('../src/bot/constants');
    return {
        termsVersion: String(c.CURRENT_TERMS_VERSION).trim(),
        privacyVersion: String(c.CURRENT_PRIVACY_VERSION).trim(),
    };
}

/**
 * @returns {Promise<{ termsVersion: string, privacyVersion: string, source: 'database' | 'constants' }>}
 */
async function getEffectiveLegalVersions() {
    const now = Date.now();
    if (now - cache.at < CACHE_MS && cache.terms && cache.privacy) {
        return {
            termsVersion: cache.terms,
            privacyVersion: cache.privacy,
            source: cache.fromDb ? 'database' : 'constants',
        };
    }

    mongoRouter.ensureLazyScriptConnection();
    const { LegalPolicyConfig } = mongoRouter.getModelsProd();
    const doc = await LegalPolicyConfig.findById(LEGAL_POLICY_DOC_ID).lean();
    const fb = constantsFallback();
    let terms = fb.termsVersion;
    let privacy = fb.privacyVersion;
    let fromDb = false;
    if (doc && String(doc.termsVersion || '').trim() && String(doc.privacyVersion || '').trim()) {
        terms = String(doc.termsVersion).trim();
        privacy = String(doc.privacyVersion).trim();
        fromDb = true;
    }
    cache = { at: now, terms, privacy, fromDb };
    return { termsVersion: terms, privacyVersion: privacy, source: fromDb ? 'database' : 'constants' };
}

function invalidateLegalVersionCache() {
    cache.at = 0;
}

/**
 * Admin UI: effective versions plus DB row (if any) and code defaults.
 */
async function getLegalPolicyAdminSnapshot() {
    mongoRouter.ensureLazyScriptConnection();
    const { LegalPolicyConfig } = mongoRouter.getModelsProd();
    const [doc, effective] = await Promise.all([
        LegalPolicyConfig.findById(LEGAL_POLICY_DOC_ID).lean(),
        getEffectiveLegalVersions(),
    ]);
    const constants = constantsFallback();
    return {
        effective,
        constants,
        database:
            doc && String(doc.termsVersion || '').trim() && String(doc.privacyVersion || '').trim()
                ? {
                      termsVersion: String(doc.termsVersion).trim(),
                      privacyVersion: String(doc.privacyVersion).trim(),
                      updatedAt: doc.updatedAt || null,
                      updatedByDiscordUserId: doc.updatedByDiscordUserId || null,
                  }
                : null,
    };
}

module.exports = {
    LEGAL_POLICY_DOC_ID,
    getEffectiveLegalVersions,
    invalidateLegalVersionCache,
    getLegalPolicyAdminSnapshot,
};
