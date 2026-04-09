const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const { Game, RecurringGame, Word } = require('../models');
const { parsePointValues, defaultGameThreadName } = require('../lib/utils');
const {
    createHostedGamePublicThread,
    finalizeHostedGameThread,
    getSlashScheduleDelayMs,
} = require('../lib/gameThreadLifecycle');
const { sessionHasHostAura } = require('../lib/premiumPerks');
const { registerAuraBoostTarget, unregisterAuraBoostTarget } = require('../lib/auraBoostRegistry');
const { auraBoostRow } = require('../lib/gameAuraButton');
const { makeGameFlairEmbed } = require('../lib/gameFlair');
const { addScore, updateUser, createActiveGame, updateActiveGame, getUser, endActiveGame } = require('../lib/db');
const { awardAchievement, milestoneAchievementKeys } = require('../lib/achievements');
const { announceWinner, sendGlobalAnnouncement, announceScheduledGame } = require('../lib/announcements');
const {
    appendPremiumGameResultFooter,
    sendGameEndPremiumUpsell,
    tryHostPremiumNudge,
    sendPremiumBoostSessionHint,
} = require('../lib/premiumUpsell');
const { sendInviteViralNudgeIfAllowed } = require('../lib/referrals');
const { getFactionChallengeStaffOverlapSuffix } = require('../lib/factionChallengeHostWarning');
const {
    throwIfGameSchedulingBlocked,
    throwIfImmediateGameStartBlockedByMaintenance,
} = require('../lib/maintenanceScheduling');
const { recurringIntervalMs, splitRecurringParts } = require('../lib/recurringInterval');
const { DEFAULT_SERVERDLE_PLACEMENT, DEFAULT_PARTICIPATION_POINTS } = require('../lib/gamePointsDefaults');

const activeServerdles = new Map();
let WORDS = ["APPLE", "BRAIN", "CRANE", "DANCE", "EAGLE"];

async function loadWordData() {
    try {
        const wordsFromDb = await Word.find({});
        if (wordsFromDb.length > 0) {
            const five = wordsFromDb.filter(
                (w) => typeof w.word === 'string' && /^[A-Za-z]{5}$/.test(w.word.trim()),
            );
            if (five.length > 0) {
                WORDS = five.map((w) => w.word.toUpperCase());
            }
        }
    } catch (err) {
        console.error('Failed to load words for Serverdle:', err);
    }
}
loadWordData();


async function generateServerdleImage(guesses) {
    const tileSize = 64;
    const gap = 10;
    const cols = 5;
    const rows = 6;
    const paddingX = 18;
    const paddingTop = 18;
    const paddingBottom = 22;
    const boardWidth = cols * tileSize + (cols - 1) * gap;
    const boardHeight = rows * tileSize + (rows - 1) * gap;
    const canvas = createCanvas(boardWidth + paddingX * 2, boardHeight + paddingTop + paddingBottom);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#121213';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const guess = guesses[row];
            const x = paddingX + col * (tileSize + gap);
            const y = paddingTop + row * (tileSize + gap);

            if (guess) {
                const char = guess.word[col];
                const emoji = [...guess.emojis][col];

                if (emoji === '????') ctx.fillStyle = '#538d4e';
                else if (emoji === '????') ctx.fillStyle = '#b59f3b';
                else ctx.fillStyle = '#3a3a3c';

                ctx.fillRect(x, y, tileSize, tileSize);
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 38px Arial';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(char, x + tileSize / 2, y + tileSize / 2 + 1);
            } else {
                ctx.strokeStyle = '#3a3a3c';
                ctx.lineWidth = 2;
                ctx.strokeRect(x, y, tileSize, tileSize);
            }
        }
    }
    return canvas.toBuffer('image/png');
}

