const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { parsePointValues, defaultGameThreadName } = require('../lib/utils');
const {
    createHostedGamePublicThread,
    finalizeHostedGameThread,
    getSlashScheduleDelayMs,
} = require('../lib/gameThreadLifecycle');
const { makeGameFlairEmbed } = require('../lib/gameFlair');
const { addScore, updateUser, createActiveGame, getUser, updateActiveGame } = require('../lib/db');
const {
    throwIfGameSchedulingBlocked,
    throwIfImmediateGameStartBlockedByMaintenance,
} = require('../lib/maintenanceScheduling');
const { awardAchievement, milestoneAchievementKeys } = require('../lib/achievements');
const { announceWinner, sendGlobalAnnouncement, announceScheduledGame } = require('../lib/announcements');
const { RecurringGame } = require('../models');
const { sessionHasHostAura } = require('../lib/premiumPerks');

const activeCaptions = new Map();

async function triggerCaptionEnd(client, threadId) {
    const activeCaption = activeCaptions.get(threadId);
    if (!activeCaption) return;
    const guildId = activeCaption.guildId;
    const hostAura = sessionHasHostAura(activeCaption);
    if (activeCaption.announcementMessage) {
        try { await activeCaption.announcementMessage.delete(); } catch(e) {}
    }
    const thread = client.channels.cache.get(activeCaption.threadId);
    let res = `🖼️ **Caption Contest Ended!**\n`;
    let winnerText = "No clear winner! Thanks for playing.";
    
    if (thread) {
        try {
            const messages = await thread.messages.fetch();
            const userMessages = messages.filter(m => !m.author.bot);
            
            let winnerMsg = null;
            let maxVotes = -1;
            
            for (const m of userMessages.values()) {
                const voterIds = new Set();
                for (const r of m.reactions.cache.values()) {
                    try {
                        const users = await r.users.fetch();
                        for (const u of users.values()) {
                            if (u.bot) continue;
                            if (u.id === m.author.id) continue;
                            voterIds.add(u.id);
                        }
                    } catch (e) { /* ignore partial fetch failures */ }
                }
                const totalVotes = voterIds.size;

                if (totalVotes > maxVotes) {
                    maxVotes = totalVotes;
                    winnerMsg = m;
                } else if (totalVotes === maxVotes && winnerMsg && m.createdTimestamp < winnerMsg.createdTimestamp) {
                    winnerMsg = m;
                }
            }
            
            if (winnerMsg && maxVotes > 0) {
                winnerText = `🏆 **Winner:** <@${winnerMsg.author.id}> with **${maxVotes}** reactions!\nCaption: *"${winnerMsg.content}"*`;
                res += `${winnerText}\nThey earn 5 leaderboard points!`;
                addScore(client, guildId, winnerMsg.author.id, 5, null, hostAura, 'caption');
                awardAchievement(client, guildId, thread, winnerMsg.author.id, "FIRST_WIN");
                
                updateUser(guildId, winnerMsg.author.id, u => {
                    u.stats.gamesWon = (u.stats.gamesWon || 0) + 1;
                    u.stats.captionWins = (u.stats.captionWins || 0) + 1;
                    for (const key of milestoneAchievementKeys('captionWins', u.stats.captionWins)) {
                        awardAchievement(client, guildId, thread, winnerMsg.author.id, key);
                    }
                });
            } else {
                res += winnerText;
            }
        } catch (e) {
            console.error('Caption resolution error:', e);
            res += "Thanks for participating!";
        }
        await thread.send(res);
        await finalizeHostedGameThread(thread, { disableComponents: true });
    }
    
    await announceWinner(client, guildId, 'Caption Contest', winnerText, activeCaption.channelId);
    clearTimeout(activeCaption.timeoutHandle); activeCaptions.delete(threadId);
}

