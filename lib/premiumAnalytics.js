'use strict';

const mongoRouter = require('./mongoRouter');
const {
    ALLOWED_PREMIUM_TRIGGERS,
    normalizePremiumTrigger,
} = require('../models/PremiumPromptEvent');

const THIRTY_MIN_MS = 30 * 60 * 1000;
const ATTRIBUTION_MS = 7 * 24 * 60 * 60 * 1000;
const METADATA_MAX_KEYS = 12;

function shouldShowPremiumPrompt(user) {
    if (!user || user.isPremium) return false;
    if (!user.lastPremiumPromptAt) return true;
    const now = Date.now();
    const last = new Date(user.lastPremiumPromptAt).getTime();
    return now - last > THIRTY_MIN_MS;
}

async function markPremiumPromptShown(guildId, userId) {
    const { User } = mongoRouter.getModelsForGuild(guildId);
    await User.updateOne({ guildId, userId }, { $set: { lastPremiumPromptAt: new Date() } });
}

/**
 * @param {Record<string, unknown>|null|undefined} meta
 * @returns {Record<string, string|number|boolean|null>}
 */
function sanitizeMetadata(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
    const out = {};
    for (const [k, v] of Object.entries(meta)) {
        if (Object.keys(out).length >= METADATA_MAX_KEYS) break;
        if (typeof k !== 'string' || k.length > 48) continue;
        if (v == null) {
            out[k] = null;
            continue;
        }
        if (typeof v === 'number' && Number.isFinite(v)) {
            out[k] = v;
            continue;
        }
        if (typeof v === 'boolean') {
            out[k] = v;
            continue;
        }
        if (typeof v === 'string') {
            out[k] = v.slice(0, 240);
        }
    }
    return out;
}

/**
 * @param {object} params
 * @param {string} params.userId
 * @param {string|null|undefined} [params.guildId]
 * @param {string} params.trigger
 * @param {Record<string, unknown>} [params.metadata]
 * @param {string|null|undefined} [params.sessionId]
 */
async function trackPremiumPromptShown({ userId, guildId, trigger, metadata, sessionId }) {
    const tr = normalizePremiumTrigger(trigger);
    const { PremiumPromptEvent } = mongoRouter.getModelsForGuild(guildId);
    return PremiumPromptEvent.create({
        userId: String(userId),
        guildId: guildId != null && guildId !== '' ? String(guildId) : null,
        trigger: tr,
        shownAt: new Date(),
        metadata: sanitizeMetadata(metadata),
        sessionId: sessionId != null ? String(sessionId).slice(0, 80) : null,
    });
}

/**
 * Last-touch: mark single most recent unconverted prompt within 7 days.
 * @param {object} params
 * @param {string} params.userId
 * @param {string} [params.source]
 */
async function trackPremiumConversion({ userId, source }) {
    const since = new Date(Date.now() - ATTRIBUTION_MS);
    const src = String(source || 'unknown').slice(0, 64);
    let latest = null;
    for (const models of mongoRouter.listModelBags()) {
        const doc = await models.PremiumPromptEvent.findOneAndUpdate(
            { userId: String(userId), converted: false, shownAt: { $gte: since } },
            { $set: { converted: true, convertedAt: new Date(), premiumSource: src } },
            { sort: { shownAt: -1 }, returnDocument: 'after' },
        );
        if (doc && (!latest || doc.shownAt > latest.shownAt)) {
            latest = doc;
        }
    }
    return latest;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.days]
 */
async function getPremiumConversionStats({ days = 30 } = {}) {
    const since = new Date(Date.now() - Math.max(1, days) * 86400000);
    const pipeline = [
        { $match: { shownAt: { $gte: since } } },
        {
            $group: {
                _id: '$trigger',
                views: { $sum: 1 },
                conversions: { $sum: { $cond: ['$converted', 1, 0] } },
            },
        },
        { $sort: { _id: 1 } },
    ];
    const merged = new Map();
    for (const models of mongoRouter.listModelBags()) {
        const rows = await models.PremiumPromptEvent.aggregate(pipeline);
        for (const r of rows) {
            const prev = merged.get(r._id) || { views: 0, conversions: 0 };
            merged.set(r._id, {
                views: prev.views + (r.views || 0),
                conversions: prev.conversions + (r.conversions || 0),
            });
        }
    }
    const rows = [...merged.entries()].map(([_id, v]) => ({ _id, ...v })).sort((a, b) => String(a._id).localeCompare(String(b._id)));

    let totalViews = 0;
    let totalConversions = 0;
    const byTrigger = rows.map((r) => {
        const views = r.views || 0;
        const conversions = r.conversions || 0;
        totalViews += views;
        totalConversions += conversions;
        return {
            trigger: r._id,
            views,
            conversions,
            conversionRate: views > 0 ? conversions / views : 0,
        };
    });

    return {
        since,
        days,
        byTrigger,
        totals: {
            views: totalViews,
            conversions: totalConversions,
            conversionRate: totalViews > 0 ? totalConversions / totalViews : 0,
        },
    };
}

