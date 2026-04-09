'use strict';

/**
 * Personal Credits granted when a faction challenge **ends**, per participant on each team,
 * ranked by raw war contribution within that team. In-war `/playgame` does **not** grant shop Credits
 * (only faction ledger); these payouts are flat (no streak / premium / pass).
 */

const { FactionChallenge } = require('../models');
const { addScore } = require('./db');
const { teamNames, getParticipantIds, getRawScoreByUser } = require('./factionChallenge');
const { computeFactionWarEndPersonalCredits } = require('./factionWarEconomyConstants');

/**
 * One-time per ended challenge: grant flat personal Credits to each enrolled player (per-faction ladder).
 * @param {import('discord.js').Client|null} client
 * @param {string} guildId
 * @param {import('mongoose').Types.ObjectId|string} challengeId
 */
async function grantWarEndPersonalCredits(client, guildId, challengeId) {
    const claim = await FactionChallenge.updateOne(
        { _id: challengeId, status: 'ended', warEconomyPayoutApplied: { $ne: true } },
        { $set: { warEconomyPayoutApplied: true } },
    );
    if (!claim.modifiedCount) return;

    const ch = await FactionChallenge.findById(challengeId).exec();
    if (!ch || ch.status !== 'ended') return;

    try {
        const names = teamNames(ch);
        for (const factionName of names) {
            const ids = getParticipantIds(ch, factionName);
            if (!ids.length) continue;

            const rows = ids.map((userId) => ({
                userId,
                score: getRawScoreByUser(ch, userId),
            }));
            rows.sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                return String(a.userId).localeCompare(String(b.userId));
            });

            for (let rank = 0; rank < rows.length; rank++) {
                const { userId } = rows[rank];
                const credits = computeFactionWarEndPersonalCredits(rank);
                if (credits <= 0) continue;
                await addScore(client, guildId, userId, credits, null, false, null, {
                    flatEconomyGrant: true,
                    flatEconomyLedgerLabel: 'faction_war_end',
                });
            }
        }
    } catch (err) {
        await FactionChallenge.updateOne({ _id: challengeId }, { $set: { warEconomyPayoutApplied: false } }).catch(
            () => {},
        );
        throw err;
    }
}

module.exports = {
    ...require('./factionWarEconomyConstants'),
    grantWarEndPersonalCredits,
};
