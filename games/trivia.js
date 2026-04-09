const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { parsePointValues, defaultGameThreadName } = require('../lib/utils');
const { fetchOpenTdbMultipleChoice } = require('../lib/openTriviaFetch');
const {
    createHostedGamePublicThread,
    finalizeHostedGameThread,
    getSlashScheduleDelayMs,
} = require('../lib/gameThreadLifecycle');
const { DEFAULT_PLACEMENT_POINTS, DEFAULT_PARTICIPATION_POINTS } = require('../lib/gamePointsDefaults');
const { recurringIntervalMs, splitRecurringParts } = require('../lib/recurringInterval');
const { addScore, updateUser, updateActiveGame, createActiveGame, getUser, getSystemConfig, updateSystemConfig, endActiveGame } = require('../lib/db');
const { clampHostGameInt, sessionHasHostAura } = require('../lib/premiumPerks');
const { tryHostPremiumNudge, sendPremiumBoostSessionHint } = require('../lib/premiumUpsell');
const { registerAuraBoostTarget, unregisterAuraBoostTarget } = require('../lib/auraBoostRegistry');
const { auraBoostRow } = require('../lib/gameAuraButton');
const { makeGameFlairEmbed } = require('../lib/gameFlair');
const { awardAchievement, milestoneAchievementKeys } = require('../lib/achievements');
const { announceWinner, sendGlobalAnnouncement, announceScheduledGame } = require('../lib/announcements');
const { appendPremiumGameResultFooter, sendGameEndPremiumUpsell } = require('../lib/premiumUpsell');
const { sendInviteViralNudgeIfAllowed } = require('../lib/referrals');
const {
    throwIfGameSchedulingBlocked,
    throwIfImmediateGameStartBlockedByMaintenance,
} = require('../lib/maintenanceScheduling');
const { Game, RecurringGame } = require('../models');
const { getFactionChallengeStaffOverlapSuffix } = require('../lib/factionChallengeHostWarning');

const activeTrivias = new Map();

async function triggerTriviaMatchEnd(client, channel) {
    const activeTrivia = activeTrivias.get(channel.id);
    if (!activeTrivia) return;
    const guildId = activeTrivia.guildId;
    const hostAura = sessionHasHostAura(activeTrivia);
    unregisterAuraBoostTarget(channel.id);
    let res = `🏁 **Trivia Match Ended!**

`;
    let winnerText = "No scores!";
    
    if (activeTrivia.announcementMessage) {
        try { await activeTrivia.announcementMessage.delete(); } catch(e) {}
    }
    
    const sorted = Object.entries(activeTrivia.scores).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
        const topScore = Number(sorted[0][1] || 0);
        winnerText = topScore > 0
            ? `Winner: <@${sorted[0][0]}> with **${topScore}** correct answers!`
            : 'No winners this round.';
        const podiumIds = new Set();
        sorted.forEach(([uid, score], i) => {
            const pts = i < activeTrivia.pointValues.length ? activeTrivia.pointValues[i] : DEFAULT_PARTICIPATION_POINTS;
            res += `${i + 1}. <@${uid}> - **${score}** correct (+${pts} pts)\n`;
            if (pts > 0) {
                addScore(client, guildId, uid, pts, null, hostAura, 'trivia');
                podiumIds.add(uid);
            }
            if (i === 0 && topScore > 0) {
                awardAchievement(client, guildId, channel, uid, 'FIRST_WIN');
                updateUser(guildId, uid, u => {
                    u.stats.gamesWon = (u.stats.gamesWon || 0) + 1;
                    u.stats.triviaWins = (u.stats.triviaWins || 0) + 1;
                    for (const key of milestoneAchievementKeys('triviaWins', u.stats.triviaWins)) {
                        awardAchievement(client, guildId, channel, uid, key);
                    }
                });
            }
        });
        if (activeTrivia.players) {
            activeTrivia.players.forEach((pid) => {
                if (!podiumIds.has(pid)) {
                    addScore(client, guildId, pid, DEFAULT_PARTICIPATION_POINTS, null, false, 'trivia');
                }
            });
        }
    } else {
        res += winnerText;
        if (activeTrivia.players) {
            activeTrivia.players.forEach((pid) => {
                addScore(client, guildId, pid, DEFAULT_PARTICIPATION_POINTS, null, false, 'trivia');
            });
        }
    }
    await announceWinner(client, guildId, 'Trivia Match', winnerText, activeTrivia.channelId);
    const triviaIds = [...new Set([...Object.keys(activeTrivia.scores || {}), ...(activeTrivia.players || [])])];
    res = appendPremiumGameResultFooter(res);
    if (channel) {
        await channel.send(res);
        await sendGameEndPremiumUpsell(client, channel, guildId, triviaIds, {
            gameType: 'Trivia',
            sessionId: channel.id,
        });
        await sendInviteViralNudgeIfAllowed(guildId, channel);
        await finalizeHostedGameThread(channel, { disableComponents: true });
    }
    activeTrivias.delete(channel.id);
    await endActiveGame(channel.id, client).catch(() => {});
}