async function triggerServerdleEnd(client, threadId) {
    const activeServerdle = activeServerdles.get(threadId);
    if (!activeServerdle) return;
    const guildId = activeServerdle.guildId;
    const hostAura = sessionHasHostAura(activeServerdle);
    unregisterAuraBoostTarget(threadId);

    if (activeServerdle.announcementMessage) {
        try { await activeServerdle.announcementMessage.delete(); } catch(e) {}
    }
    let res = `🟩 **Serverdle Ended!** Word: **${activeServerdle.word}**

`;
    let winnerText = "";
    const thread = client.channels.cache.get(activeServerdle.threadId);

    if (activeServerdle.winners.length > 0) {
        activeServerdle.winners.sort((a, b) => {
            if (a.guesses !== b.guesses) return a.guesses - b.guesses;
            return a.timestamp - b.timestamp;
        });

        res += `**Final Results:**\n`;
        for (let i = 0; i < activeServerdle.winners.length; i++) {
            const w = activeServerdle.winners[i];
            const pts = i < activeServerdle.pointValues.length ? activeServerdle.pointValues[i] : 1;
            if (pts > 0) {
                await addScore(client, guildId, w.userId, pts, null, hostAura, 'serverdle');
            }
            res += `${i + 1}. <@${w.userId}> - **${w.guesses} guesses** (+${pts} pts)\n`;
            if (i === 0) {
                awardAchievement(client, guildId, thread, w.userId, "FIRST_WIN");
                winnerText = `🏆 **1st Place:** <@${w.userId}> with **${w.guesses}** guesses!`;
                updateUser(guildId, w.userId, u => {
                    u.stats.gamesWon = (u.stats.gamesWon || 0) + 1;
                    u.stats.serverdleWins = (u.stats.serverdleWins || 0) + 1;
                    for (const key of milestoneAchievementKeys('serverdleWins', u.stats.serverdleWins)) {
                        awardAchievement(client, guildId, thread, w.userId, key);
                    }
                });
            }
        }
    } else {
        winnerText = "No winners!";
        res += winnerText;
    }
    
    const placedIds = new Set(activeServerdle.winners.map((w) => w.userId));
    for (const pid of Object.keys(activeServerdle.players)) {
        if (placedIds.has(pid)) continue;
        if (DEFAULT_PARTICIPATION_POINTS > 0) {
            addScore(client, guildId, pid, DEFAULT_PARTICIPATION_POINTS, null, hostAura, 'serverdle');
        }
    }
    await announceWinner(client, guildId, 'Serverdle', winnerText, activeServerdle.channelId);
    const sdIds = [...Object.keys(activeServerdle.players || {})];
    res = appendPremiumGameResultFooter(res);
    if (thread) {
        await thread.send(res);
        await sendGameEndPremiumUpsell(client, thread, guildId, sdIds, {
            gameType: 'Serverdle',
            sessionId: threadId,
        });
        await sendInviteViralNudgeIfAllowed(guildId, thread);
        await finalizeHostedGameThread(thread, { disableComponents: true });
    }
    clearTimeout(activeServerdle.timeoutHandle);
    activeServerdles.delete(threadId);
    await endActiveGame(threadId, client).catch(() => {});
}


async function startServerdleGame(client, guildId, channelId, dur, customWord, threadName, pts, hostIsPremium = false) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return undefined;
        const word = customWord ? customWord.toUpperCase() : WORDS[Math.floor(Math.random() * WORDS.length)];
        throwIfImmediateGameStartBlockedByMaintenance(Date.now(), dur * 60000);
        const thread = await createHostedGamePublicThread(channel, threadName);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('serverdle_guess_btn').setLabel('🤔 Guess').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('serverdle_hint_btn').setLabel('💡 Use Hint (Uses Item)').setStyle(ButtonStyle.Secondary)
        );
        const auraRow = auraBoostRow(thread.id);
        await thread.send({
            content: `🟩 **Serverdle Started!**
Guess the 5-letter word in **6 attempts**! You have **${dur} minutes** to finish.
Click the button below to submit your guess.`,
            embeds: [makeGameFlairEmbed('serverdle')],
            components: [row, auraRow],
        });

        const state = { word, pointValues: parsePointValues(pts, DEFAULT_SERVERDLE_PLACEMENT), players: {}, winners: [] };
        await createActiveGame(guildId, channelId, thread.id, 'Serverdle', state, dur, hostIsPremium);

        activeServerdles.set(thread.id, { 
            guildId,
            channelId: channelId, 
            threadId: thread.id, 
            word: word,
            pointValues: parsePointValues(pts, DEFAULT_SERVERDLE_PLACEMENT),
            players: {}, 
            winners: [], 
            hostIsPremium,
            premiumAuraBoost: false,
            timeoutHandle: setTimeout(() => triggerServerdleEnd(client, thread.id), dur * 60000) 
        });
        registerAuraBoostTarget(thread.id, () => {
            const s = activeServerdles.get(thread.id);
            if (s) s.premiumAuraBoost = true;
        });
        activeServerdles.get(thread.id).announcementMessage = await sendGlobalAnnouncement(client, guildId, `A Serverdle Game has started in <#${channelId}>! Ends in **${dur} minutes**.`, thread.id);
        return thread.id;
    } catch (err) {
        console.error("Error starting Serverdle:", err);
        return undefined;
    }
}

