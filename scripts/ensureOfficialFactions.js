'use strict';

/**
 * Ensures every official global faction row exists in MongoDB (idempotent).
 *
 *   node scripts/ensureOfficialFactions.js
 */

require('dotenv').config();

const mongoose = require('mongoose');
const { Faction } = require('../models');
const { OFFICIAL_FACTIONS } = require('../lib/globalFactions');

async function main() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) {
        console.error('Set MONGODB_URI or MONGO_URI');
        process.exit(1);
    }
    await mongoose.connect(uri);
    for (const f of OFFICIAL_FACTIONS) {
        const res = await Faction.updateOne(
            { name: f.name },
            {
                $setOnInsert: {
                    name: f.name,
                    emoji: f.emoji,
                    desc: `The proud ${f.name} faction.`,
                },
            },
            { upsert: true },
        );
        const action = res.upsertedCount ? 'created' : res.matchedCount ? 'exists' : 'noop';
        console.log(`${f.emoji} ${f.name}: ${action}`);
    }
    await mongoose.disconnect();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
