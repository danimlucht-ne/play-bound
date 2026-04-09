'use strict';

const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const mongoRouter = require('../../lib/mongoRouter');
const { User, SystemConfig } = require('../../models');
const { processSeasonBoundaries } = require('../../lib/factionSeasons');
const { ensureRotationForDate } = require('../../lib/gamePlatform/rotation');
const { refreshLeaderboard, updateUser, recordLeaderboardPeriodSnapshot } = require('../../lib/db');
const { CREDITS } = require('../../lib/pointBranding');
const { compensateUnresumableGameOnRecovery, buildPartialResultsSummary } = require('../../lib/interruptedGameCompensation');
const { registerAuraBoostTarget } = require('../../lib/auraBoostRegistry');
const { automatedServerPostsEnabled } = require('../../lib/automatedPosts');
const serverdleGame = require('../../games/serverdle');
const triviaGame = require('../../games/trivia');
const spellingBeeGame = require('../../games/spellingbee');
const { applyOpsPresence } = require('../../lib/opsPresence');
const { runMaintenanceAdvanceBroadcast } = require('../../lib/maintenanceBroadcast');
const { logOpsEvent } = require('../../lib/opsEventLog');
const { finalizeHostedGameThread } = require('../../lib/gameThreadLifecycle');

function registerReadyHandler(client, deps) {
    const { state, triggers, loadGameData, resumeScheduledGames } = deps;
    const { activeGiveaways } = state;
    const { endGiveaway } = triggers;

    client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    applyOpsPresence(client);


    // Load words and phrases from DB
    await loadGameData();

    // Resume scheduled tasks
    await resumeScheduledGames();

    await runMaintenanceAdvanceBroadcast(client).catch((e) =>
        console.error('[maintenanceBroadcast] startup:', e?.message || e),
    );

    setTimeout(() => {
        (async () => {
            for (const bag of mongoRouter.listModelBags()) {
                await mongoRouter.runWithForcedModels(bag, async () => {
                    await processSeasonBoundaries(client);
                });
            }
        })().catch((e) => console.error('[Seasons] startup boundary check', e));
    }, 120000);

    (async () => {
        for (const bag of mongoRouter.listModelBags()) {
            await mongoRouter.runWithForcedModels(bag, async () => {
                await ensureRotationForDate(new Date());
            });
        }
    })().catch((e) => console.error('[GamePlatform] startup rotation', e));

    cron.schedule(
        '5 0 * * *',
        () => {
            (async () => {
                for (const bag of mongoRouter.listModelBags()) {
                    await mongoRouter.runWithForcedModels(bag, async () => {
                        await ensureRotationForDate(new Date());
                    });
                }
            })().catch((e) => console.error('[GamePlatform] daily rotation', e));
        },
        { timezone: 'Etc/UTC' },
    );

    cron.schedule('20 * * * *', async () => {
        try {
            for (const bag of mongoRouter.listModelBags()) {
                await mongoRouter.runWithForcedModels(bag, async () => {
                    await processSeasonBoundaries(client);
                });
            }
        } catch (e) {
            console.error('[Seasons] hourly boundary check', e);
        }
    });

    cron.schedule(
        '5 * * * *',
        () => {
            runMaintenanceAdvanceBroadcast(client).catch((e) =>
                console.error('[maintenanceBroadcast] hourly:', e?.message || e),
            );
        },
        { timezone: 'Etc/UTC' },
    );

    // --- CRASH RECOVERY SYSTEM (FROM MONGODB) ---
    let recoveryCount = 0;
    for (const models of mongoRouter.listModelBags()) {
        const batch = await models.Game.find({ status: 'active' });
        recoveryCount += batch.length;
    }
    if (recoveryCount > 0) {
        console.log(`[Recovery] Found ${recoveryCount} orphaned games. Attempting to resume or clean up...`);
    }
    for (const models of mongoRouter.listModelBags()) {
        const orphanedGames = await models.Game.find({ status: 'active' });
        for (const g of orphanedGames) {
            try {
                if (g.type === 'Giveaway') {
                    const remainingMs = g.endTime ? g.endTime.getTime() - Date.now() : 0;
                    if (remainingMs > 0) {
                        console.log(`[Recovery] Resuming Giveaway: ${g._id}`);
                        logOpsEvent('recovery_action', {
                            action: 'resumed',
                            guildId: g.guildId,
                            channelId: g.channelId,
                            threadId: g.threadId,
                            gameType: g.type,
                            gameMongoId: String(g._id),
                            remainingMs,
                        });
                        activeGiveaways.set(g.threadId, { 
                            guildId: g.guildId, 
                            winnersCount: g.state.winnersCount, 
                            participants: new Set(g.state.participants), 
                            channelId: g.channelId, 
                            threadId: g.threadId, 
                            ignoredUsers: g.state.ignoredUsers, 
                            ignoredRoles: g.state.ignoredRoles,
                            cooldownDays: g.state.cooldownDays, 
                            pointValues: g.state.pointValues, 
                            hostIsPremium: g.hostIsPremium === true,
                            premiumAuraBoost: g.premiumAuraBoost === true,
                            timeoutHandle: setTimeout(
                                () => mongoRouter.runWithGuild(g.guildId, () => endGiveaway(g.threadId)),
                                remainingMs,
                            ),
                        });
                        continue; // Successfully resumed
                    }
                }

                if (g.type === 'Serverdle') {
                    const remainingMs = g.endTime ? g.endTime.getTime() - Date.now() : 0;
                    if (remainingMs > 0) {
                        console.log(`[Recovery] Resuming Serverdle: ${g._id}`);
                        logOpsEvent('recovery_action', {
                            action: 'resumed',
                            guildId: g.guildId,
                            channelId: g.channelId,
                            threadId: g.threadId,
                            gameType: g.type,
                            gameMongoId: String(g._id),
                            remainingMs,
                        });
                        serverdleGame.getActiveGames().set(g.threadId, {
                            guildId: g.guildId,
                            channelId: g.channelId,
                            threadId: g.threadId,
                            word: g.state.word,
                            pointValues: g.state.pointValues,
                            players: g.state.players || {},
                            winners: g.state.winners || [],
                            hostIsPremium: g.hostIsPremium === true,
                            premiumAuraBoost: g.premiumAuraBoost === true,
                            timeoutHandle: setTimeout(
                                () =>
                                    mongoRouter.runWithGuild(g.guildId, () =>
                                        serverdleGame.forceEnd(client, g.threadId),
                                    ),
                                remainingMs,
                            ),
                        });
                        registerAuraBoostTarget(g.threadId, () => {
                            const sd = serverdleGame.getActiveGames().get(g.threadId);
                            if (sd) sd.premiumAuraBoost = true;
                        });
                        continue; // Successfully resumed
                    }
                }

                // Default: Cancel and archive for fast-paced games (Trivia, Tune, etc.)
                let compSummary = {
                    participantCount: 0,
                    compensatedCount: 0,
                    pointsPerUser: 0,
                };
                try {
                    compSummary = await compensateUnresumableGameOnRecovery(client, g);
                    logOpsEvent('recovery_action', {
                        action: 'compensated',
                        guildId: g.guildId,
                        channelId: g.channelId,
                        threadId: g.threadId,
                        gameType: g.type,
                        gameMongoId: String(g._id),
                        participantCount: compSummary.participantCount,
                        compensatedCount: compSummary.compensatedCount,
                        pointsPerUser: compSummary.pointsPerUser,
                        skipped: compSummary.skipped,
                    });
                } catch (compErr) {
                    logOpsEvent('recovery_action', {
                        action: 'compensation_failed',
                        guildId: g.guildId,
                        channelId: g.channelId,
                        threadId: g.threadId,
                        gameType: g.type,
                        gameMongoId: String(g._id),
                        errorName: compErr?.name || null,
                        errorMessage: compErr?.message || String(compErr),
                    });
                    console.error(`[Recovery] Interrupted-game compensation failed for ${g._id}:`, compErr);
                }

                if (g.threadId) {
                    const chan = await client.channels.fetch(g.threadId);
                    if (chan && chan.isThread()) {
                        const partialResults = buildPartialResultsSummary(g);
                        let rebootMsg =
                            `\u26a0\ufe0f **System Reboot:** The bot experienced an unexpected restart. This **${g.type}** was too fast-paced to resume and has been safely concluded.`;
                        if (compSummary.placementAwarded) {
                            rebootMsg +=
                                `\n\n\ud83c\udfc6 **Placement credits awarded** based on scores at time of interruption for **${compSummary.compensatedCount}** player(s).`;
                        } else if (compSummary.compensatedCount > 0 && compSummary.pointsPerUser > 0) {
                            rebootMsg +=
                                `\n\n\ud83c\udf81 **Goodwill:** **${compSummary.pointsPerUser}** ${CREDITS} each were added for **${compSummary.compensatedCount}** player(s) we could identify from saved game data.`;
                        }
                        if (partialResults) {
                            rebootMsg += partialResults;
                        }
                        await chan.send(rebootMsg);
                        await finalizeHostedGameThread(chan, { disableComponents: true });
                    }
                }
                g.status = 'ended';
                await g.save();
                logOpsEvent('recovery_action', {
                    action: 'ended_unresumable',
                    guildId: g.guildId,
                    channelId: g.channelId,
                    threadId: g.threadId,
                    gameType: g.type,
                    gameMongoId: String(g._id),
                    participantCount: compSummary.participantCount,
                    compensatedCount: compSummary.compensatedCount,
                });
            } catch(e) {
                logOpsEvent('recovery_action', {
                    action: 'failed',
                    guildId: g.guildId,
                    channelId: g.channelId,
                    threadId: g.threadId,
                    gameType: g.type,
                    gameMongoId: String(g._id),
                    errorName: e?.name || null,
                    errorMessage: e?.message || String(e),
                });
                console.error(`[Recovery Error] Failed to recover game ${g._id}:`, e);
                try {
                    await models.Game.updateOne(
                        { _id: g._id, status: 'active' },
                        { $set: { status: 'ended', endTime: new Date() } },
                    );
                } catch (closeErr) {
                    console.error(`[Recovery] Could not mark game ${g._id} ended:`, closeErr);
                }
            }
        }
    }

    // Commands are now handled globally via deploy-commands.js
    
    // Daily B-Day Check (Now every hour, checks for today)
    setInterval(async () => {
        for (const bagModels of mongoRouter.listModelBags()) {
            const configs = await bagModels.SystemConfig.find({});
            for (const config of configs) {
            const guildId = config.guildId;
            await mongoRouter.runWithGuild(guildId, async () => {
            await refreshLeaderboard(client, guildId);
            if (!config.birthdayChannel) return;
            const today = new Date().toISOString().slice(5, 10);
            const currentYear = new Date().getFullYear();
            
            const users = await User.find({ guildId, birthday: today });
            for (const u of users) {
                if (u.userId !== 'SYSTEM' && u.lastBirthdayClaim !== currentYear) {
                    await updateUser(guildId, u.userId, user => {
                        user.points += 5;
                        user.weeklyPoints += 5;
                        user.monthlyPoints = (user.monthlyPoints || 0) + 5;
                        user.lastBirthdayClaim = currentYear;
                    });
                    
                    let bMsg = "🎂 **Happy Birthday <@" + u.userId + ">!** (+5 pts)";
                    if (config.birthdayMessages && config.birthdayMessages.length > 0) {
                        bMsg = config.birthdayMessages[Math.floor(Math.random() * config.birthdayMessages.length)].replace(/\{user\}/g, "<@" + u.userId + ">");
                    } else if (config.birthdayMessage) {
                        bMsg = config.birthdayMessage.replace(/\{user\}/g, "<@" + u.userId + ">");
                    }
                    client.channels.cache.get(config.birthdayChannel)?.send(bMsg).catch(() => {});
                }
            }
            });
            }
        }
    }, 3600000);

    // Weekly Recap and Winner (Runs every Sunday at 8:00 PM)
    cron.schedule('0 20 * * 0', async () => {
        for (const bagModels of mongoRouter.listModelBags()) {
            const configs = await bagModels.SystemConfig.find({});
            for (const config of configs) {
            const guildId = config.guildId;
            await mongoRouter.runWithGuild(guildId, async () => {

            const users = await User.find({ guildId, userId: { $ne: 'SYSTEM' } }).sort({ weeklyPoints: -1 });
            try {
                await recordLeaderboardPeriodSnapshot(guildId, 'weekly', users, 'weeklyPoints');
            } catch (e) {
                console.error(`[Weekly snapshot] ${guildId}:`, e);
            }

            if (config.announceChannel && automatedServerPostsEnabled(config)) {
                let winnerText = "No points earned this week.";
                if (users.length > 0 && (users[0].weeklyPoints || 0) > 0) {
                    winnerText = `🏆 **Weekly Champion:** <@${users[0].userId}> with **${users[0].weeklyPoints}** points!`;
                }

                const recapEmbed = new EmbedBuilder()
                    .setColor('#FFD700')
                    .setTitle('📊 Weekly Server Recap')
                    .setDescription(winnerText)
                    .addFields({
                        name: '🔝 Top 3 this week',
                        value: users.slice(0, 3).map((u, i) => `${i + 1}. <@${u.userId}> — **${u.weeklyPoints || 0}** pts`).join('\n\n') || 'None',
                    })
                    .setFooter({
                        text: 'Totals = weekly Credits (see /profile). Non-war: first 5 /playgame/UTC day count; war /playgame also counts but personal Credits from wars cap at 50/UTC day (war score uses full base).',
                    });

                const chan = client.channels.cache.get(config.announceChannel);
                if (chan) {
                    await chan.send({ embeds: [recapEmbed] });
                }
            }

            await User.updateMany({ guildId }, { $set: { weeklyPoints: 0 } });

            if (config.factionWarReminderChannelId && automatedServerPostsEnabled(config)) {
                const rch = client.channels.cache.get(config.factionWarReminderChannelId);
                if (rch?.send) {
                    await rch
                        .send({
                            content:
                                '⚔️ **New week — time for a faction war?**\n\n' +
                                'Premium + Manager: `/faction_challenge create` or `create_royale`.\n\n' +
                                'Everyone in a team: `/faction join` then `/faction_challenge join`.',
                        })
                        .catch(() => {});
                }
            }
            });
            }
        }
    });

    // Monthly recap (1st of month, 8:00 PM — same clock as weekly recap), then reset monthlyPoints
    cron.schedule('0 20 1 * *', async () => {
        for (const bagModels of mongoRouter.listModelBags()) {
            const configs = await bagModels.SystemConfig.find({});
            for (const config of configs) {
            const guildId = config.guildId;
            await mongoRouter.runWithGuild(guildId, async () => {
            const users = await User.find({ guildId, userId: { $ne: 'SYSTEM' } }).sort({ monthlyPoints: -1 });
            try {
                await recordLeaderboardPeriodSnapshot(guildId, 'monthly', users, 'monthlyPoints');
            } catch (e) {
                console.error(`[Monthly snapshot] ${guildId}:`, e);
            }
            if (config.announceChannel && automatedServerPostsEnabled(config)) {
                let winnerText = 'No points earned this month.';
                if (users.length > 0 && (users[0].monthlyPoints || 0) > 0) {
                    winnerText = `🏆 **Monthly Champion:** <@${users[0].userId}> with **${users[0].monthlyPoints}** points!`;
                }
                const recapEmbed = new EmbedBuilder()
                    .setColor('#9B59B6')
                    .setTitle('📊 Monthly Server Recap')
                    .setDescription(winnerText)
                    .addFields({
                        name: '🔝 Top 3 this month',
                        value: users.slice(0, 3).map((u, i) => `${i + 1}. <@${u.userId}> — **${u.monthlyPoints || 0}** pts`).join('\n\n') || 'None',
                    });
                const chan = client.channels.cache.get(config.announceChannel);
                if (chan) await chan.send({ embeds: [recapEmbed] });
            }
            await User.updateMany({ guildId }, { $set: { monthlyPoints: 0 } });
            });
            }
        }
    });

        // Recurring Games Checker (Runs every 5 minutes)
    cron.schedule('*/5 * * * *', async () => {
        try {
            const now = new Date();
            for (const models of mongoRouter.listModelBags()) {
                const dueGames = await models.RecurringGame.find({ nextRun: { $lte: now } });
                if (dueGames.length === 0) continue;

                console.log(`[Recurring Games] Found ${dueGames.length} games due to run.`);

                for (const rec of dueGames) {
                    try {
                        await mongoRouter.runWithGuild(rec.guildId, async () => {
                            const channel = await client.channels.fetch(rec.channelId);
                            if (!channel) {
                                await models.RecurringGame.deleteOne({ _id: rec._id });
                                return;
                            }

                            if (rec.type === 'trivia') {
                                await triviaGame.startTriviaGame(
                                    client,
                                    rec.guildId,
                                    rec.channelId,
                                    rec.data.diff,
                                    rec.data.cat,
                                    rec.data.qCount,
                                    rec.data.pts,
                                    rec.data.threadName,
                                    rec.data.slowMode,
                                    rec.data.hostIsPremium === true,
                                    rec.data.questionSeconds ?? 30,
                                    rec.data.breakSeconds ?? 20,
                                );
                            } else if (rec.type === 'startserverdle') {
                                await serverdleGame.startServerdleGame(
                                    client,
                                    rec.guildId,
                                    rec.channelId,
                                    rec.data.dur,
                                    rec.data.customWord,
                                    rec.data.threadName,
                                    rec.data.pts,
                                    rec.data.hostIsPremium === true,
                                );
                            } else if (rec.type === 'spellingbee') {
                                await spellingBeeGame.startSpellingBeeFromRecurring(client, rec);
                            } else {
                                await channel.send(
                                    `🔄 **Recurring Game Scheduled:** The \`${rec.type}\` game was supposed to run here, but automatic execution requires refactoring the game logic. Please start it manually for now.`,
                                );
                            }

                            const dayMs = (Number(rec.intervalDays) || 0) * 86400000;
                            const hourMs = (Number(rec.intervalHours) || 0) * 3600000;
                            rec.nextRun = new Date(Date.now() + dayMs + hourMs);
                            await rec.save();
                        });
                    } catch (e) {
                        console.error(`[Recurring Games] Error executing game ${rec._id}:`, e);
                    }
                }
            }
        } catch (e) {
             console.error(`[Recurring Games] Check failed:`, e);
        }
    });
    });
}

module.exports = { registerReadyHandler };
