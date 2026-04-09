'use strict';

/**
 * Guild ids omitted from **global** aggregates: marketing API, `/factions`, challenge-derived `Faction.totalPoints`,
 * referral leaderboards, etc. Comma-separated in `PUBLIC_STATS_EXCLUDE_GUILD_IDS`.
 * Per-server leaderboards and in-guild play are unchanged. Personal `/api/me/*` routes do **not**
 * use this filter so the web dashboard matches per-guild Discord commands like `/profile`.
 */
function getExcludedGuildIds() {
    const raw = process.env.PUBLIC_STATS_EXCLUDE_GUILD_IDS || '';
    return raw
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
}

/** Stable fragment for cache keys when exclusions change. */
function publicStatsCacheKeySuffix() {
    const ex = getExcludedGuildIds();
    if (ex.length === 0) return '';
    return `:ex=${ex.slice().sort().join('|')}`;
}

/**
 * @returns {Record<string, unknown>} Mongo match fragment for `guildId` (empty object if no exclusions).
 */
function guildIdNotExcludedMatch() {
    const ex = getExcludedGuildIds();
    if (ex.length === 0) return {};
    return { guildId: { $nin: ex } };
}

/** @param {string|null|undefined} guildId */
function isGuildExcludedFromGlobalCounts(guildId) {
    if (guildId == null || guildId === '') return false;
    const ex = getExcludedGuildIds();
    return ex.includes(String(guildId));
}

module.exports = {
    getExcludedGuildIds,
    publicStatsCacheKeySuffix,
    guildIdNotExcludedMatch,
    isGuildExcludedFromGlobalCounts,
};