module.exports = {
    startServerdleGame,
    async handleInteraction(interaction, client) {
        const commandName = interaction.commandName;
        const customId = interaction.customId;

        if (commandName === 'startserverdle') {
            await interaction.deferReply({ ephemeral: true });

            const guildId = interaction.guildId;
            const dur = interaction.options.getInteger('duration') || 10;
            const customWord = interaction.options.getString('custom_word');
            const threadName = interaction.options.getString('thread_name') || defaultGameThreadName('Serverdle');
            const pts = interaction.options.getString('points') || DEFAULT_SERVERDLE_PLACEMENT;
            const delay = getSlashScheduleDelayMs(interaction);
            const repeatHrs = interaction.options.getInteger('repeat_hrs') || 0;
            const repeatDays = interaction.options.getInteger('repeat_days') || 0;

            if (customWord && customWord.length !== 5) { 
                return interaction.editReply({ content: "The word must be exactly 5 letters long!" }); 
            }

            const hostUser = await getUser(guildId, interaction.user.id);
            const start = async () =>
                startServerdleGame(client, guildId, interaction.channelId, dur, customWord, threadName, pts, hostUser.isPremium === true);

            const nudgeAfterStart = async (threadId) => {
                if (!threadId) return;
                const th = await client.channels.fetch(threadId).catch(() => null);
                if (!th) return;
                await tryHostPremiumNudge(interaction, hostUser, {
                    gameType: 'Serverdle',
                    supportsRepeatHrs: true,
                    supportsPremiumCaps: false,
                }).catch(() => {});
                await sendPremiumBoostSessionHint(th, hostUser.isPremium === true, {
                    guildId,
                    hostUserId: interaction.user.id,
                    gameType: 'Serverdle',
                    sessionId: th.id,
                    hasAura: false,
                }).catch(() => {});
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
                    type: 'startserverdle',
                    intervalDays,
                    intervalHours,
                    data: { dur, customWord, threadName, pts, hostIsPremium: hostUser.isPremium === true },
                    nextRun
                });
                const fcSuf = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, delay, 'serverdle');
                const iv =
                    (intervalDays ? `**${intervalDays}** day(s) ` : '') + (intervalHours ? `**${intervalHours}** hour(s)` : '');
                await interaction.editReply({ content: `✅ Serverdle scheduled to repeat every ${iv.trim()}!${fcSuf}` });
                if (delay === 0) {
                    const tid = await start();
                    await nudgeAfterStart(tid);
                }
            } else if (delay > 0) {
                 throwIfGameSchedulingBlocked(Date.now() + delay);
                 const id = Math.random().toString(36).substring(2, 9).toUpperCase();
                 const startTime = new Date(Date.now() + delay);
    
                await Game.create({
                    guildId,
                    channelId: interaction.channelId,
                    type: 'Scheduled_Serverdle',
                    status: 'scheduled',
                    startTime,
                    state: { sid: id, originalType: 'Serverdle' }
                });

                setTimeout(async () => {
                    await Game.findOneAndUpdate({ 'state.sid': id }, { status: 'ended' });
                    await start();
                }, delay);

                const fcSuf2 = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, delay, 'serverdle');
                await interaction.editReply({ content: `Scheduled! (ID: \`${id}\`)${fcSuf2}` });
                announceScheduledGame(client, guildId, 'Serverdle', delay);
            }
            else {
                const fcSuf3 = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, 0, 'serverdle');
                await interaction.editReply({ content: `Serverdle started!${fcSuf3}` });
                const tid = await start();
                await nudgeAfterStart(tid);
            }
            return true;
        }

        if (interaction.isButton()) {
            if (customId === 'serverdle_guess_btn') {
                const m = new ModalBuilder().setCustomId('serverdle_modal').setTitle('Serverdle');
                const i = new TextInputBuilder().setCustomId('serverdle_input').setLabel('5-letter word').setStyle(TextInputStyle.Short).setMinLength(5).setMaxLength(5).setRequired(true);
                m.addComponents(new ActionRowBuilder().addComponents(i)); 
                await interaction.showModal(m);
                return true;
            }
            if (customId === 'serverdle_hint_btn') {
                const activeServerdle = activeServerdles.get(interaction.channelId);
                if (!activeServerdle) return interaction.reply({ content: 'Ended!', ephemeral: true });
                
                const user = await getUser(interaction.guildId, interaction.user.id);
                const itemIdx = user.inventory.indexOf('extra_guess_wordle');
                if (itemIdx === -1) return interaction.reply({ content: 'You need an "Extra Guess" item to use hints!', ephemeral: true });
                
                user.inventory.splice(itemIdx, 1);
                await user.save();
                
                const word = activeServerdle.word;
                const randomChar = word[Math.floor(Math.random() * word.length)];
                await interaction.reply({ content: `💡 **Hint:** The word contains the letter **${randomChar}**! (Item consumed)`, ephemeral: true });
                return true;
            }
        }

        if (interaction.isModalSubmit()) {
            if (customId === 'serverdle_modal') {
                const activeServerdle = activeServerdles.get(interaction.channelId);
                if (!activeServerdle) return interaction.reply({ content: 'Ended!', ephemeral: true });
                const uid = interaction.user.id;
                if (!activeServerdle.players[uid]) activeServerdle.players[uid] = { guesses: [], won: false, lastInteraction: null };
                const p = activeServerdle.players[uid];
                if (p.won || p.guesses.length >= 6) return interaction.reply({ content: 'Locked!', ephemeral: true });
                const guess = interaction.fields.getTextInputValue('serverdle_input').toUpperCase();
                if (!/^[A-Z]{5}$/.test(guess)) return interaction.reply({ content: '5 letters!', ephemeral: true });
                
                const w = activeServerdle.word;
                let res = new Array(5).fill('⬜');
                let cc = 0;
                let guessArr = guess.split('');
                let wordArr = w.split('');

                for (let i = 0; i < 5; i++) {
                    if (guessArr[i] === wordArr[i]) {
                        res[i] = '🟩';
                        wordArr[i] = null;
                        guessArr[i] = null;
                        cc++;
                    }
                }

                for (let i = 0; i < 5; i++) {
                    if (guessArr[i] !== null) {
                        const idx = wordArr.indexOf(guessArr[i]);
                        if (idx !== -1) {
                            res[i] = '🟨';
                            wordArr[idx] = null;
                        }
                    }
                }
                
                const finalEmojis = res.join('');
                p.guesses.push({ word: guess, emojis: finalEmojis });

                const guessLines = p.guesses
                    .map((g, idx) => `**${idx + 1}.** \`${g.word}\`  ${[...g.emojis].join(' ')}`)
                    .join('\n');
                const legend =
                    '*🟩 = correct letter & spot · 🟨 = in the word, wrong spot · ⬜ = not in the word (gray tiles)*';

                const buffer = await generateServerdleImage(p.guesses);
                const attachment = new AttachmentBuilder(buffer, { name: 'serverdle.png' });
                const embed = new EmbedBuilder().setTitle('🟩 Serverdle').setColor('#121213').setImage('attachment://serverdle.png');

                const guessRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('serverdle_guess_btn').setLabel('🤔 Next guess').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('serverdle_hint_btn').setLabel('💡 Use hint (item)').setStyle(ButtonStyle.Secondary)
                );

                if (cc === 5) {
                    p.won = true;
                    activeServerdle.winners.push({ userId: uid, guesses: p.guesses.length, timestamp: Date.now() });
                    if (p.guesses.length <= 3) awardAchievement(client, interaction.guildId, null, uid, "WORDLE_WIZARD");
                    embed.setDescription(`${guessLines}\n\n🎉 **SOLVED!** in ${p.guesses.length} guesses!\n\n${legend}`);
                    client.channels.cache.get(activeServerdle.channelId)?.send(`🎉 <@${uid}> solved it!`);
                } else if (p.guesses.length >= 6) {
                    embed.setDescription(`${guessLines}\n\n❌ **Out of guesses.** The word was **${w}**\n\n${legend}`);
                } else {
                    embed.setDescription(`${guessLines}\n\n${legend}`);
                }

                const done = p.won || p.guesses.length >= 6;
                await interaction.reply({
                    embeds: [embed],
                    files: [attachment],
                    components: done ? [] : [guessRow],
                    ephemeral: true,
                });
                
                if (p.lastInteraction) {
                    try { await p.lastInteraction.deleteReply(); } catch(e) {}
                }
                p.lastInteraction = interaction;

                updateActiveGame(activeServerdle.threadId, state => {
                    state.players[uid] = { guesses: p.guesses, won: p.won };
                    state.winners = activeServerdle.winners;
                });
                return true;
            }
        }
        
        return false;
    },
    forceEnd(client, threadId) {
        if (activeServerdles.has(threadId)) {
            triggerServerdleEnd(client, threadId);
            return true;
        }
        return false;
    },
    getActiveGames() {
        return activeServerdles;
    }
}
