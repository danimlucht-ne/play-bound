'use strict';

const { MissionDefinition, MissionProgress, User, EngagementProfile } = require('../../models');
const { resolveGame } = require('../gamePlatform/configStore');
const { playboundDebugLog } = require('../playboundDebug');
const { tagCountsForMission } = require('./missionGates');

const DEFAULT_MISSIONS = [
    {
        missionKey: 'ud_play_2',
        scope: 'user_daily',
        title: 'Play 2 ranked-eligible /playgame mini-games',
        objectiveType: 'plays',
        target: 2,
        rewardType: 'credits',
        rewardAmount: 12,
        allowBroaderPool: false,
    },
    {
        missionKey: 'ud_win_1',
        scope: 'user_daily',
        title: 'Win a ranked-eligible platform session',
        objectiveType: 'wins',
        target: 1,
        rewardType: 'season_xp',
        rewardAmount: 20,
        allowBroaderPool: false,
    },
    {
        missionKey: 'ud_base_40',
        scope: 'user_daily',
        title: 'Earn 40 base points (ranked-eligible platform)',
        objectiveType: 'basePoints',
        target: 40,
        rewardType: 'cosmetic_currency',
        rewardAmount: 3,
        allowBroaderPool: false,
    },
    {
        missionKey: 'ud_variety_2',
        scope: 'user_daily',
        title: 'Play 2 different ranked-eligible tags today',
        objectiveType: 'playVariety',
        target: 2,
        rewardType: 'season_xp',
        rewardAmount: 15,
        allowBroaderPool: false,
    },
    {
        missionKey: 'ud_duel_win_1',
        scope: 'user_daily',
        title: 'Win a /duel trivia match',
        objectiveType: 'duelWins',
        target: 1,
        rewardType: 'credits',
        rewardAmount: 10,
        allowBroaderPool: false,
    },
    {
        missionKey: 'fd_play_12',
        scope: 'faction_daily',
        title: 'Faction crew: 12 ranked platform plays (UTC day)',
        objectiveType: 'plays',
        target: 12,
        rewardType: 'season_xp',
        rewardAmount: 35,
        allowBroaderPool: false,
    },
    {
        missionKey: 'fw_play_60',
        scope: 'faction_weekly',
        title: 'Faction crew: 60 ranked platform plays (UTC week)',
        objectiveType: 'plays',
        target: 60,
        rewardType: 'credits',
        rewardAmount: 80,
        allowBroaderPool: false,
    },
];

function utcDayKey(d = new Date()) {
    return d.toISOString().slice(0, 10);
}

