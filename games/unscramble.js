const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { parsePointValues, isFuzzyMatch, scramblePhrase, defaultGameThreadName } = require('../lib/utils');
const {
    createHostedGamePublicThread,
    finalizeHostedGameThread,
    getSlashScheduleDelayMs,
} = require('../lib/gameThreadLifecycle');
const { DEFAULT_PLACEMENT_POINTS } = require('../lib/gamePointsDefaults');
const { recurringIntervalMs, splitRecurringParts } = require('../lib/recurringInterval');
const { makeGameFlairEmbed } = require('../lib/gameFlair');
const { addScore, updateUser, createActiveGame, getUser } = require('../lib/db');
const { syncGameScores, clearSyncTimer } = require('../lib/gameScoreSync');
const { awardAchievement, milestoneAchievementKeys } = require('../lib/achievements');
const { announceWinner, sendGlobalAnnouncement, announceScheduledGame } = require('../lib/announcements');
const { Phrase, RecurringGame } = require('../models');
const {
    throwIfGameSchedulingBlocked,
    throwIfImmediateGameStartBlockedByMaintenance,
} = require('../lib/maintenanceScheduling');

const activeUnscrambles = new Map();

/** Ignore spaces/punctuation; only A–Z counts (trivial 1–3 letter “words” are excluded). */
const MIN_UNSCRAMBLE_LETTERS = 4;

function phraseLetterCount(phrase) {
    return String(phrase || '').replace(/[^a-zA-Z]/g, '').length;
}

function isEligibleUnscramblePhrase(row) {
    return row && typeof row.phrase === 'string' && phraseLetterCount(row.phrase) >= MIN_UNSCRAMBLE_LETTERS;
}

/**
 * @param {number} rounds
 * @returns {Promise<Array<{ phrase: string, clue: string, scrambled: string }>>}
 */
async function buildUnscramblePhrasesForGame(rounds) {
    const fallbackPool = [
        { phrase: 'APPLE PIE', clue: 'A tasty dessert' },
        { phrase: 'SUPERMAN', clue: 'A hero from Krypton' },
        { phrase: 'MIDNIGHT SUN', clue: 'Twilight opposite' },
        { phrase: 'OCEAN WAVE', clue: 'Beach motion' },
        { phrase: 'ROCKET SHIP', clue: 'Goes to space' },
    ];
    const eligibleFallback = fallbackPool.filter(isEligibleUnscramblePhrase);
    if (eligibleFallback.length === 0) {
        eligibleFallback.push({ phrase: 'APPLE PIE', clue: 'A tasty dessert' });
    }

    const picked = [];
    try {
        const docCount = await Phrase.countDocuments();
        if (docCount > 0) {
            let guard = 0;
            const maxGuard = Math.max(rounds * 100, 500);
            while (picked.length < rounds && guard < maxGuard) {
                guard++;
                const one = await Phrase.aggregate([{ $sample: { size: 1 } }]);
                const row = one[0];
                if (!isEligibleUnscramblePhrase(row)) continue;
                picked.push({ phrase: row.phrase.trim(), clue: (row.clue && String(row.clue)) || '' });
            }
        }
    } catch (e) {
        console.error('[Unscramble] phrase sample:', e);
    }

    while (picked.length < rounds) {
        const p = eligibleFallback[Math.floor(Math.random() * eligibleFallback.length)];
        picked.push({ phrase: p.phrase, clue: p.clue || '' });
    }

    const phrases = [];
    for (let i = 0; i < rounds; i++) {
        const p = picked[i];
        let scrambled = scramblePhrase(p.phrase);
        let attempts = 0;
        while (
            scrambled.replace(/ /g, '') === p.phrase.replace(/ /g, '') &&
            phraseLetterCount(p.phrase) > 1 &&
            attempts < 10
        ) {
            scrambled = scramblePhrase(p.phrase);
            attempts++;
        }
        phrases.push({ phrase: p.phrase, clue: p.clue, scrambled });
    }
    return phrases;
}

