'use strict';

const mongoRouter = require('../../lib/mongoRouter');
const { getSystemConfig } = require('../../lib/db');
const { automatedServerPostsEnabled } = require('../../lib/automatedPosts');
const { throwIfGameSchedulingBlocked } = require('../../lib/maintenanceScheduling');
const { logOpsEvent } = require('../../lib/opsEventLog');

function createScheduleHelpers(client, state) {
    const { scheduledGames } = state;

    async function scheduleGame(guildId, type, channelId, delay, startFn, data = {}) {
        throwIfGameSchedulingBlocked(Date.now() + delay, {
            guildId,
            channelId,
            gameType: type,
            delayMs: delay,
        });
        const id = Math.random().toString(36).substring(2, 9).toUpperCase();
        const startTime = new Date(Date.now() + delay);

        await mongoRouter.runWithGuild(guildId, async () => {
            const { Game } = mongoRouter.getModelsForGuild(guildId);
            await Game.create({
                guildId,
                channelId,
                type: 'Scheduled_' + type,
                status: 'scheduled',
                startTime,
                state: { sid: id, originalType: type, ...data },
            });
        });

        const timeoutHandle = setTimeout(async () => {
            await mongoRouter.runWithGuild(guildId, async () => {
                logOpsEvent('scheduled_game', {
                    action: 'fired',
                    guildId,
                    channelId,
                    scheduleId: id,
                    gameType: type,
                });
                const { Game } = mongoRouter.getModelsForGuild(guildId);
                scheduledGames.delete(id);
                await Game.findOneAndUpdate({ 'state.sid': id }, { status: 'ended' });
                await startFn();
            });
        }, delay);

        scheduledGames.set(id, { id, guildId, type, channelId, startTime, timeoutHandle, startFn, data });
        logOpsEvent('scheduled_game', {
            action: 'created',
            guildId,
            channelId,
            scheduleId: id,
            gameType: type,
            delayMs: delay,
            startTime: startTime.toISOString(),
        });
        return id;
    }

    async function resumeScheduledGames() {
        const now = new Date();
        let totalPending = 0;
        const jobs = [];
        for (const models of mongoRouter.listModelBags()) {
            const batch = await models.Game.find({ status: 'scheduled' });
            for (const g of batch) {
                jobs.push({ g, models });
            }
            totalPending += batch.length;
        }

        console.log(`[Persistence] Resuming ${totalPending} scheduled games/announcements...`);
        logOpsEvent('scheduled_game', { action: 'resume_scan', count: totalPending });

        for (const { g } of jobs) {
            const delay = g.startTime.getTime() - now.getTime();
            const sid = g.state.sid;
            const type = g.state.originalType;

            if (type === 'FactionChallenge') {
                await mongoRouter.runWithGuild(g.guildId, async () => {
                    const { Game } = mongoRouter.getModelsForGuild(g.guildId);
                    scheduledGames.delete(sid);
                    await Game.findByIdAndUpdate(g._id, { status: 'ended' });
                });
                logOpsEvent('scheduled_game', {
                    action: 'dropped_defunct_type',
                    guildId: g.guildId,
                    channelId: g.channelId,
                    scheduleId: sid,
                    gameType: type,
                    gameMongoId: String(g._id),
                });
                continue;
            }

            if (delay <= 0) {
                await mongoRouter.runWithGuild(g.guildId, async () => {
                    logOpsEvent('scheduled_game', {
                        action: 'run_due_now',
                        guildId: g.guildId,
                        channelId: g.channelId,
                        scheduleId: sid,
                        gameType: type,
                        gameMongoId: String(g._id),
                    });
                    const { Game } = mongoRouter.getModelsForGuild(g.guildId);
                    if (type === 'Announcement') {
                        const chan = await client.channels.fetch(g.channelId).catch(() => null);
                        if (chan) await chan.send(g.state.message);
                    }
                    await Game.findByIdAndUpdate(g._id, { status: 'ended' });
                });
            } else {
                const startFn = async () => {
                    if (type === 'Announcement') {
                        const cfgB = await getSystemConfig(g.guildId);
                        if (automatedServerPostsEnabled(cfgB)) {
                            const chan = await client.channels.fetch(g.channelId).catch(() => null);
                            if (chan) await chan.send(g.state.message);
                        }
                    }
                };

                const timeoutHandle = setTimeout(async () => {
                    await mongoRouter.runWithGuild(g.guildId, async () => {
                        logOpsEvent('scheduled_game', {
                            action: 'fired',
                            guildId: g.guildId,
                            channelId: g.channelId,
                            scheduleId: sid,
                            gameType: type,
                            gameMongoId: String(g._id),
                        });
                        const { Game } = mongoRouter.getModelsForGuild(g.guildId);
                        scheduledGames.delete(sid);
                        await Game.findByIdAndUpdate(g._id, { status: 'ended' });
                        await startFn();
                    });
                }, delay);
                scheduledGames.set(sid, {
                    id: sid,
                    guildId: g.guildId,
                    type,
                    channelId: g.channelId,
                    startTime: g.startTime,
                    timeoutHandle,
                    startFn,
                });
                logOpsEvent('scheduled_game', {
                    action: 'resumed_timer',
                    guildId: g.guildId,
                    channelId: g.channelId,
                    scheduleId: sid,
                    gameType: type,
                    gameMongoId: String(g._id),
                    delayMs: delay,
                    startTime: g.startTime?.toISOString?.() || null,
                });
            }
        }
    }

    return { scheduleGame, resumeScheduledGames };
}

module.exports = { createScheduleHelpers };