async function nextTriviaQuestion(client, channel) {
    const activeTrivia = activeTrivias.get(channel.id);
    if (!activeTrivia) return;
    const questionMs = Math.max(10000, Math.min((activeTrivia.questionSeconds ?? 30) * 1000, 900000));
    const breakMs = Math.max(0, Math.min((activeTrivia.breakSeconds ?? 20) * 1000, 300000));
    
    if (activeTrivia.currentQuestion >= activeTrivia.totalQuestions) {
        await triggerTriviaMatchEnd(client, channel);
        return;
    }
    
    activeTrivia.currentQuestion++;
    
    try {
        const [triviaQ] = await fetchOpenTdbMultipleChoice(1, {
            category: activeTrivia.category,
            difficulty: activeTrivia.difficulty,
        });
        if (!triviaQ) throw new Error('No questions returned.');

        const question = triviaQ.question;
        const correct = triviaQ.correct;
        const answers = triviaQ.answers;
        const answerRow = new ActionRowBuilder();
        answers.forEach((ans, i) => {
            answerRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`trivia_${i}`)
                    .setLabel(ans.substring(0, 80))
                    .setStyle(ButtonStyle.Primary),
            );
        });
        const msg = await channel.send({
            content: `🧠 **Trivia Round ${activeTrivia.currentQuestion}/${activeTrivia.totalQuestions}!** First correct answer wins the round.

**${question}**`,
            components: [answerRow],
        });
        const collector = msg.createMessageComponentCollector({ filter: i => i.customId.startsWith('trivia_'), time: questionMs });
        
        const guesses = new Map(); // Store { userId: { choice, timestamp } }
        const guessedUsers = new Set();
        const roundInteractions = [];

        collector.on('collect', async i => {
            if (guessedUsers.has(i.user.id)) {
                await i.reply({ content: `❌ You already guessed for this question!`, ephemeral: true });
                roundInteractions.push(i);
                return;
            }
            
            guessedUsers.add(i.user.id);
            const picked = answers[parseInt(i.customId.split('_')[1])];
            guesses.set(i.user.id, { choice: picked, timestamp: i.createdTimestamp });
            const tr = activeTrivias.get(channel.id);
            if (tr && tr.players) tr.players.add(i.user.id);

            void updateActiveGame(activeTrivia.threadId, (state) => {
                state.participants = Array.from(activeTrivia.players || []);
            }).catch((e) => console.error('[persist Trivia participants]', e));

            await i.reply({ content: '✅ Your answer has been recorded!', ephemeral: true });
            roundInteractions.push(i);
        });

        collector.on('end', async () => {
            roundInteractions.forEach(it => it.deleteReply().catch(() => {}));

            activeTrivia.consecutiveUnanswered++;

            let winnerId = null;
            let earliestTime = Infinity;

            for (const [userId, guess] of guesses.entries()) {
                if (guess.choice === correct && guess.timestamp < earliestTime) {
                    winnerId = userId;
                    earliestTime = guess.timestamp;
                }
            }

            const disabledRow = new ActionRowBuilder();
            answerRow.components.forEach((btn, idx) => {
                const newBtn = ButtonBuilder.from(btn).setDisabled(true);
                if (answers[idx] === correct) {
                    newBtn.setStyle(ButtonStyle.Success);
                } else {
                    let wasPickedIncorrectly = false;
                    for(const guess of guesses.values()){
                        if(guess.choice === answers[idx]){
                            wasPickedIncorrectly = true;
                            break;
                        }
                    }
                    if(wasPickedIncorrectly) newBtn.setStyle(ButtonStyle.Danger);
                }
                disabledRow.addComponents(newBtn);
            });
            
            if (winnerId) {
                activeTrivia.consecutiveUnanswered = 0;
                activeTrivia.scores[winnerId] = (activeTrivia.scores[winnerId] || 0) + 1;
                
                updateActiveGame(activeTrivia.threadId, state => {
                    state.currentQuestion = activeTrivia.currentQuestion;
                    state.scores = activeTrivia.scores;
                    state.consecutiveUnanswered = 0;
                    state.participants = Array.from(activeTrivia.players || []);
                });
                
                const breakSec = Math.round(breakMs / 1000);
                await msg.edit({
                    content:
                        `✅ <@${winnerId}> was the first to answer correctly! They have **${activeTrivia.scores[winnerId]}** points.\n\n` +
                        `—\n\n` +
                        `_Next round in ${breakSec} second${breakSec === 1 ? '' : 's'}…_`,
                    components: [disabledRow],
                });
                setTimeout(() => nextTriviaQuestion(client, channel), breakMs);
            } else {
                updateActiveGame(activeTrivia.threadId, state => {
                    state.currentQuestion = activeTrivia.currentQuestion;
                    state.consecutiveUnanswered = activeTrivia.consecutiveUnanswered;
                    state.participants = Array.from(activeTrivia.players || []);
                });

                const breakSec2 = Math.round(breakMs / 1000);
                await msg.edit({
                    content:
                        `⏰ Time's up! The correct answer was **${correct}**. No one got it right this time.\n\n` +
                        `—\n\n` +
                        `_Next round in ${breakSec2} second${breakSec2 === 1 ? '' : 's'}…_`,
                    components: [disabledRow],
                }).catch(()=>{});
                if (activeTrivia && activeTrivia.consecutiveUnanswered >= 3) {
                    await channel.send("💤 3 questions went unanswered. Trivia match ended!");
                    await triggerTriviaMatchEnd(client, channel);
                } else if (activeTrivia) {
                    setTimeout(() => nextTriviaQuestion(client, channel), breakMs);
                }
            }
        });
    } catch (e) { 
        console.error("Trivia question fetch error:", e);
        if (activeTrivia) {
            activeTrivia.consecutiveUnanswered++;
            if (activeTrivia.consecutiveUnanswered >= 3) {
                await channel.send("⚠️ Failed to fetch trivia questions 3 times. Trivia match ended!").catch(()=>{});
                await triggerTriviaMatchEnd(client, channel);
            } else {
                const retryMs = Math.max(5000, breakMs || 20000);
                await channel.send(`⚠️ Failed to fetch a trivia question. Retrying in ${Math.round(retryMs / 1000)} seconds...`).catch(()=>{});
                setTimeout(() => nextTriviaQuestion(client, channel), retryMs);
            }
        }
    }
}