async function handleCaptionCommand(interaction, client, scheduleGameFn) {
    const guildId = interaction.guildId;
    const dur = interaction.options.getInteger('duration') || 10;
    const threadName = interaction.options.getString('thread_name') || defaultGameThreadName('Caption Contest');
    const ptsOpt = interaction.options.getString('points') || '5';
    const delay = getSlashScheduleDelayMs(interaction);
    const repeatHrs = interaction.options.getInteger('repeat_hrs');

    await interaction.deferReply({ ephemeral: true });

    const start = async () => {
        let imageUrl = '';
        try {
            const apiChoice = Math.random();
            if (apiChoice < 0.20) { imageUrl = (await axios.get('https://api.thecatapi.com/v1/images/search')).data[0].url; }
            else if (apiChoice < 0.40) { imageUrl = (await axios.get('https://dog.ceo/api/breeds/image/random')).data.message; }
            else if (apiChoice < 0.60) { const res = await axios.get('https://api.bunnies.io/v2/loop/random/?media=gif,png'); imageUrl = res.data.media.gif || res.data.media.poster; }
            else if (apiChoice < 0.80) { imageUrl = (await axios.get('https://randomfox.ca/floof/')).data.image; }
            else { imageUrl = `https://loremflickr.com/800/600/squirrel?lock=${Math.floor(Math.random()*1000)}`; }
        } catch (e) { imageUrl = 'https://cataas.com/cat'; }

        const embed = new EmbedBuilder()
            .setColor('#FF4500')
            .setTitle('🖼️ Caption Contest!')
            .setDescription(`Reply in the thread below with your best caption for this image.\n\nContest ends in **${dur} minutes**.`)
            .setImage(imageUrl);

        try {
            throwIfImmediateGameStartBlockedByMaintenance(Date.now(), dur * 60000);
            const thread = await createHostedGamePublicThread(interaction.channel, threadName);
            await thread.send({ embeds: [embed] });
            const game_state_caption = { participants: [], pointValues: parsePointValues(ptsOpt, '5') };
            await createActiveGame(guildId, interaction.channelId, thread.id, 'CaptionContest', game_state_caption, dur);
            activeCaptions.set(thread.id, { guildId, channelId: interaction.channelId, threadId: thread.id, participants: new Set(), pointValues: parsePointValues(ptsOpt, '5'), timeoutHandle: setTimeout(() => triggerCaptionEnd(client, thread.id), dur * 60000) });
            activeCaptions.get(thread.id).announcementMessage = await sendGlobalAnnouncement(client, guildId, `A Caption Contest has started in <#${interaction.channelId}>! Ends in **${dur} minutes**.`, thread.id);
        } catch (error) {
            console.error('CRITICAL: Thread creation failed:', error);
        }
    };

    if (repeatHrs > 0) {
        const user = await getUser(guildId, interaction.user.id);
        if (!user.isPremium) return interaction.editReply({ content: "❌ **Recurring Games** are a Premium feature! Use `/premium` to unlock the Autopilot system." });

        const nextRun = new Date(Date.now() + delay + (repeatHrs * 3600000));
        throwIfGameSchedulingBlocked(nextRun.getTime());
        await RecurringGame.create({
            guildId,
            channelId: interaction.channelId,
            type: 'caption',
            intervalHours: repeatHrs,
            data: { dur, ptsOpt, threadName },
            nextRun
        });
        await interaction.editReply({ content: `✅ Caption Contest scheduled to repeat every **${repeatHrs} hours**!` });
        if (delay === 0) await start();
    } else if (delay > 0) {
        const sid = await scheduleGameFn(guildId, 'Caption Contest', interaction.channelId, delay, start);
        await interaction.editReply({ content: `Scheduled! (ID: \`${sid}\`)` });
        announceScheduledGame(client, guildId, 'Caption Contest', delay);
    }
    else { await start(); await interaction.editReply({ content: "Caption contest started!" }); }
}

async function handleCaptionMessage(m) {
    const activeCaption = activeCaptions.get(m.channel.id);
    if (activeCaption) {
        if (activeCaption.participants.has(m.author.id)) {
            try {
                await m.delete();
                const warningMsg = await m.channel.send(`<@${m.author.id}>, you can only submit one caption!`);
                setTimeout(() => warningMsg.delete().catch(()=>{}), 5000);
            } catch(e) {}
            return true; // Handled
        }
        activeCaption.participants.add(m.author.id);
        void updateActiveGame(m.channel.id, (s) => {
            s.participants = Array.from(activeCaption.participants);
        }).catch((e) => console.error('[persist CaptionContest participants]', e));
        const emojis = ['😂', '🔥', '👍', '🤯', '❤️'];
        for (const emoji of emojis) {
            await m.react(emoji).catch(()=>{});
        }
        return true; // Handled
    }
    return false;
}

function forceEndCaption(channelId, client) {
    if (activeCaptions.has(channelId)) {
        triggerCaptionEnd(client, channelId);
        return true;
    }
    return false;
}

module.exports = {
    triggerCaptionEnd,
    handleCaptionCommand,
    handleCaptionMessage,
    forceEndCaption,
    activeCaptions
};