/**
 * @param {object} opts
 * @param {string} opts.trigger
 * @param {number} [opts.days]
 */
async function getPremiumConversionStatsForTrigger({ trigger, days = 30 }) {
    const tr = normalizePremiumTrigger(trigger);
    const since = new Date(Date.now() - Math.max(1, days) * 86400000);
    const base = { shownAt: { $gte: since }, trigger: tr };

    let views = 0;
    let conversions = 0;
    let lastShownAt = null;
    let lastConvertedAt = null;
    for (const models of mongoRouter.listModelBags()) {
        const [v, c, lastShown, lastConv] = await Promise.all([
            models.PremiumPromptEvent.countDocuments(base),
            models.PremiumPromptEvent.countDocuments({ ...base, converted: true }),
            models.PremiumPromptEvent.findOne(base).sort({ shownAt: -1 }).select('shownAt').lean(),
            models.PremiumPromptEvent.findOne({ ...base, converted: true }).sort({ convertedAt: -1 }).select('convertedAt').lean(),
        ]);
        views += v;
        conversions += c;
        if (lastShown?.shownAt && (!lastShownAt || lastShown.shownAt > lastShownAt)) {
            lastShownAt = lastShown.shownAt;
        }
        if (lastConv?.convertedAt && (!lastConvertedAt || lastConv.convertedAt > lastConvertedAt)) {
            lastConvertedAt = lastConv.convertedAt;
        }
    }

    return {
        trigger: tr,
        views,
        conversions,
        conversionRate: views > 0 ? conversions / views : 0,
        lastShownAt,
        lastConvertedAt,
    };
}

/**
 * @param {number} [days]
 */
async function getPremiumPeriodComparison(days = 7) {
    const now = Date.now();
    const ms = Math.max(1, days) * 86400000;
    const curStart = new Date(now - ms);
    const prevStart = new Date(now - 2 * ms);
    const prevEnd = curStart;

    const pipeline = (start, end) => [
        { $match: { shownAt: { $gte: start, $lt: end } } },
        {
            $group: {
                _id: null,
                views: { $sum: 1 },
                conversions: { $sum: { $cond: ['$converted', 1, 0] } },
            },
        },
    ];

    let c = { views: 0, conversions: 0 };
    let p = { views: 0, conversions: 0 };
    for (const models of mongoRouter.listModelBags()) {
        const [curPart, prevPart] = await Promise.all([
            models.PremiumPromptEvent.aggregate(pipeline(curStart, new Date(now))),
            models.PremiumPromptEvent.aggregate(pipeline(prevStart, prevEnd)),
        ]);
        const cRow = curPart[0] || { views: 0, conversions: 0 };
        const pRow = prevPart[0] || { views: 0, conversions: 0 };
        c.views += cRow.views;
        c.conversions += cRow.conversions;
        p.views += pRow.views;
        p.conversions += pRow.conversions;
    }
    return {
        current: {
            views: c.views,
            conversions: c.conversions,
            rate: c.views > 0 ? c.conversions / c.views : 0,
        },
        previous: {
            views: p.views,
            conversions: p.conversions,
            rate: p.views > 0 ? p.conversions / p.views : 0,
        },
    };
}

module.exports = {
    ALLOWED_PREMIUM_TRIGGERS,
    normalizePremiumTrigger,
    shouldShowPremiumPrompt,
    markPremiumPromptShown,
    trackPremiumPromptShown,
    trackPremiumConversion,
    getPremiumConversionStats,
    getPremiumConversionStatsForTrigger,
    getPremiumPeriodComparison,
    THIRTY_MIN_MS,
    ATTRIBUTION_MS,
};
