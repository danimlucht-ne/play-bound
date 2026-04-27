'use strict';

/**
 * Canonical **source** classification for score tags (platform /playgame vs hosted commands).
 * Ranked faction wars only accept platform + rankedEligible (+ social gate) tags.
 */

const { GAME_REGISTRY, PLATFORM_GAME_TAGS, mergeGameWithOverrides } = require('./gamePlatform/registry');
const { isChallengeRanked } = require('./rankedFactionWar');

function challengeGameTypesList(challenge) {
    if (Array.isArray(challenge.gameTypes) && challenge.gameTypes.length > 0) {
        return challenge.gameTypes;
    }
    return [challenge.gameType || 'all'];
}

/** @typedef {'platform'|'hosted'} GameSourceType */

/**
 * Hosted slash-command games: never credit **official ranked** faction wars.
 * @type {Record<string, { displayName: string, launchCommand: string, unrankedEligible?: boolean }>}
 */
const HOSTED_GAME_DEFS = {
    trivia: { displayName: 'Trivia', launchCommand: '/trivia' },
    triviasprint: { displayName: 'Trivia Sprint', launchCommand: '/triviasprint' },
    serverdle: { displayName: 'Serverdle', launchCommand: '/startserverdle' },
    guessthenumber: { displayName: 'Guess the Number', launchCommand: '/guessthenumber' },
    moviequotes: { displayName: 'Movie Quotes', launchCommand: '/moviequotes' },
    unscramble: { displayName: 'Unscramble', launchCommand: '/unscramble' },
    caption: { displayName: 'Caption Contest', launchCommand: '/caption' },
    namethattune: { displayName: 'Name That Tune', launchCommand: '/namethattune' },
    spellingbee: { displayName: 'Spelling Bee', launchCommand: '/spellingbee' },
    mastermind: { displayName: 'Mastermind', launchCommand: '/mastermind' },
};

const HOSTED_TAGS = new Set(Object.keys(HOSTED_GAME_DEFS));

/** Reasons surfaced to players (subset). @enum {string} */
const FactionCreditReasonCode = {
    CREDITED: 'credited',
    NO_POINTS_OR_FACTION: 'no_points_or_faction',
    NO_GAME_TAG: 'no_game_tag',
    NO_ACTIVE_CHALLENGE: 'no_active_challenge',
    TAG_NOT_IN_WAR_POOL: 'tag_not_in_war_pool',
    HOSTED_EXCLUDED_FROM_RANKED: 'hosted_excluded_from_ranked',
    NOT_RANKED_ELIGIBLE_PLATFORM: 'not_ranked_eligible_platform',
    SOCIAL_RANKED_DISABLED: 'social_ranked_disabled',
    WRONG_FACTION: 'wrong_faction',
    NOT_ENROLLED: 'not_enrolled',
};

/**
 * @param {string|null|undefined} tag
 * @param {object|null|undefined} settingsDoc GamePlatformSettings lean doc
 */
function classifyScoreTag(tag, settingsDoc) {
    const t = String(tag || '').toLowerCase();
    if (!t) return null;

    const base = GAME_REGISTRY[t];
    if (base) {
        const ov =
            settingsDoc &&
            settingsDoc.gameOverrides &&
            typeof settingsDoc.gameOverrides.get === 'function'
                ? settingsDoc.gameOverrides.get(t)
                : settingsDoc && settingsDoc.gameOverrides && settingsDoc.gameOverrides[t];
        const g = mergeGameWithOverrides(base, ov || {});
        return {
            id: g.id,
            displayName: g.displayName,
            tag: g.tag,
            sourceType: /** @type {GameSourceType} */ ('platform'),
            rankedEligible: g.rankedEligible !== false,
            unrankedEligible: true,
            category: g.category,
            launchCommand: '/playgame',
            warScoringEligible: g.warScoringEligible !== false,
        };
    }

    const h = HOSTED_GAME_DEFS[t];
    if (h) {
        return {
            id: t,
            displayName: h.displayName,
            tag: t,
            sourceType: /** @type {GameSourceType} */ ('hosted'),
            rankedEligible: false,
            unrankedEligible: h.unrankedEligible !== false,
            category: 'hosted',
            launchCommand: h.launchCommand,
            warScoringEligible: false,
        };
    }

    return null;
}

/**
 * Whether this tag may credit an **official ranked** war ledger (before challenge filter / enrollment).
 */
function tagCreditsOfficialRankedWar(tag, settingsDoc) {
    const cls = classifyScoreTag(tag, settingsDoc);
    if (!cls) return false;
    if (cls.sourceType !== 'platform') return false;
    if (cls.rankedEligible === false) return false;
    if (cls.category === 'social' && settingsDoc && !settingsDoc.socialGamesRankedAllowed) return false;
    return true;
}

/**
 * Tag matches explicit challenge list, or `all` pool rules.
 */
