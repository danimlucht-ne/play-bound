const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { parsePointValues, defaultGameThreadName } = require('../lib/utils');
const {
    createHostedGamePublicThread,
    finalizeHostedGameThread,
    getSlashScheduleDelayMs,
} = require('../lib/gameThreadLifecycle');
const { makeGameFlairEmbed } = require('../lib/gameFlair');
const { addScore, updateUser, createActiveGame, getUser, endActiveGame } = require('../lib/db');
const { awardAchievement } = require('../lib/achievements');
const { announceWinner, sendGlobalAnnouncement, announceScheduledGame } = require('../lib/announcements');
const { RecurringGame } = require('../models');
const { sessionHasHostAura } = require('../lib/premiumPerks');
const { unregisterAuraBoostTarget } = require('../lib/auraBoostRegistry');
const { sendInviteViralNudgeIfAllowed } = require('../lib/referrals');
const { appendPremiumGameResultFooter } = require('../lib/premiumUpsell');
const {
    throwIfGameSchedulingBlocked,
    throwIfImmediateGameStartBlockedByMaintenance,
} = require('../lib/maintenanceScheduling');
const { recurringIntervalMs, splitRecurringParts } = require('../lib/recurringInterval');
const {
    DEFAULT_GIVEAWAY_PLACEMENT,
    DEFAULT_PARTICIPATION_POINTS,
} = require('../lib/gamePointsDefaults');

const activeGiveaways = new Map();

async function endGiveaway(client, msgId) {
    const ga = activeGiveaways.get(msgId);
    if (!ga) return;
    const guildId = ga.guildId;
    const hostAura = sessionHasHostAura(ga);
    unregisterAuraBoostTarget(msgId);

    if (ga.announcementMessage) {
        try { await ga.announcementMessage.delete(); } catch(e) {}
    }
    const pArr = Array.from(ga.participants); let res = `🎉 **Giveaway Ended!** 🎉\n`;
    let winnerText = "No entries!";
    const thread = client.channels.cache.get(ga.threadId);
    const pointValues =
        Array.isArray(ga.pointValues) && ga.pointValues.length > 0
            ? ga.pointValues
            : parsePointValues(DEFAULT_GIVEAWAY_PLACEMENT, DEFAULT_GIVEAWAY_PLACEMENT);
    if (pArr.length > 0) {
        const winners = pArr.sort(() => 0.5 - Math.random()).slice(0, ga.winnersCount);
        const winnerSet = new Set(winners);
        winnerText =
            `**Winners:** ` +
            winners
                .map((id, i) => {
                    awardAchievement(client, guildId, thread, id, "FIRST_WIN");
                    updateUser(guildId, id, (u) => {
                        u.stats.lastGiveawayWin = Date.now();
                    });
                    const pts =
                        i < pointValues.length
                            ? pointValues[i]
                            : pointValues[pointValues.length - 1] ?? DEFAULT_PARTICIPATION_POINTS;
                    if (pts > 0) {
                        addScore(client, guildId, id, pts, null, hostAura, 'giveaway');
                    }
                    return `<@${id}>`;
                })
                .join(', ');
        res += winnerText;
        for (const pid of pArr) {
            if (winnerSet.has(pid)) continue;
            if (DEFAULT_PARTICIPATION_POINTS > 0) {
                addScore(client, guildId, pid, DEFAULT_PARTICIPATION_POINTS, null, hostAura, 'giveaway');
            }
        }
    } else {
        res += winnerText;
    }
    await announceWinner(client, guildId, 'Giveaway', winnerText, ga.channelId);
    res = appendPremiumGameResultFooter(res);
    if (thread) {
        await thread.send(res);
        await sendInviteViralNudgeIfAllowed(guildId, thread);
        await finalizeHostedGameThread(thread, { disableComponents: true });
    }
    if (ga.messageRef) {
        ga.messageRef.edit({ content: res, components: [] }).catch(()=>{});
    }
    clearTimeout(ga.timeoutHandle); activeGiveaways.delete(msgId);
    await endActiveGame(msgId, client).catch(() => {});
}

