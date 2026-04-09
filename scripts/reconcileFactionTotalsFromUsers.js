'use strict';

/**
 * Legacy script — **Faction.totalPoints** are now **challenge-only** (see `applyEndedChallengeToGlobalTotals`).
 * Running this will **overwrite** totals with User.competitivePoints sums and **does not** match live `/factions`.
 * Prefer fixing **members** via your own aggregate or leave totals to new challenge ends.
 * Kept for emergency inspection only.
 *
 *   node scripts/reconcileFactionTotalsFromUsers.js
 */

require('dotenv').config();

const mongoose = require('mongoose');
const { Faction, User } = require('../models');
const { guildIdNotExcludedMatch } = require('../lib/publicStatsExclude');

async function main() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) {
        console.error('Set MONGODB_URI or MONGO_URI');
        process.exit(1);
    }
    await mongoose.connect(uri);
    const gEx = guildIdNotExcludedMatch();
    const totals = await User.aggregate([
        {
            $match: {
                userId: { $ne: 'SYSTEM' },
                faction: { $nin: [null, ''] },
                ...gEx,
            },
        },
        {
            $group: {
                _id: '$faction',
                totalPoints: { $sum: '$competitivePoints' },
                members: { $sum: 1 },
            },
        },
    ]);
    const byName = new Map(totals.map((t) => [t._id, t]));
    const all = await Faction.find({}).select('name').lean();
    for (const f of all) {
        const t = byName.get(f.name);
        const totalPoints = Math.round(Number(t?.totalPoints || 0));
        const members = Math.round(Number(t?.members || 0));
        await Faction.updateOne({ name: f.name }, { $set: { totalPoints, members } });
        console.log(`${f.name}: members=${members} totalPoints=${totalPoints}`);
    }
    await mongoose.disconnect();
    console.log('Done.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