async function triggerUnscrambleEnd(client, threadId) {
    const activeUnscramble = activeUnscrambles.get(threadId);
    if (!activeUnscramble) return;
    const guildId = activeUnscramble.guildId;
    if (activeUnscramble.announcementMessage) {
        try { await activeUnscramble.announcementMessage.delete(); } catch(e) {}
    }
    const players = Object.entries(activeUnscramble.players).filter(([u, p]) => p.timeTaken !== null).sort((a, b) => {
        if (b[1].score !== a[1].score) return b[1].score - a[1].score;
        return a[1].timeTaken - b[1].timeTaken;
    });

    const thread = client.channels.cache.get(activeUnscramble.threadId);
    let res = `📝 **Unscramble Sprint Ended!**\n\n`;
    let winnerText = "No finishers!";
    if (players.length > 0) {
        winnerText = `🏆 **Winner:** <@${players[0][0]}> with **${players[0][1].score}/${activeUnscramble.totalRounds}** in **${(players[0][1].timeTaken / 1000).toFixed(1)}s**!`;
        players.forEach(([uid, p], i) => {
            const time = (p.timeTaken / 1000).toFixed(1);
            const pts = i < activeUnscramble.pointValues.length ? activeUnscramble.pointValues[i] : 1;
            res += `${i + 1}. <@${uid}> - **${p.score}/${activeUnscramble.totalRounds}** (${time}s) (+${pts} pts)\n`;
            if (pts > 0) {
                addScore(client, guildId, uid, pts, null, false, 'unscramble');
            }
            if (i === 0) {
                awardAchievement(client, guildId, thread, uid, "FIRST_WIN");
                updateUser(guildId, uid, u => {
                    u.stats.gamesWon = (u.stats.gamesWon || 0) + 1;
                    u.stats.unscrambleWins = (u.stats.unscrambleWins || 0) + 1;
                    for (const key of milestoneAchievementKeys('unscrambleWins', u.stats.unscrambleWins)) {
                        awardAchievement(client, guildId, thread, uid, key);
                    }
                });
            }
        });
    } else {
        res += winnerText;
    }
    
    for (const pid of Object.keys(activeUnscramble.players)) { addScore(client, guildId, pid, 3, null, false, 'unscramble'); }
    await announceWinner(client, guildId, 'Unscramble Sprint', winnerText, activeUnscramble.parentChannelId);
    if (thread) {
        await thread.send(res);
        await finalizeHostedGameThread(thread, { disableComponents: true });
    }
    clearTimeout(activeUnscramble.timeoutHandle); activeUnscrambles.delete(threadId);
    clearSyncTimer(threadId);
}

async function handleUnscrambleCommand(interaction, client, scheduleGameFn) {
    const guildId = interaction.guildId;
    const rounds = interaction.options.getInteger('rounds') || 5;
    const threadName = interaction.options.getString('thread_name') || defaultGameThreadName('Unscramble Sprint');
    const pts = interaction.options.getString('points') || DEFAULT_PLACEMENT_POINTS;
    const delay = getSlashScheduleDelayMs(interaction);
    const repeatHrs = interaction.options.getInteger('repeat_hrs') || 0;
    const repeatDays = interaction.options.getInteger('repeat_days') || 0;

    const start = async () => {
        throwIfImmediateGameStartBlockedByMaintenance(Date.now(), (rounds + 1) * 60000);
        const phrases = await buildUnscramblePhrasesForGame(rounds);

        let thread;
        if (interaction.channel.isThread()) {
            thread = interaction.channel;
        } else {
            thread = await createHostedGamePublicThread(interaction.channel, threadName);
        }
        
        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('unscramble_start').setLabel('🏃 Start Unscramble').setStyle(ButtonStyle.Success));
        await thread.send({
            content: `📝 **Unscramble Sprint!**\nUnscramble ${rounds} phrases as fast as possible!\nYou have **${rounds + 1} minutes** to finish.`,
            embeds: [makeGameFlairEmbed('unscramble')],
            components: [row],
        });

        const game_state_unscramble = { phrases, totalRounds: rounds, pointValues: parsePointValues(pts, DEFAULT_PLACEMENT_POINTS), players: {} };
        await createActiveGame(guildId, interaction.channelId, thread.id, 'UnscrambleSprint', game_state_unscramble, rounds + 1);
        activeUnscrambles.set(thread.id, { guildId, parentChannelId: interaction.channelId, threadId: thread.id, totalRounds: rounds, phrases: phrases, players: {}, pointValues: parsePointValues(pts, DEFAULT_PLACEMENT_POINTS), timeoutHandle: setTimeout(() => triggerUnscrambleEnd(client, thread.id), (rounds * 60000) + 60000) });
        activeUnscrambles.get(thread.id).announcementMessage = await sendGlobalAnnouncement(client, guildId, `An Unscramble Sprint has started in <#${interaction.channelId}>! Ends in **${rounds + 1} minutes**.`, thread.id);
    };
    
    const repeatMs = recurringIntervalMs({ repeat_days: repeatDays, repeat_hrs: repeatHrs });
    if (repeatMs > 0) {
        const user = await getUser(guildId, interaction.user.id);
        if (!user.isPremium) return interaction.reply({ content: "❌ **Recurring Games** are a Premium feature! Use `/premium` to unlock the Autopilot system.", ephemeral: true });

        const nextRun = new Date(Date.now() + delay + repeatMs);
        throwIfGameSchedulingBlocked(nextRun.getTime());
        const { intervalDays, intervalHours } = splitRecurringParts({ repeat_days: repeatDays, repeat_hrs: repeatHrs });
        await RecurringGame.create({
            guildId,
            channelId: interaction.channelId,
            type: 'unscramble',
            intervalDays,
            intervalHours,
            data: { rounds, threadName, pts },
            nextRun
        });
        const iv =
            (intervalDays ? `**${intervalDays}** day(s) ` : '') + (intervalHours ? `**${intervalHours}** hour(s)` : '');
        await interaction.reply({ content: `✅ Unscramble scheduled to repeat every ${iv.trim()}!`, ephemeral: true });
        if (delay === 0) await start();
    } else if (delay > 0) {
        const sid = await scheduleGameFn(guildId, 'Unscramble', interaction.channelId, delay, start);
        await interaction.reply({ content: `Scheduled! (ID: \`${sid}\`)`, ephemeral: true });
        announceScheduledGame(client, guildId, 'Unscramble', delay);
    }
    else { await interaction.reply({ content: "Unscramble Sprint started!", ephemeral: true }); await start(); }
}

