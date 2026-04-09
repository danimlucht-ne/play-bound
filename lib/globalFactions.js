'use strict';

/**
 * Canonical global factions (order = slash UI, onboarding, royale roster).
 * `User.faction` and `Faction.name` must match these strings exactly.
 */
const OFFICIAL_FACTIONS = Object.freeze([
    { name: 'Phoenixes', emoji: '🔥' },
    { name: 'Unicorns', emoji: '🦄' },
    { name: 'Fireflies', emoji: '✨' },
    { name: 'Dragons', emoji: '🐉' },
    { name: 'Wolves', emoji: '🐺' },
    { name: 'Eagles', emoji: '🦅' },
]);

/** @type {readonly string[]} */
const GLOBAL_FACTION_KEYS = Object.freeze(OFFICIAL_FACTIONS.map((f) => f.name));

const CANONICAL_FACTION_EMOJI = Object.freeze(
    Object.fromEntries(OFFICIAL_FACTIONS.map((f) => [f.name, f.emoji])),
);

/**
 * All factions that appear in an auto **royale** (everyone in the pool can enroll).
 * Same as {@link GLOBAL_FACTION_KEYS} unless you split duel vs royale pools later.
 */
const ROYALE_FACTIONS = GLOBAL_FACTION_KEYS;

/** Discord slash `addChoices` rows: `{ name, value }` */
const FACTION_SLASH_CHOICES = Object.freeze(
    OFFICIAL_FACTIONS.map((f) => ({
        name: `${f.emoji} ${f.name}`.slice(0, 100),
        value: f.name,
    })),
);

/** Human-readable list for messages, e.g. "A, B, and C" */
function formatOfficialFactionListOxford() {
    const n = GLOBAL_FACTION_KEYS.length;
    if (n === 0) return '';
    if (n === 1) return `**${GLOBAL_FACTION_KEYS[0]}**`;
    if (n === 2) return `**${GLOBAL_FACTION_KEYS[0]}** and **${GLOBAL_FACTION_KEYS[1]}**`;
    const head = GLOBAL_FACTION_KEYS.slice(0, -1).map((k) => `**${k}**`);
    return `${head.join(', ')}, and **${GLOBAL_FACTION_KEYS[n - 1]}**`;
}

/** Onboarding button customId suffix → official name */
function onboardingButtonIdToFactionName(customId) {
    const prefix = 'ob_fac_';
    if (!customId.startsWith(prefix)) return null;
    const slug = customId.slice(prefix.length);
    const found = OFFICIAL_FACTIONS.find((f) => f.name.toLowerCase().replace(/\s+/g, '') === slug);
    return found ? found.name : null;
}

/** `ob_fac_phoenixes`-style id */
function onboardingButtonCustomIdForFaction(name) {
    const slug = String(name)
        .toLowerCase()
        .replace(/\s+/g, '');
    return `ob_fac_${slug}`;
}

module.exports = {
    OFFICIAL_FACTIONS,
    GLOBAL_FACTION_KEYS,
    CANONICAL_FACTION_EMOJI,
    ROYALE_FACTIONS,
    FACTION_SLASH_CHOICES,
    formatOfficialFactionListOxford,
    onboardingButtonIdToFactionName,
    onboardingButtonCustomIdForFaction,
};
