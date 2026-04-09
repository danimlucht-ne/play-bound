'use strict';

const { GamePlatformDay } = require('../../models');
const { getSettings, allResolvedGames, resolveGame } = require('./configStore');
const { PLATFORM_GAME_TAGS } = require('./registry');

function utcDayString(d = new Date()) {
    return d.toISOString().slice(0, 10);
}

const FAST = new Set(['reaction', 'guess']);
const SKILL = new Set(['trivia', 'puzzle']);
const LUCK = new Set(['dice', 'cards']);
const SOCIAL = new Set(['social']);

function categoryBucket(cat) {
    if (FAST.has(cat)) return 'fast';
    if (SKILL.has(cat)) return 'skill';
    if (LUCK.has(cat)) return 'luck';
    if (SOCIAL.has(cat)) return 'social';
    if (cat === 'elimination') return 'skill';
    return 'luck';
}

/**
 * Weighted pick without replacement using rotationWeight * cooldown * freshness.
 */
function pickPool(games, settings, recentCounts, targetSize) {
    const mins = settings.categoryMins || { fast: 1, skill: 1, luck: 1, social: 0 };
    const enabled = games.filter((g) => g.enabled);
    const scoreRow = (g) => {
        const recent = recentCounts[g.tag] || 0;
        const cooldownMod = 1 / (1 + recent * 0.35);
        const w = Number(g.rotationWeight || 1) * cooldownMod;
        return { g, w };
    };

    const picked = [];
    const taken = new Set();

    function pickOne(predicate) {
        const candidates = enabled.filter((g) => !taken.has(g.tag) && predicate(g));
        if (!candidates.length) return false;
        const scored = candidates.map(scoreRow);
        const sum = scored.reduce((a, b) => a + b.w, 0);
        let r = Math.random() * sum;
        for (const s of scored) {
            r -= s.w;
            if (r <= 0) {
                picked.push(s.g.tag);
                taken.add(s.g.tag);
                return true;
            }
        }
        const last = scored[scored.length - 1];
        picked.push(last.g.tag);
        taken.add(last.g.tag);
        return true;
    }

    const need = { fast: mins.fast || 0, skill: mins.skill || 0, luck: mins.luck || 0, social: mins.social || 0 };
    for (const bucket of Object.keys(need)) {
        while (need[bucket] > 0 && picked.length < targetSize) {
            const ok = pickOne((g) => categoryBucket(g.category) === bucket);
            if (!ok) break;
            need[bucket]--;
        }
    }

    while (picked.length < targetSize) {
        const ok = pickOne(() => true);
        if (!ok) break;
    }

    return picked.slice(0, targetSize);
}

async function recentAppearanceCounts(lookbackDays = 10) {
    const rows = await GamePlatformDay.find()
        .sort({ dayUtc: -1 })
        .limit(lookbackDays)
        .select('activeTags featuredTag')
        .lean();
    const counts = {};
    for (const t of PLATFORM_GAME_TAGS) counts[t] = 0;
    for (const row of rows) {
        for (const t of row.activeTags || []) counts[t] = (counts[t] || 0) + 1;
        if (row.featuredTag) counts[row.featuredTag] = (counts[row.featuredTag] || 0) + 0.5;
    }
    return counts;
}

/**
 * @returns {Promise<{ dayUtc: string, activeTags: string[], featuredTag: string|null, fromManual: boolean }>}
 */
async function ensureRotationForDate(date = new Date()) {
    const dayUtc = utcDayString(date);
    const existing = await GamePlatformDay.findOne({ dayUtc }).lean();
    if (existing && existing.activeTags && existing.activeTags.length) {
        return {
            dayUtc,
            activeTags: existing.activeTags,
            featuredTag: existing.featuredTag || null,
            fromManual: false,
        };
    }

    const settings = await getSettings();
    const games = allResolvedGames(settings);

    if (Array.isArray(settings.manualActiveTags) && settings.manualActiveTags.length) {
        const activeTags = [...new Set(settings.manualActiveTags.map((x) => String(x).toLowerCase()))].filter((t) =>
            PLATFORM_GAME_TAGS.includes(t),
        );
        let featuredTag = settings.manualFeaturedTag || null;
        if (featuredTag && !activeTags.includes(featuredTag)) featuredTag = activeTags[0] || null;
        if (!featuredTag && settings.autoFeatured !== false) featuredTag = activeTags[0] || null;
        await GamePlatformDay.findOneAndUpdate(
            { dayUtc },
            {
                $set: {
                    activeTags,
                    featuredTag,
                    cooldownSnapshot: {},
                    computedAt: new Date(),
                },
            },
            { upsert: true },
        );
        return { dayUtc, activeTags, featuredTag, fromManual: true };
    }

    const minP = Math.max(2, Math.min(8, Number(settings.poolSizeMin) || 4));
    const maxP = Math.max(minP, Math.min(10, Number(settings.poolSizeMax) || 6));
    const targetSize = minP + Math.floor(Math.random() * (maxP - minP + 1));
    const recent = await recentAppearanceCounts(14);
    const activeTags = pickPool(games, settings, recent, targetSize);

    let featuredTag = null;
    if (settings.manualFeaturedTag && activeTags.includes(settings.manualFeaturedTag)) {
        featuredTag = settings.manualFeaturedTag;
    } else if (settings.autoFeatured !== false && activeTags.length) {
        const featuredCandidates = activeTags.filter((t) => {
            const g = resolveGame(t, settings);
            return g && g.featuredBonusEligible;
        });
        const pool = featuredCandidates.length ? featuredCandidates : activeTags;
        featuredTag = pool[Math.floor(Math.random() * pool.length)];
    }

    await GamePlatformDay.findOneAndUpdate(
        { dayUtc },
        {
            $set: {
                activeTags,
                featuredTag,
                cooldownSnapshot: recent,
                computedAt: new Date(),
            },
        },
        { upsert: true },
    );

    return { dayUtc, activeTags, featuredTag, fromManual: false };
}

async function setManualDayOverride(dayUtc, activeTags, featuredTag) {
    await GamePlatformDay.findOneAndUpdate(
        { dayUtc },
        { $set: { activeTags, featuredTag, computedAt: new Date() } },
        { upsert: true },
    );
}

module.exports = {
    utcDayString,
    ensureRotationForDate,
    setManualDayOverride,
    recentAppearanceCounts,
    categoryBucket,
};