function tagMatchesChallengeList(challenge, gameTag, settingsDoc) {
    const types = challengeGameTypesList(challenge);
    const tag = String(gameTag).toLowerCase();
    if (types.includes('all')) {
        if (isChallengeRanked(challenge)) {
            return tagCreditsOfficialRankedWar(tag, settingsDoc);
        }
        return true;
    }
    return types.includes(tag);
}

/**
 * @returns {{ ok: boolean, reasonCode: string, userMessage: string|null, logDetail: string }}
 */
function evaluateFactionWarCreditEligibility(challenge, gameTag, settingsDoc) {
    const tag = String(gameTag || '').toLowerCase();

    if (!tagMatchesChallengeList(challenge, tag, settingsDoc)) {
        return {
            ok: false,
            reasonCode: FactionCreditReasonCode.TAG_NOT_IN_WAR_POOL,
            userMessage: 'This game is **not** in the active war’s allowed pool.',
            logDetail: `tag_not_in_pool filter=${challengeGameTypesList(challenge).join(',')}`,
        };
    }

    if (isChallengeRanked(challenge)) {
        const cls = classifyScoreTag(tag, settingsDoc);
        if (!cls || cls.sourceType === 'hosted') {
            return {
                ok: false,
                reasonCode: FactionCreditReasonCode.HOSTED_EXCLUDED_FROM_RANKED,
                userMessage:
                    '**Ranked wars** only count **official /playgame** mini-games. Hosted commands (like /trivia) never add ranked war points — they’re for casual play.',
                logDetail: 'hosted_or_unknown_ranked_reject',
            };
        }
        if (!tagCreditsOfficialRankedWar(tag, settingsDoc)) {
            const reason =
                cls.category === 'social'
                    ? FactionCreditReasonCode.SOCIAL_RANKED_DISABLED
                    : FactionCreditReasonCode.NOT_RANKED_ELIGIBLE_PLATFORM;
            const msg =
                cls.category === 'social'
                    ? 'This **social** platform game is **not** enabled for ranked wars.'
                    : `**${cls.displayName}** is **not ranked-eligible** — it won’t add points in this **official ranked** war.`;
            return {
                ok: false,
                reasonCode: reason,
                userMessage: msg,
                logDetail: `platform_not_ranked_eligible tag=${tag}`,
            };
        }
    }

    return {
        ok: true,
        reasonCode: FactionCreditReasonCode.CREDITED,
        userMessage: null,
        logDetail: 'eligible',
    };
}

/**
 * Validate game type list for **ranked** challenge creation. `all` = allowed (means all ranked-eligible platform tags at score time).
 * @param {string[]} gameTypesArr
 * @param {object|null} settingsDoc
 * @returns {string[]} human errors
 */
function validateRankedChallengeGameSelection(gameTypesArr, settingsDoc) {
    const errs = [];
    for (const t of gameTypesArr) {
        if (t === 'all') continue;
        const cls = classifyScoreTag(t, settingsDoc);
        if (!cls) {
            errs.push(`Unknown game tag **${t}**.`);
            continue;
        }
        if (cls.sourceType === 'hosted') {
            errs.push(
                `**${cls.displayName}** (${cls.launchCommand}) is a **hosted** game. **Ranked faction wars** only allow official **/playgame** platform games.`,
            );
            continue;
        }
        if (!cls.rankedEligible) {
            errs.push(`**${cls.displayName}** is **not ranked-eligible** and cannot be used in an official ranked war.`);
        }
        if (cls.category === 'social' && settingsDoc && !settingsDoc.socialGamesRankedAllowed) {
            errs.push(
                '**Social** platform games are **disabled** for ranked wars (global platform setting). Pick another game or enable social games for ranked.',
            );
        }
    }
    return errs;
}

function isHostedScoreTag(tag) {
    return HOSTED_TAGS.has(String(tag || '').toLowerCase());
}

function isPlatformScoreTag(tag) {
    return PLATFORM_GAME_TAGS.includes(String(tag || '').toLowerCase());
}

/** Short label for Discord UI */
function uiLabelForTag(tag, settingsDoc) {
    const cls = classifyScoreTag(tag, settingsDoc);
    if (!cls) return 'Unknown game';
    if (cls.sourceType === 'hosted') return `Hosted · ${cls.displayName}`;
    if (!cls.rankedEligible) return `Official · ${cls.displayName} (casual / not ranked-eligible)`;
    return `Official · ${cls.displayName} (ranked-eligible)`;
}

module.exports = {
    HOSTED_GAME_DEFS,
    HOSTED_TAGS,
    PLATFORM_GAME_TAGS,
    FactionCreditReasonCode,
    classifyScoreTag,
    tagCreditsOfficialRankedWar,
    tagMatchesChallengeList,
    evaluateFactionWarCreditEligibility,
    validateRankedChallengeGameSelection,
    isHostedScoreTag,
    isPlatformScoreTag,
    uiLabelForTag,
};