async function startTriviaGame(
    client,
    guildId,
    channelId,
    diff,
    cat,
    qCount,
    pts,
    threadName,
    slowMode,
    hostIsPremium = false,
    questionSeconds = 30,
    breakSeconds = 20,
) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return;
        const qs = Math.max(10, Math.min(Number(questionSeconds) || 30, 900));
        const bs = Math.max(0, Math.min(Number(breakSeconds) || 20, 300));
        const triviaEstMs = 3000 + qCount * (qs * 1000 + bs);
        throwIfImmediateGameStartBlockedByMaintenance(Date.now(), triviaEstMs);

        const thread = await createHostedGamePublicThread(channel, threadName);
        if (slowMode > 0) await thread.setRateLimitPerUser(slowMode).catch(()=>{});

        const state = {
            difficulty: diff,
            category: cat,
            scores: {},
            consecutiveUnanswered: 0,
            totalQuestions: qCount,
            currentQuestion: 0,
            pointValues: parsePointValues(pts, DEFAULT_PLACEMENT_POINTS),
            participants: [],
        };
        await createActiveGame(guildId, channelId, thread.id, 'Trivia', state, 0, hostIsPremium, {
            maintenanceEstimatedDurationMs: triviaEstMs,
        });

        activeTrivias.set(thread.id, { guildId,
            channelId: channelId, threadId: thread.id, difficulty: diff, category: cat,
            scores: {}, consecutiveUnanswered: 0, totalQuestions: qCount, currentQuestion: 0,
            pointValues: parsePointValues(pts, DEFAULT_PLACEMENT_POINTS), hostIsPremium, premiumAuraBoost: false, players: new Set(),
            questionSeconds: qs, breakSeconds: bs });
        registerAuraBoostTarget(thread.id, () => {
            const t = activeTrivias.get(thread.id);
            if (t) t.premiumAuraBoost = true;
        });
        activeTrivias.get(thread.id).announcementMessage = await sendGlobalAnnouncement(
            client,
            guildId,
            `A Trivia Match has started in <#${channelId}>! **${qCount}** questions · **${qs}s** per question · **${bs}s** between rounds.`,
            thread.id,
        );
        await thread.send({ embeds: [makeGameFlairEmbed('trivia')], components: [auraBoostRow(thread.id)] }).catch(() => {});
        setTimeout(() => nextTriviaQuestion(client, thread), 2000);
        return thread.id;
    } catch (err) {
        console.error("Error starting Trivia:", err);
    }
    return null;
}

