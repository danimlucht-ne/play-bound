'use strict';

const { GamePlatformDailyStats } = require('../../models');
const { utcDayString } = require('./rotation');

async function bumpStat(dayUtc, tag, field, delta = 1) {
    const t = String(tag || '').toLowerCase();
    const d = dayUtc || utcDayString();
    const path = `byTag.${t}.${field}`;
    await GamePlatformDailyStats.updateOne(
        { dayUtc: d },
        { $inc: { [path]: delta }, $set: { updatedAt: new Date() }, $setOnInsert: { dayUtc: d } },
        { upsert: true },
    );
}

function recordSessionStarted(tag) {
    return bumpStat(utcDayString(), tag, 'started', 1);
}

function recordSessionCompleted(tag, factionBaseSum, casualTotalDelta) {
    const d = utcDayString();
    const t = String(tag || '').toLowerCase();
    return GamePlatformDailyStats.findOneAndUpdate(
        { dayUtc: d },
        {
            $setOnInsert: { dayUtc: d },
            $inc: {
                [`byTag.${t}.completed`]: 1,
                [`byTag.${t}.sumFactionBase`]: Math.round(Number(factionBaseSum) || 0),
                [`byTag.${t}.sumCasualTotal`]: Math.round(Number(casualTotalDelta) || 0),
            },
            $set: { updatedAt: new Date() },
        },
        { upsert: true },
    );
}

function recordSessionAbandoned(tag) {
    return bumpStat(utcDayString(), tag, 'abandoned', 1);
}

async function getAnalyticsRange(days = 14) {
    const rows = await GamePlatformDailyStats.find()
        .sort({ dayUtc: -1 })
        .limit(Math.max(1, Math.min(90, days)))
        .lean();
    return rows;
}

module.exports = {
    recordSessionStarted,
    recordSessionCompleted,
    recordSessionAbandoned,
    getAnalyticsRange,
    bumpStat,
};
