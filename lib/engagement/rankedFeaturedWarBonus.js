'use strict';

/**
 * Optional **ranked** war modifier: small capped bonus when the tag matches **today’s** `rankedFeaturedTags`.
 * Applied only to the integer passed as faction war **base** (never streak / premium / aura / consumables).
 * @param {{ basePoints: number, gameTag: string, rankedFeaturedTags?: string[]|null, bonusCap?: number }} p
 */
function computeRankedFeaturedWarBonus(p) {
    const tag = String(p.gameTag || '').toLowerCase();
    const tags = (p.rankedFeaturedTags || []).map((t) => String(t).toLowerCase());
    if (!tags.includes(tag)) return { bonus: 0 };
    const cap = Math.max(0, Math.min(20, Math.floor(Number(p.bonusCap) ?? 3)));
    const b = Math.max(0, Math.floor(Number(p.basePoints) || 0));
    const pct = 0.1;
    const raw = Math.floor(b * pct);
    const bonus = Math.min(cap, raw);
    return { bonus, pct, cap };
}

module.exports = { computeRankedFeaturedWarBonus };
