'use strict';

const mongoose = require('mongoose');

/** @type {const} */
const ALLOWED_PREMIUM_TRIGGERS = [
    'game_end',
    'daily',
    'game_start_host',
    'streak',
    'session_boost_reminder',
    'premium_command',
    'other',
];

const PremiumPromptEventSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    guildId: { type: String, default: null, index: true },
    trigger: {
        type: String,
        required: true,
        enum: [...ALLOWED_PREMIUM_TRIGGERS],
        index: true,
    },
    shownAt: { type: Date, required: true, default: Date.now, index: true },
    converted: { type: Boolean, default: false, index: true },
    convertedAt: { type: Date, default: null },
    /** Source that completed conversion (stripe, admin, discord, …) */
    premiumSource: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    sessionId: { type: String, default: null },
});

PremiumPromptEventSchema.index({ userId: 1, converted: 1, shownAt: -1 });
PremiumPromptEventSchema.index({ trigger: 1, shownAt: -1 });

function normalizePremiumTrigger(trigger) {
    const t = String(trigger || '').trim();
    if (ALLOWED_PREMIUM_TRIGGERS.includes(t)) return t;
    return 'other';
}

module.exports = {
    PremiumPromptEventSchema,
    ALLOWED_PREMIUM_TRIGGERS,
    normalizePremiumTrigger,
};