async function handleGiveawayCommand(interaction, client, scheduleGameFn) {
    const guildId = interaction.guildId;
    const dur = interaction.options.getInteger('duration');
    const winCount = interaction.options.getInteger('winners') || 1;
    const threadName = interaction.options.getString('thread_name') || defaultGameThreadName('Giveaway');
    const ignoredUsersOpt = interaction.options.getString('ignored_users') || '';
    const ignoredRolesOpt = interaction.options.getString('ignored_roles') || '';
    const ignoreUserOpt = interaction.options.getUser('ignore_user');
    const ignoreRoleOpt = interaction.options.getRole('ignore_role');
    const cooldownDays = interaction.options.getInteger('cooldown_days') || 0;
    const ptsOpt = interaction.options.getString('points') || DEFAULT_GIVEAWAY_PLACEMENT;
    const delay = getSlashScheduleDelayMs(interaction);
    const repeatHrs = interaction.options.getInteger('repeat_hrs') || 0;
    const repeatDays = interaction.options.getInteger('repeat_days') || 0;

    const ignoredUsers = Array.from(
        new Set([
            ...ignoredUsersOpt.split(',').map((s) => s.replace(/<@!?|>/g, '').trim()).filter(Boolean),
            ...(ignoreUserOpt ? [ignoreUserOpt.id] : []),
        ]),
    );
    const ignoredRoles = Array.from(
        new Set([
            ...ignoredRolesOpt.split(',').map((s) => s.replace(/<@&|>/g, '').trim()).filter(Boolean),
            ...(ignoreRoleOpt ? [ignoreRoleOpt.id] : []),
        ]),
    );

    await interaction.deferReply({ ephemeral: true });

    const start = async () => {
        try {
            throwIfImmediateGameStartBlockedByMaintenance(Date.now(), dur * 60000);
            const thread = await createHostedGamePublicThread(interaction.channel, threadName);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('enter_giveaway').setLabel('🎉 Enter').setStyle(ButtonStyle.Success));
            const msg = await thread.send({ content: `🎁 **GIVEAWAY!**\nEnds in: **${dur} minutes**`, components: [row] });
            const game_state_giveaway = { winnersCount: winCount, participants: [], ignoredUsers, ignoredRoles, cooldownDays, pointValues: parsePointValues(ptsOpt, DEFAULT_GIVEAWAY_PLACEMENT) };
            const gh = await getUser(guildId, interaction.user.id);
            const ghPrem = gh.isPremium === true;
            await createActiveGame(guildId, interaction.channelId, msg.id, 'Giveaway', game_state_giveaway, dur, ghPrem);
            activeGiveaways.set(msg.id, { guildId, winnersCount: winCount, participants: new Set(), channelId: interaction.channelId, threadId: thread.id, messageRef: msg, ignoredUsers, ignoredRoles, cooldownDays, pointValues: parsePointValues(ptsOpt, DEFAULT_GIVEAWAY_PLACEMENT), hostIsPremium: ghPrem, timeoutHandle: setTimeout(() => endGiveaway(client, msg.id), dur * 60000) });
            activeGiveaways.get(msg.id).announcementMessage = await sendGlobalAnnouncement(client, guildId, `A new giveaway has started in <#${interaction.channelId}>! Ends in ${dur}m. Status: **${winCount} winners**`, thread.id);
        } catch(e) {
            console.error(e);
        }
    };

    const repeatMs = recurringIntervalMs({ repeat_days: repeatDays, repeat_hrs: repeatHrs });
    if (repeatMs > 0) {
        const user = await getUser(guildId, interaction.user.id);
        if (!user.isPremium) return interaction.editReply({ content: "❌ **Recurring Games** are a Premium feature! Use `/premium` to unlock the Autopilot system." });

        const nextRun = new Date(Date.now() + delay + repeatMs);
        throwIfGameSchedulingBlocked(nextRun.getTime());
        const { intervalDays, intervalHours } = splitRecurringParts({ repeat_days: repeatDays, repeat_hrs: repeatHrs });
        await RecurringGame.create({
            guildId,
            channelId: interaction.channelId,
            type: 'giveaway',
            intervalDays,
            intervalHours,
            data: { dur, winCount, threadName, ignoredUsersOpt, ignoredRolesOpt, cooldownDays, ptsOpt },
            nextRun
        });
        const iv =
            (intervalDays ? `**${intervalDays}** day(s) ` : '') + (intervalHours ? `**${intervalHours}** hour(s)` : '');
        await interaction.editReply({ content: `✅ Giveaway scheduled to repeat every ${iv.trim()}!` });
        if (delay === 0) await start();
    } else if (delay > 0) {
        const sid = await scheduleGameFn(guildId, 'Giveaway', interaction.channelId, delay, start);
        await interaction.editReply({ content: `Scheduled! (ID: \`${sid}\`)` });
        announceScheduledGame(client, guildId, 'Giveaway', delay);
    }
    else { await interaction.editReply({ content: "Giveaway Started!" }); await start(); }
}