module.exports = {
    startTriviaGame,
    async handleInteraction(interaction, client) {
        if (!interaction.isChatInputCommand()) return false;

        if (interaction.commandName === 'trivia') {
            await interaction.deferReply({ ephemeral: true });

            const guildId = interaction.guildId;
            const diff = interaction.options.getString('difficulty') || 'medium';
            const cat = interaction.options.getString('category') || 'any';
            const hostUser = await getUser(guildId, interaction.user.id);
            const qCount = clampHostGameInt(interaction.options.getInteger('questions') || 5, hostUser.isPremium, 'triviaQuestions');
            const pts = interaction.options.getString('points') || DEFAULT_PLACEMENT_POINTS;
            const threadName = interaction.options.getString('thread_name') || defaultGameThreadName('Trivia Match');
            const delay = getSlashScheduleDelayMs(interaction);
            const slowMode = interaction.options.getInteger('slow_mode') || 0;
            const repeatHrs = interaction.options.getInteger('repeat_hrs') || 0;
            const repeatDays = interaction.options.getInteger('repeat_days') || 0;
            const questionSeconds = interaction.options.getInteger('question_seconds') ?? 30;
            const breakSeconds = interaction.options.getInteger('break_seconds') ?? 20;

            const start = async () => {
                await startTriviaGame(
                    client,
                    guildId,
                    interaction.channelId,
                    diff,
                    cat,
                    qCount,
                    pts,
                    threadName,
                    slowMode,
                    hostUser.isPremium === true,
                    questionSeconds,
                    breakSeconds,
                );
            };

            const repeatMs = recurringIntervalMs({ repeat_days: repeatDays, repeat_hrs: repeatHrs });
            if (repeatMs > 0) {
                if (!hostUser.isPremium) return interaction.editReply({ content: "❌ **Recurring Games** are a Premium feature! Use `/premium` to unlock the Autopilot system." });

                const nextRun = new Date(Date.now() + delay + repeatMs);
                throwIfGameSchedulingBlocked(nextRun.getTime());
                const { intervalDays, intervalHours } = splitRecurringParts({ repeat_days: repeatDays, repeat_hrs: repeatHrs });
                await RecurringGame.create({
                    guildId,
                    channelId: interaction.channelId,
                    type: 'trivia',
                    intervalDays,
                    intervalHours,
                    data: {
                        diff,
                        cat,
                        qCount,
                        pts,
                        threadName,
                        slowMode,
                        hostIsPremium: hostUser.isPremium === true,
                        questionSeconds,
                        breakSeconds,
                    },
                    nextRun
                });
                const fcSuf = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, delay, 'trivia');
                const iv =
                    (intervalDays ? `**${intervalDays}** day(s) ` : '') + (intervalHours ? `**${intervalHours}** hour(s)` : '');
                await interaction.editReply({ content: `✅ Trivia scheduled to repeat every ${iv.trim()}!${fcSuf}` });
                if (delay === 0) await start();
            } else if (delay > 0) {
                 throwIfGameSchedulingBlocked(Date.now() + delay);
                 const id = Math.random().toString(36).substring(2, 9).toUpperCase();
                 const startTime = new Date(Date.now() + delay);
    
                await Game.create({
                    guildId,
                    channelId: interaction.channelId,
                    type: 'Scheduled_Trivia',
                    status: 'scheduled',
                    startTime,
                    state: { sid: id, originalType: 'Trivia' }
                });

                setTimeout(async () => {
                    await Game.findOneAndUpdate({ 'state.sid': id }, { status: 'ended' });
                    await start();
                }, delay);

                const fcSuf2 = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, delay, 'trivia');
                await interaction.editReply({ content: `Scheduled! (ID: \`${id}\`)${fcSuf2}` });
                announceScheduledGame(client, guildId, 'Trivia Match', delay);
            }
            else {
                const tid = await start();
                const fcSuf3 = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, 0, 'trivia');
                await interaction.editReply({ content: `Trivia started!${fcSuf3}` });
                if (tid) {
                    const th = await client.channels.fetch(tid).catch(() => null);
                    if (th) {
                        await tryHostPremiumNudge(interaction, hostUser, {
                            gameType: 'Trivia',
                            supportsRepeatHrs: true,
                            supportsPremiumCaps: true,
                        }).catch(() => {});
                        await sendPremiumBoostSessionHint(th, hostUser.isPremium === true, {
                            guildId,
                            hostUserId: interaction.user.id,
                            gameType: 'Trivia',
                            sessionId: th.id,
                            hasAura: false,
                        }).catch(() => {});
                    }
                }
            }

            return true;
        }

        return false;
    },
    forceEnd(client, threadId) {
        if (activeTrivias.has(threadId)) {
            triggerTriviaMatchEnd(client, { id: threadId });
            return true;
        }
        return false;
    }
};