async function handleUnscrambleInteraction(interaction, client) {
    if (interaction.isModalSubmit() && interaction.customId === 'unscramble_modal') {
        const activeUnscramble = activeUnscrambles.get(interaction.channelId);
        if (!activeUnscramble) return interaction.reply({ content: 'Game ended!', ephemeral: true });
        const p = activeUnscramble.players[interaction.user.id];
        if (!p || p.timeTaken) return interaction.reply({ content: 'Already finished!', ephemeral: true });

        const guess = interaction.fields.getTextInputValue('unscramble_input');
        const q = activeUnscramble.phrases[p.qIndex];

        if (isFuzzyMatch(guess, q.phrase.replace(/ /g, ''))) {
            p.score += p.currentHint ? 0.5 : 1;
            p.qIndex++;
            p.currentHint = false;
            syncGameScores(activeUnscramble.threadId, activeUnscramble);

            if (p.qIndex >= activeUnscramble.totalRounds) {
                p.timeTaken = Date.now() - p.startTime;
                return interaction.update({ content: `✅ Correct!\n\n🏁 **FINISHED!** Score: ${p.score}/${activeUnscramble.totalRounds}\nTime: ${(p.timeTaken/1000).toFixed(1)}s`, components: [] });
            }

            const nq = activeUnscramble.phrases[p.qIndex];
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('unscramble_guess_btn').setLabel('🤔 Guess').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('unscramble_hint_btn').setLabel('💡 Hint (0.5× round)').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('unscramble_skip_btn').setLabel('⏭️ Skip').setStyle(ButtonStyle.Danger)
            );
            await interaction.update({ content: `✅ Correct!\n\n**Phrase ${p.qIndex + 1}/${activeUnscramble.totalRounds}**\n\n# \`${nq.scrambled}\`\n*Clue: ${nq.clue}*`, components: [row] });
        } else {
            const wordCount = q.phrase.split(' ').length;
            let hintText = p.currentHint ? `\n\n💡 **Hint:** The answer has **${wordCount}** word${wordCount === 1 ? '' : 's'}.` : '';
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('unscramble_guess_btn').setLabel('🤔 Guess').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('unscramble_hint_btn').setLabel('💡 Hint (0.5× round)').setStyle(ButtonStyle.Secondary).setDisabled(p.currentHint),
                new ButtonBuilder().setCustomId('unscramble_skip_btn').setLabel('⏭️ Skip').setStyle(ButtonStyle.Danger)
            );
            await interaction.update({ content: `❌ **"${guess}"** is incorrect! Try again.\n\n**Phrase ${p.qIndex + 1}/${activeUnscramble.totalRounds}**\n\n# \`${q.scrambled}\`\n*Clue: ${q.clue}*${hintText}`, components: [row] });
        }
        return true;
    }

    if (interaction.isButton()) {
        if (interaction.customId === 'unscramble_start') {
            const activeUnscramble = activeUnscrambles.get(interaction.channelId);
            if (!activeUnscramble) return interaction.reply({ content: 'This game has already ended!', ephemeral: true });
            if (activeUnscramble.players[interaction.user.id]) return interaction.reply({ content: 'You have already started!', ephemeral: true });
            activeUnscramble.players[interaction.user.id] = { startTime: Date.now(), score: 0, timeTaken: null, qIndex: 0, currentHint: false };
            
            const q = activeUnscramble.phrases[0];
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('unscramble_guess_btn').setLabel('🤔 Guess').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('unscramble_hint_btn').setLabel('💡 Hint (0.5× round)').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('unscramble_skip_btn').setLabel('⏭️ Skip').setStyle(ButtonStyle.Danger)
            );
            await interaction.reply({ content: `**Phrase 1/${activeUnscramble.totalRounds}**\n\n# \`${q.scrambled}\`\n*Clue: ${q.clue}*`, components: [row], ephemeral: true });
            return true;
        }
        if (interaction.customId === 'unscramble_hint_btn') {
            const activeUnscramble = activeUnscrambles.get(interaction.channelId);
            if (!activeUnscramble) return interaction.reply({ content: 'This game has already ended!', ephemeral: true });
            const p = activeUnscramble.players[interaction.user.id];
            if (!p || p.timeTaken) return interaction.reply({ content: 'You have already finished!', ephemeral: true });
            p.currentHint = true;
            const q = activeUnscramble.phrases[p.qIndex];
            const wordCount = q.phrase.split(' ').length;
            
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('unscramble_guess_btn').setLabel('🤔 Guess').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('unscramble_hint_btn').setLabel('💡 Hint (0.5× round)').setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId('unscramble_skip_btn').setLabel('⏭️ Skip').setStyle(ButtonStyle.Danger)
            );
            await interaction.update({ content: `**Phrase ${p.qIndex + 1}/${activeUnscramble.totalRounds}**\n\n# \`${q.scrambled}\`\n*Clue: ${q.clue}*\n\n💡 **Hint:** The answer has **${wordCount}** word${wordCount === 1 ? '' : 's'}.`, components: [row] });
            return true;
        }
        if (interaction.customId === 'unscramble_skip_btn') {
            const activeUnscramble = activeUnscrambles.get(interaction.channelId);
            if (!activeUnscramble) return interaction.reply({ content: 'This game has already ended!', ephemeral: true });
            const p = activeUnscramble.players[interaction.user.id];
            if (!p || p.timeTaken) return interaction.reply({ content: 'You have already finished!', ephemeral: true });
            
            p.qIndex++;
            p.currentHint = false;

            if (p.qIndex >= activeUnscramble.totalRounds) {
                p.timeTaken = Date.now() - p.startTime;
                return interaction.update({ content: `🏁 **FINISHED!** Score: ${p.score}/${activeUnscramble.totalRounds}\nTime: ${(p.timeTaken/1000).toFixed(1)}s`, components: [] });
            }

            const nq = activeUnscramble.phrases[p.qIndex];
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('unscramble_guess_btn').setLabel('🤔 Guess').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('unscramble_hint_btn').setLabel('💡 Hint (0.5× round)').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('unscramble_skip_btn').setLabel('⏭️ Skip').setStyle(ButtonStyle.Danger)
            );
            await interaction.update({ content: `❌ Skipped!\n\n**Phrase ${p.qIndex + 1}/${activeUnscramble.totalRounds}**\n\n# \`${nq.scrambled}\`\n*Clue: ${nq.clue}*`, components: [row] });
            return true;
        }
        if (interaction.customId === 'unscramble_guess_btn') {
            const m = new ModalBuilder().setCustomId('unscramble_modal').setTitle('Unscramble Guess');
            const i = new TextInputBuilder().setCustomId('unscramble_input').setLabel('Your guess').setStyle(TextInputStyle.Short).setRequired(true);
            m.addComponents(new ActionRowBuilder().addComponents(i)); 
            await interaction.showModal(m);
            return true;
        }
    }
    return false;
}

function forceEndUnscramble(channelId, client) {
    if (activeUnscrambles.has(channelId)) {
        triggerUnscrambleEnd(client, channelId);
        return true;
    }
    return false;
}

module.exports = {
    triggerUnscrambleEnd,
    buildUnscramblePhrasesForGame,
    handleUnscrambleCommand,
    handleUnscrambleInteraction,
    forceEndUnscramble,
    activeUnscrambles,
};
