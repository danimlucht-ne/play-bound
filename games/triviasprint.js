const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { parsePointValues, defaultGameThreadName } = require('../lib/utils');
const { fetchOpenTdbMultipleChoice } = require('../lib/openTriviaFetch');
const {
    createHostedGamePublicThread,
    finalizeHostedGameThread,
    getSlashScheduleDelayMs,
} = require('../lib/gameThreadLifecycle');
const { DEFAULT_PLACEMENT_POINTS, DEFAULT_PARTICIPATION_POINTS } = require('../lib/gamePointsDefaults');
const { makeGameFlairEmbed } = require('../lib/gameFlair');
const { addScore, updateUser, createActiveGame, getUser } = require('../lib/db');
const { syncGameScores, clearSyncTimer } = require('../lib/gameScoreSync');
const { throwIfImmediateGameStartBlockedByMaintenance } = require('../lib/maintenanceScheduling');
const { awardAchievement, milestoneAchievementKeys } = require('../lib/achievements');
const { announceWinner, sendGlobalAnnouncement, announceScheduledGame } = require('../lib/announcements');
const { sessionHasHostAura } = require('../lib/premiumPerks');

const activeSprints = new Map();

async function triggerTriviaSprintEnd(client, threadId) {
    const activeSprint = activeSprints.get(threadId);
    if (!activeSprint) return;
    const guildId = activeSprint.guildId;
    const hostAura = sessionHasHostAura(activeSprint);
    if (activeSprint.announcementMessage) {
        try { await activeSprint.announcementMessage.delete(); } catch(e) {}
    }
    const thread = client.channels.cache.get(activeSprint.threadId);
    let res = `🏃 **Sprint Results:**\n`;
    let winnerText = "No finishers!";
    
    // Convert players object to sorted array
    const players = Object.entries(activeSprint.players)
        .filter(([u, p]) => p.timeTaken !== null)
        .sort((a, b) => {
            if (b[1].score !== a[1].score) return b[1].score - a[1].score;
            return a[1].timeTaken - b[1].timeTaken;
        });

    if (players.length > 0) {
        winnerText = `🏆 **Winner:** <@${players[0][0]}> with **${players[0][1].score}/${activeSprint.targetScore}** correct in **${(players[0][1].timeTaken / 1000).toFixed(1)}s**!`;
        players.forEach(([uid, p], i) => {
            const time = (p.timeTaken / 1000).toFixed(1);
            const pts = i < activeSprint.pointValues.length ? activeSprint.pointValues[i] : DEFAULT_PARTICIPATION_POINTS;
            res += `${i + 1}. <@${uid}> - **${p.score}/${activeSprint.targetScore}** (${time}s) (+${pts} pts)\n`;
            if (pts > 0) {
                addScore(client, guildId, uid, pts, null, hostAura, 'triviasprint');
            }
            if (p.timeTaken < 60000) awardAchievement(client, guildId, thread, uid, "SPEED_DEMON");
            
            if (i === 0) {
                awardAchievement(client, guildId, thread, uid, "FIRST_WIN");
                updateUser(guildId, uid, u => {
                    u.stats.gamesWon = (u.stats.gamesWon || 0) + 1;
                    u.stats.sprintWins = (u.stats.sprintWins || 0) + 1;
                    for (const key of milestoneAchievementKeys('sprintWins', u.stats.sprintWins)) {
                        awardAchievement(client, guildId, thread, uid, key);
                    }
                });
            }
        });
    } else {
        res += winnerText;
    }
    const placed = new Set(players.map(([uid]) => uid));
    for (const pid of Object.keys(activeSprint.players)) {
        if (!placed.has(pid)) {
            addScore(client, guildId, pid, DEFAULT_PARTICIPATION_POINTS, null, hostAura, 'triviasprint');
        }
    }
    await announceWinner(client, guildId, 'Trivia Sprint', winnerText, activeSprint.channelId);
    if (thread) {
        await thread.send(res);
        await finalizeHostedGameThread(thread, { disableComponents: true });
    }
    clearTimeout(activeSprint.timeoutHandle); activeSprints.delete(threadId);
    clearSyncTimer(threadId);
}

