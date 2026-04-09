'use strict';

const { Faction } = require('../models');
const { formatFactionDualLabel, getFactionDisplayEmoji } = require('./factionGuild');
const { ROYALE_FACTIONS } = require('./factionChallenge');
const { CANONICAL_FACTION_EMOJI } = require('./factionKeys');

/**
 * Rich matchup line for announce embeds (local display names + emojis).
 * @param {import('../models').SystemConfig} config
 * @param {{ isRoyale: boolean, factionA: string, factionB: string, battleFactions?: string[] }} p
 */
async function formatFactionWarMatchupLine(config, p) {
    async function label(name) {
        const doc = await Faction.findOne({ name }).select('emoji').lean();
        const em = getFactionDisplayEmoji(name, config, doc?.emoji || CANONICAL_FACTION_EMOJI[name] || '⚔️');
        const dual = formatFactionDualLabel(name, config);
        return `${em} **${dual}**`;
    }

    if (p.isRoyale) {
        const names =
            Array.isArray(p.battleFactions) && p.battleFactions.length > 0 ? p.battleFactions : [...ROYALE_FACTIONS];
        const parts = await Promise.all(names.map((n) => label(n)));
        const nWay = names.length;
        return `${parts.join(' vs ')} — ${nWay}-way royale!`;
    }
    const left = await label(p.factionA);
    const right = await label(p.factionB);
    return `${left} has challenged ${right}!`;
}

module.exports = { formatFactionWarMatchupLine };