async function handleGiveawayInteraction(interaction, client, updateActiveGameFn) {
    if (!interaction.isButton()) return false;

    if (interaction.customId === 'enter_giveaway') {
        const ga = activeGiveaways.get(interaction.message.id);
        if (!ga) return interaction.reply({ content: 'Giveaway has ended.', ephemeral: true });
        
        const guildId = ga.guildId;
        if (ga.ignoredUsers && ga.ignoredUsers.includes(interaction.user.id)) return interaction.reply({ content: 'You are not eligible for this giveaway.', ephemeral: true });

        if (ga.ignoredRoles && ga.ignoredRoles.length > 0) {
            const hasForbiddenRole = interaction.member.roles.cache.some(r => ga.ignoredRoles.includes(r.id));
            if (hasForbiddenRole) return interaction.reply({ content: '❌ One of your roles is restricted from entering this giveaway.', ephemeral: true });
        }

        if (ga.cooldownDays > 0) {
            const u = await getUser(guildId, interaction.user.id);
            if (u.stats.lastGiveawayWin && (Date.now() - u.stats.lastGiveawayWin < ga.cooldownDays * 86400000)) {
                return interaction.reply({ content: `You've won a giveaway recently and are on cooldown for ${ga.cooldownDays} days!`, ephemeral: true });
            }
        }
        if (ga.participants.has(interaction.user.id)) return interaction.reply({ content: 'Already in!', ephemeral: true });
        ga.participants.add(interaction.user.id);
        
        updateActiveGameFn(interaction.message.id, state => {
            state.participants = Array.from(ga.participants);
        });
        updateUser(guildId, interaction.user.id, u => { 
            u.stats.giveawaysEntered = (u.stats.giveawaysEntered || 0) + 1; 
            if (u.stats.giveawaysEntered >= 5) awardAchievement(client, guildId, interaction.channel, interaction.user.id, "HOPEFUL"); 
        });
        await interaction.reply({ content: 'Entered!', ephemeral: true }).then(()=>setTimeout(()=>interaction.deleteReply().catch(()=>{}),5000));
        return true;
    }

    if (interaction.customId.startsWith('cancel_giv_')) {
        const parts = interaction.customId.split('_');
        const action = parts[2]; // 'winner' or 'void'
        const gid = parts[3];
        const ga = activeGiveaways.get(gid);
        
        if (!ga) return interaction.reply({ content: 'Giveaway no longer active.', ephemeral: true });

        if (action === 'winner') {
            await interaction.reply({ content: '🏆 Picking winner now...', ephemeral: true });
            clearTimeout(ga.timeoutHandle);
            await endGiveaway(client, gid);
        } else {
            await interaction.reply({ content: '❌ Giveaway cancelled entirely.', ephemeral: true });
            clearTimeout(ga.timeoutHandle);
            activeGiveaways.delete(gid);
            await endActiveGame(gid, client);
            const thread = client.channels.cache.get(ga.threadId);
            if (thread) {
                await thread.send('⚠️ This giveaway has been cancelled by an administrator.');
                await finalizeHostedGameThread(thread, { disableComponents: true });
            }
        }
        return true;
    }
    
    return false;
}

function resumeGiveaway(g, client) {
    const remainingMs = g.endTime ? g.endTime.getTime() - Date.now() : 0;
    if (remainingMs > 0) {
        console.log(`[Recovery] Resuming Giveaway: ${g._id}`);
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
            timeoutHandle: setTimeout(() => endGiveaway(client, g.threadId), remainingMs) 
        });
        return true;
    }
    return false;
}

function getGiveawayStatus(channelId, messageId) {
    if (channelId && activeGiveaways.has(channelId)) return { active: true, id: channelId };
    if (messageId && activeGiveaways.has(messageId)) return { active: true, id: messageId };
    return { active: false };
}

module.exports = {
    endGiveaway,
    handleGiveawayCommand,
    handleGiveawayInteraction,
    resumeGiveaway,
    getGiveawayStatus,
    activeGiveaways
};