async function handleTriviaSprintCommand(interaction, client, scheduleGameFn) {
    const guildId = interaction.guildId;
    const dur = interaction.options.getInteger('duration');
    const qCount = Math.min(Math.max(interaction.options.getInteger('questions') || 15, 1), 50);
    const diff = interaction.options.getString('difficulty') || 'any';
    const cat = interaction.options.getString('category') || 'any';
    const pts = interaction.options.getString('points') || DEFAULT_PLACEMENT_POINTS;
    const threadName = interaction.options.getString('thread_name') || defaultGameThreadName('Trivia Sprint');
    const delay = getSlashScheduleDelayMs(interaction);
    await interaction.deferReply({ ephemeral: true });

    const start = async () => {
        let questions;
        try {
            questions = await fetchOpenTdbMultipleChoice(qCount, { category: cat, difficulty: diff });
        } catch (e) {
            console.error('[triviasprint] OpenTDB fetch failed', e);
            return;
        }
        if (!questions || questions.length === 0) return;

        throwIfImmediateGameStartBlockedByMaintenance(Date.now(), dur * 60000);
        const thread = await createHostedGamePublicThread(interaction.channel, threadName);
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('sprint_start').setLabel('🏃 Start Sprint').setStyle(ButtonStyle.Success));
        await thread.send({ content: `🏃 **Trivia Sprint Started!**\nAnswer ${qCount} questions as fast as possible!\nYou have **${dur} minutes** to finish.`, components: [row] });

        const game_state_sprint = { questions, targetScore: qCount, pointValues: parsePointValues(pts, DEFAULT_PLACEMENT_POINTS), players: {} };
        await createActiveGame(guildId, interaction.channelId, thread.id, 'TriviaSprint', game_state_sprint, dur);
        activeSprints.set(thread.id, { guildId, channelId: interaction.channelId, threadId: thread.id, questions, targetScore: qCount, pointValues: parsePointValues(pts, DEFAULT_PLACEMENT_POINTS), players: {}, timeoutHandle: setTimeout(() => triggerTriviaSprintEnd(client, thread.id), dur * 60000) });
        activeSprints.get(thread.id).announcementMessage = await sendGlobalAnnouncement(client, guildId, `A Trivia Sprint has started in <#${interaction.channelId}>! Ends in **${dur} minutes**.`, thread.id);
    };

    if (delay > 0) {
        const sid = await scheduleGameFn(guildId, 'Trivia Sprint', interaction.channelId, delay, start);
        await interaction.editReply({ content: `Scheduled! (ID: \`${sid}\`)` });
        announceScheduledGame(client, guildId, 'Trivia Sprint', delay);
    }
    else {
        await start();
        if (activeSprints.has(interaction.channelId) || Array.from(activeSprints.values()).some(s => s.channelId === interaction.channelId)) {
            await interaction.editReply({ content: "Sprint started!" });
        } else {
            await interaction.editReply({ content: "Failed to fetch questions. Try again later." });
        }
    }
}

