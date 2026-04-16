'use strict';

function dayUtcSeed(dayUtc) {
    let h = 0;
    const s = String(dayUtc || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h >>> 0;
}

function seededPickIndices(len, seed, pickCount) {
    const idx = [...Array(len).keys()];
    let s = seed >>> 0;
    for (let i = idx.length - 1; i > 0; i--) {
        s = (s * 1103515245 + 12345) >>> 0;
        const j = s % (i + 1);
        [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx.slice(0, Math.min(pickCount, len)).sort((a, b) => a - b);
}

/**
 * @param {string} dayUtc
 * @param {string[]} activeTags
 * @param {(tag: string) => object|null} resolveGame — registry + overrides merged
 */
function pickRankedFeaturedTags(dayUtc, activeTags, resolveGame) {
    const candidates = [...new Set((activeTags || []).map((t) => String(t).toLowerCase()))]
        .filter((t) => {
            const g = resolveGame(t);
            return g && g.enabled !== false && g.featuredEligible && g.rankedEligible;
        })
        .sort();
    if (candidates.length === 0) return [];
    const seed = dayUtcSeed(dayUtc);
    const pickCount = Math.min(2, candidates.length);
    const indices = seededPickIndices(candidates.length, seed, pickCount);
    return indices.map((i) => candidates[i]);
}

module.exports = {
    dayUtcSeed,
    seededPickIndices,
    pickRankedFeaturedTags,
};
