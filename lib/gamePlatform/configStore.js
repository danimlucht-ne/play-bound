'use strict';

const { GamePlatformSettings } = require('../../models');
const { GAME_REGISTRY, mergeGameWithOverrides, PLATFORM_GAME_TAGS } = require('./registry');

async function getSettings() {
    let doc = await GamePlatformSettings.findById('global').lean();
    if (!doc) {
        try {
            await GamePlatformSettings.create({ _id: 'global' });
        } catch (e) {
            if (e.code !== 11000) throw e;
        }
        doc = await GamePlatformSettings.findById('global').lean();
    }
    return doc;
}

async function updateSettings(mutator) {
    let doc = await GamePlatformSettings.findById('global');
    if (!doc) {
        doc = await GamePlatformSettings.create({ _id: 'global' });
    }
    await mutator(doc);
    doc.updatedAt = new Date();
    await doc.save();
    return doc.toObject();
}

/** Resolved catalog entry for one tag (registry + DB overrides). */
function resolveGame(tag, settingsDoc) {
    const t = String(tag || '').toLowerCase();
    const base = GAME_REGISTRY[t];
    if (!base) return null;
    const ov =
        settingsDoc &&
        settingsDoc.gameOverrides &&
        typeof settingsDoc.gameOverrides.get === 'function'
            ? settingsDoc.gameOverrides.get(t)
            : settingsDoc && settingsDoc.gameOverrides && settingsDoc.gameOverrides[t];
    return mergeGameWithOverrides(base, ov || {});
}

function allResolvedGames(settingsDoc) {
    return PLATFORM_GAME_TAGS.map((t) => resolveGame(t, settingsDoc)).filter(Boolean);
}

module.exports = {
    getSettings,
    updateSettings,
    resolveGame,
    allResolvedGames,
};