async function handleTriviaSprintButton(interaction, client) {
    const guildId = interaction.guildId;
    
    if (interaction.customId === 'sprint_start') {
        const activeSprint = activeSprints.get(interaction.channelId);
        if (!activeSprint) return interaction.reply({ content: 'This game has already ended!', ephemeral: true }), true;
        let player = activeSprint.players[interaction.user.id];
        if (player?.timeTaken) return interaction.reply({ content: 'You have already finished!', ephemeral: true }), true;
        if (!player) {
            player = activeSprint.players[interaction.user.id] = { startTime: Date.now(), score: 0, timeTaken: null, qIndex: 0 };
        }
        
        const user = await getUser(guildId, interaction.user.id);
        const hasSkip = user.inventory && user.inventory.includes('trivia_skip');
        
        const q = activeSprint.questions[player.qIndex]; 
        const row = new ActionRowBuilder();
        q.answers.forEach((ans, i) => row.addComponents(new ButtonBuilder().setCustomId(`sprintans_${i}`).setLabel(ans.substring(0,80)).setStyle(ButtonStyle.Primary)));
        
        if (hasSkip) {
            row.addComponents(new ButtonBuilder().setCustomId('sprint_skip').setLabel('⏭️ Skip (Uses Item)').setStyle(ButtonStyle.Secondary));
        }
        
        await interaction.reply({ content: `**Q${player.qIndex + 1}**\n\n**${q.question}**`, components: [row], ephemeral: true });
        return true;
    }
    
    if (interaction.customId === 'sprint_skip') {
        const activeSprint = activeSprints.get(interaction.channelId);
        if (!activeSprint) return interaction.reply({ content: 'Game ended!', ephemeral: true }), true;
        const p = activeSprint.players[interaction.user.id];
        if (!p || p.timeTaken) return interaction.reply({ content: 'Finished!', ephemeral: true }), true;
        
        const user = await getUser(guildId, interaction.user.id);
        const skipIdx = user.inventory.indexOf('trivia_skip');
        if (skipIdx === -1) return interaction.reply({ content: 'No Skip items left!', ephemeral: true }), true;
        
        user.inventory.splice(skipIdx, 1);
        await user.save();

        p.qIndex++;
        if (p.qIndex >= activeSprint.questions.length) {
            p.timeTaken = Date.now() - p.startTime;
            return interaction.update({ content: `⏭️ Skipped to the end!\n\n🏁 **FINISHED!** Score: ${p.score}/${activeSprint.targetScore}\nTime: ${(p.timeTaken/1000).toFixed(1)}s`, components: [] }), true;
        }

        const nq = activeSprint.questions[p.qIndex]; 
        const row = new ActionRowBuilder();
        nq.answers.forEach((ans, i) => row.addComponents(new ButtonBuilder().setCustomId(`sprintans_${i}`).setLabel(ans.substring(0,80)).setStyle(ButtonStyle.Primary)));
        
        const hasMoreSkips = user.inventory.includes('trivia_skip');
        if (hasMoreSkips) {
            row.addComponents(new ButtonBuilder().setCustomId('sprint_skip').setLabel('⏭️ Skip (Uses Item)').setStyle(ButtonStyle.Secondary));
        }
        
        await interaction.update({ content: `⏭️ Skipped!\n\n**Q${p.qIndex+1}**\n\n**${nq.question}**`, components: [row] });
        return true;
    }
    
    if (interaction.customId.startsWith('sprintans_')) {
        const activeSprint = activeSprints.get(interaction.channelId);
        if (!activeSprint) return interaction.reply({ content: 'This game has already ended!', ephemeral: true }), true;
        const p = activeSprint.players[interaction.user.id];
        if (!p || p.timeTaken) return interaction.reply({ content: 'You have already finished!', ephemeral: true }), true;
        const q = activeSprint.questions[p.qIndex]; 
        const pk = parseInt(interaction.customId.split('_')[1]);
        let f = q.answers[pk] === q.correct ? (p.score++, `✅`) : `❌ (${q.correct})`;
        
        if (p.score >= activeSprint.targetScore || p.qIndex === activeSprint.questions.length - 1) {
            p.timeTaken = Date.now() - p.startTime;
            const scoreText = p.score >= activeSprint.targetScore ? "🎉 **PERFECT SCORE!**" : `🏁 **FINISHED!** Score: ${p.score}/${activeSprint.targetScore}`;
            return interaction.update({ content: `${f}\n\n${scoreText}\nTime: ${(p.timeTaken/1000).toFixed(1)}s`, components: [] }), true;
        }

        p.qIndex++; 
        const nq = activeSprint.questions[p.qIndex]; 
        const row = new ActionRowBuilder();
        nq.answers.forEach((ans, i) => row.addComponents(new ButtonBuilder().setCustomId(`sprintans_${i}`).setLabel(ans.substring(0,80)).setStyle(ButtonStyle.Primary)));
        
        const user = await getUser(guildId, interaction.user.id);
        if (user.inventory && user.inventory.includes('trivia_skip')) {
            row.addComponents(new ButtonBuilder().setCustomId('sprint_skip').setLabel('⏭️ Skip (Uses Item)').setStyle(ButtonStyle.Secondary));
        }
        
        await interaction.update({ content: `${f}\n\n**Q${p.qIndex+1}**\n\n**${nq.question}**`, components: [row] });
        syncGameScores(activeSprint.threadId, activeSprint);
        return true;
    }

    return false;
}

function forceEndTriviaSprint(channelId, client) {
    if (activeSprints.has(channelId)) {
        triggerTriviaSprintEnd(client, channelId);
        return true;
    }
    return false;
}

module.exports = {
    handleTriviaSprintCommand,
    handleTriviaSprintButton,
    triggerTriviaSprintEnd,
    forceEndTriviaSprint,
    activeSprints
};
