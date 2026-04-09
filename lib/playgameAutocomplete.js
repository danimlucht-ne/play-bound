'use strict';

const { ensureRotationForDate } = require('./gamePlatform/rotation');
const { getSettings, resolveGame } = require('./gamePlatform/configStore');
const { GAME_REGISTRY, PLATFORM_GAME_TAGS } = require('./gamePlatform/registry');
const { isBotDeveloper } = require('./isBotDeveloper');

/**
 * @param {string} focusedValue
 * @param {string} userId
 * @returns {Promise<{ name: string, value: string }[]>}
 */
async function playgameAutocompleteChoices(focusedValue, userId) {
    const rot = await ensureRotationForDate();
    const settings = await getSettings();
    const devExtras = process.env.PLAYBOUND_REGISTER_DEV_SLASH_OPTIONS === '1' && isBotDeveloper(userId);
    /** @type {Set<string>} */
    const pool = new Set();
    if (devExtras) {
        for (const t of PLATFORM_GAME_TAGS) {
            const def = resolveGame(t, settings);
            if (def && def.enabled) pool.add(t);
        }
    } else {
        for (const t of rot.activeTags || []) {
            const def = resolveGame(t, settings);
            if (def && def.enabled) pool.add(t);
        }
    }
    const q = String(focusedValue || '').toLowerCase().trim();
    const rows = [...pool]
        .map((t) => {
            const dn = GAME_REGISTRY[t]?.displayName || t;
            const label = devExtras ? `${dn} (${t})` : `${dn} — today’s rotation`;
            return {
                name: label.slice(0, 100),
                value: t,
            };
        })
        .filter((row) => !q || row.value.toLowerCase().includes(q) || row.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 25);
    if (rows.length) return rows;
    return [{ name: 'No matching games in today’s pool', value: '__none__' }];
}

module.exports = { playgameAutocompleteChoices };