function utcWeekKey(d = new Date()) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dow = x.getUTCDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    x.setUTCDate(x.getUTCDate() + mondayOffset);
    const jan1 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
    const days = Math.floor((x - jan1) / 86400000);
    const week = Math.floor(days / 7) + 1;
    return `${x.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function periodKeyForScope(scope, now = new Date()) {
    if (scope === 'faction_weekly') return utcWeekKey(now);
    return utcDayKey(now);
}

let syncPromise;
async function ensureMissionDefinitionsSynced() {
    if (!syncPromise) {
        syncPromise = (async () => {
            for (const d of DEFAULT_MISSIONS) {
                await MissionDefinition.findOneAndUpdate({ missionKey: d.missionKey }, { $set: d }, { upsert: true });
            }
        })();
    }
    await syncPromise;
}

async function upsertMissionProgress(filter, def, patch) {
    await MissionProgress.findOneAndUpdate(
        filter,
        {
            $set: {
                ...patch,
                target: def.target,
                missionKey: def.missionKey,
                scope: def.scope,
            },
            $setOnInsert: {
                guildId: filter.guildId,
                userId: filter.userId,
                factionName: filter.factionName,
                periodKey: filter.periodKey,
                progress: 0,
                completed: false,
                claimed: false,
                claimedByUserIds: [],
            },
        },
        { upsert: true },
    );
}

async function applyMissionIncrement(filter, def, gameTag, event) {
    const doc = await MissionProgress.findOne(filter);
    let progress = doc?.progress || 0;
    let metaJson = doc?.metaJson || null;

    if (def.objectiveType === 'playVariety') {
        let tags = [];
        try {
            tags = metaJson ? JSON.parse(metaJson) : [];
        } catch {
            tags = [];
        }
        if (!Array.isArray(tags)) tags = [];
        const t = String(gameTag).toLowerCase();
        if (event.kind === 'play' || event.kind === 'win') {
            if (!tags.includes(t)) tags.push(t);
        }
        metaJson = JSON.stringify(tags);
        progress = tags.length;
    } else if (def.objectiveType === 'basePoints') {
        progress += Math.max(0, Math.floor(Number(event.basePoints) || 0));
    } else if (def.objectiveType === 'plays') {
        if (event.kind === 'play' || event.kind === 'win') progress += 1;
    } else if (def.objectiveType === 'wins') {
        if (event.kind === 'win') progress += 1;
    }

    const completed = progress >= def.target;
    await upsertMissionProgress(filter, def, { progress, completed, metaJson });
}

/**
 * @param {object} p
 * @param {string} p.guildId
 * @param {string} p.userId
 * @param {string|null} p.factionName
 * @param {string} p.gameTag
 * @param {object} p.settingsDoc
 * @param {{ kind: 'play'|'win', basePoints?: number }} p.event
 */
async function onPlatformMissionHook(p) {
    const { guildId, userId, factionName, gameTag, settingsDoc, event } = p;
    if (!guildId || !userId || !gameTag) return;
    await ensureMissionDefinitionsSynced();
    const gameDef = resolveGame(gameTag, settingsDoc);
    const defs = await MissionDefinition.find({ objectiveType: { $ne: 'duelWins' } }).lean();

    for (const def of defs) {
        if (!tagCountsForMission(def, gameDef)) continue;

        if (def.objectiveType === 'wins' && event.kind !== 'win') continue;
        if (def.objectiveType === 'plays' && event.kind !== 'play' && event.kind !== 'win') continue;
        if (def.objectiveType === 'basePoints' && event.kind !== 'play' && event.kind !== 'win') continue;
        if (def.objectiveType === 'playVariety' && event.kind !== 'play' && event.kind !== 'win') continue;

        const periodKey = periodKeyForScope(def.scope, new Date());

        if (def.scope === 'user_daily') {
            const filter = { scope: def.scope, guildId, userId, factionName: null, periodKey, missionKey: def.missionKey };
            await applyMissionIncrement(filter, def, gameTag, event);
        } else if (factionName && (def.scope === 'faction_daily' || def.scope === 'faction_weekly')) {
            const filter = {
                scope: def.scope,
                guildId,
                userId: null,
                factionName,
                periodKey,
                missionKey: def.missionKey,
            };
            await applyMissionIncrement(filter, def, gameTag, event);
        }
    }
}

/**
 * @param {object} p
 * @param {string} p.guildId
 * @param {string} p.winnerUserId
 */
async function onDuelMissionHook(p) {
    const { guildId, winnerUserId } = p;
    if (!guildId || !winnerUserId) return;
    await ensureMissionDefinitionsSynced();
    const defs = await MissionDefinition.find({ objectiveType: 'duelWins' }).lean();
    const now = new Date();
    for (const def of defs) {
        if (def.scope !== 'user_daily') continue;
        const periodKey = periodKeyForScope(def.scope, now);
        const filter = { scope: def.scope, guildId, userId: winnerUserId, factionName: null, periodKey, missionKey: def.missionKey };
        const doc = await MissionProgress.findOne(filter);
        const progress = (doc?.progress || 0) + 1;
        const completed = progress >= def.target;
        await upsertMissionProgress(filter, def, { progress, completed, metaJson: doc?.metaJson || null });
    }
    playboundDebugLog(`[mission-duel] guild=${guildId} winner=${winnerUserId}`);
}

async function grantMissionReward(guildId, userId, def) {
    if (def.rewardType === 'credits') {
        await User.findOneAndUpdate({ guildId, userId }, { $inc: { points: def.rewardAmount } });
    } else if (def.rewardType === 'season_xp') {
        await EngagementProfile.findOneAndUpdate(
            { guildId, userId },
            { $inc: { seasonXp: def.rewardAmount } },
            { upsert: true },
        );
    } else if (def.rewardType === 'cosmetic_currency') {
        await EngagementProfile.findOneAndUpdate(
            { guildId, userId },
            { $inc: { cosmeticCurrency: def.rewardAmount } },
            { upsert: true },
        );
    }
    playboundDebugLog(
        `[mission-claim] guild=${guildId} user=${userId} key=${def.missionKey} reward=${def.rewardType}:${def.rewardAmount}`,
    );
}

async function claimCompletedMissions(guildId, userId, factionName) {
    await ensureMissionDefinitionsSynced();
    const now = new Date();
    const day = utcDayKey(now);
    const week = utcWeekKey(now);
    const lines = [];
    let total = 0;

    const userRows = await MissionProgress.find({
        guildId,
        userId,
        scope: 'user_daily',
        periodKey: day,
        completed: true,
        claimed: false,
    }).lean();

    for (const row of userRows) {
        const def = await MissionDefinition.findOne({ missionKey: row.missionKey }).lean();
        if (!def) continue;
        await grantMissionReward(guildId, userId, def);
        await MissionProgress.updateOne({ _id: row._id }, { $set: { claimed: true } });
        total++;
        lines.push(`• **${def.title}** → **${def.rewardAmount}** ${def.rewardType.replace('_', ' ')}`);
    }

    if (factionName) {
        const facRows = await MissionProgress.find({
            guildId,
            factionName,
            userId: null,
            scope: { $in: ['faction_daily', 'faction_weekly'] },
            periodKey: { $in: [day, week] },
            completed: true,
        }).lean();

        for (const row of facRows) {
            const claimedBy = row.claimedByUserIds || [];
            if (claimedBy.includes(userId)) continue;
            const def = await MissionDefinition.findOne({ missionKey: row.missionKey }).lean();
            if (!def) continue;
            await grantMissionReward(guildId, userId, def);
            await MissionProgress.updateOne({ _id: row._id }, { $push: { claimedByUserIds: userId } });
            total++;
            lines.push(`• **${def.title}** (faction) → **${def.rewardAmount}** ${def.rewardType.replace('_', ' ')}`);
        }
    }

    return { total, lines };
}

async function listMissionBoard(guildId, userId, factionName) {
    await ensureMissionDefinitionsSynced();
    const now = new Date();
    const day = utcDayKey(now);
    const week = utcWeekKey(now);
    const defs = await MissionDefinition.find().sort({ scope: 1, missionKey: 1 }).lean();
    const lines = [];

    for (const def of defs) {
        const periodKey = periodKeyForScope(def.scope, now);
        let row = null;
        if (def.scope === 'user_daily') {
            row = await MissionProgress.findOne({
                guildId,
                userId,
                factionName: null,
                periodKey,
                missionKey: def.missionKey,
            }).lean();
        } else if (factionName && (def.scope === 'faction_daily' || def.scope === 'faction_weekly')) {
            row = await MissionProgress.findOne({
                guildId,
                userId: null,
                factionName,
                periodKey,
                missionKey: def.missionKey,
            }).lean();
        }
        const prog = row?.progress || 0;
        const done = row?.completed || false;
        const claimed =
            def.scope === 'user_daily'
                ? row?.claimed
                : row?.claimedByUserIds && row.claimedByUserIds.includes(userId);
        const status = done ? (claimed ? '✅ claimed' : '🎁 ready to claim') : `⏳ ${prog}/${def.target}`;
        lines.push(`**${def.title}** — ${status} _(+${def.rewardAmount} ${def.rewardType})_`);
    }

    return { day, week, lines };
}

async function listMissionDefinitionsLean() {
    await ensureMissionDefinitionsSynced();
    return MissionDefinition.find().sort({ scope: 1, missionKey: 1 }).lean();
}

module.exports = {
    DEFAULT_MISSIONS,
    utcDayKey,
    utcWeekKey,
    periodKeyForScope,
    ensureMissionDefinitionsSynced,
    onPlatformMissionHook,
    onDuelMissionHook,
    claimCompletedMissions,
    listMissionBoard,
    listMissionDefinitionsLean,
};
