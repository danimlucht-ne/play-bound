const { parsePointValues, isFuzzyMatch, defaultGameThreadName } = require('../lib/utils');
const {
    createHostedGamePublicThread,
    finalizeHostedGameThread,
    getSlashScheduleDelayMs,
} = require('../lib/gameThreadLifecycle');
const { DEFAULT_PLACEMENT_POINTS } = require('../lib/gamePointsDefaults');
const { recurringIntervalMs, splitRecurringParts } = require('../lib/recurringInterval');
const { addScore, updateUser, createActiveGame, getUser, endActiveGame } = require('../lib/db');
const { syncGameScores, clearSyncTimer } = require('../lib/gameScoreSync');
const {
    throwIfGameSchedulingBlocked,
    throwIfImmediateGameStartBlockedByMaintenance,
} = require('../lib/maintenanceScheduling');
const { awardAchievement, milestoneAchievementKeys } = require('../lib/achievements');
const { announceWinner, sendGlobalAnnouncement, announceScheduledGame } = require('../lib/announcements');
const { MovieQuote, RecurringGame } = require('../models');
const { sendInviteViralNudgeIfAllowed } = require('../lib/referrals');

const activeMovieGames = new Map();

async function triggerMovieEnd(client, threadId) {
    const activeMovie = activeMovieGames.get(threadId);
    if (!activeMovie) return;
    const guildId = activeMovie.guildId;
    const hostAura = activeMovie.hostIsPremium === true;
    const channel = client.channels.cache.get(threadId);

    const sorted = Object.entries(activeMovie.scores).sort((a, b) => b[1] - a[1]);
    let winnerText = "No winners!";
    let res = `🎬 **TV & Movie Quotes Game Ended!**\n\n`;

    if (sorted.length > 0) {
        winnerText = `🏆 **Overall Winner:** <@${sorted[0][0]}> with **${sorted[0][1]}** correct guesses!`;
        sorted.forEach(([uid, score], i) => {
            const pts = i < activeMovie.pointValues.length ? activeMovie.pointValues[i] : 1;
            res += `${i + 1}. <@${uid}> - **${score}** correct (+${pts} pts)\n`;
            if (pts > 0) {
                addScore(client, guildId, uid, pts, null, hostAura, 'moviequotes');
            }
            if (i === 0) {
                awardAchievement(client, guildId, channel, uid, "FIRST_WIN");
                updateUser(guildId, uid, u => {
                    u.stats.gamesWon = (u.stats.gamesWon || 0) + 1;
                    u.stats.movieQuoteWins = (u.stats.movieQuoteWins || 0) + 1;
                    for (const key of milestoneAchievementKeys('movieQuoteWins', u.stats.movieQuoteWins)) {
                        awardAchievement(client, guildId, channel, uid, key);
                    }
                });
            }
        });
    } else {
        res += winnerText;
    }

    for (const pid of Object.keys(activeMovie.scores)) { addScore(client, guildId, pid, 3, null, hostAura, 'moviequotes'); }

    await announceWinner(client, guildId, 'TV & Movie Quotes', winnerText, activeMovie.parentChannelId);
    if (channel) {
        await channel.send(res);
        await sendInviteViralNudgeIfAllowed(guildId, channel);
        await finalizeHostedGameThread(channel, { disableComponents: true });
    }
    activeMovieGames.delete(threadId);
    clearSyncTimer(threadId);
    await endActiveGame(threadId, client).catch(() => {});
}

async function nextMovieQuote(client, threadId) {
    const activeMovie = activeMovieGames.get(threadId);
    if (!activeMovie) return;
    const thread = client.channels.cache.get(threadId);

    if (activeMovie.currentRound >= activeMovie.totalRounds) {
        await triggerMovieEnd(client, threadId);
        return;
    }

    const quoteIdx = Math.floor(Math.random() * activeMovie.catalog.length);
    const quoteData = activeMovie.catalog.splice(quoteIdx, 1)[0];
    activeMovie.currentMovie = quoteData.movie;
    activeMovie.currentRound++;
    activeMovie.roundStartTime = Date.now();

    await thread.send(`🎬 **Round ${activeMovie.currentRound}:** Guess the **movie or TV show** from this quote!\n\n> "${quoteData.quote}"`);
}

async function handleMovieQuotesCommand(interaction, client, scheduleGameFn) {
    const guildId = interaction.guildId;
    if (activeMovieGames.has(interaction.channelId)) return interaction.reply({ content: 'A TV & Movie Quotes game is already in progress!', ephemeral: true });

    const rounds = interaction.options.getInteger('rounds');
    const threadName = interaction.options.getString('thread_name') || defaultGameThreadName('TV & Movie Quotes');
    const pointsOption = interaction.options.getString('points') || DEFAULT_PLACEMENT_POINTS;
    const delay = getSlashScheduleDelayMs(interaction);
    const repeatHrs = interaction.options.getInteger('repeat_hrs') || 0;
    const repeatDays = interaction.options.getInteger('repeat_days') || 0;

    const start = async () => {
        try {
            const catalog = await MovieQuote.find({});
            if (catalog.length < rounds) {
                if (interaction.deferred || interaction.replied) {
                    return interaction.followUp({ content: `❌ Not enough TV & movie quotes in the database (have ${catalog.length}, need ${rounds}).`, ephemeral: true });
                } else {
                    return interaction.reply({ content: `❌ Not enough TV & movie quotes in the database (have ${catalog.length}, need ${rounds}).`, ephemeral: true });
                }
            }

            const movieLegacyEstMs = rounds * 120 * 1000;
            throwIfImmediateGameStartBlockedByMaintenance(Date.now(), movieLegacyEstMs);

            let thread;
            if (interaction.channel.isThread()) {
                thread = interaction.channel;
            } else {
                thread = await createHostedGamePublicThread(interaction.channel, threadName);
            }

            activeMovieGames.set(thread.id, {
                guildId,
                parentChannelId: interaction.channelId,
                threadId: thread.id,
                totalRounds: rounds,
                currentRound: 0,
                catalog: catalog,
                scores: {},
                pointValues: parsePointValues(pointsOption, DEFAULT_PLACEMENT_POINTS),
                currentMovie: null,
                roundStartTime: 0
            });

            const game_state_movie = {
                totalRounds: rounds,
                pointValues: parsePointValues(pointsOption, DEFAULT_PLACEMENT_POINTS),
                scores: {},
            };
            await createActiveGame(guildId, interaction.channelId, thread.id, 'MovieQuotes', game_state_movie, 0, false, {
                maintenanceEstimatedDurationMs: movieLegacyEstMs,
            });
            
            await thread.send({ embeds: [makeGameFlairEmbed('moviequotes')] });
            await nextMovieQuote(client, thread.id);
            activeMovieGames.get(thread.id).announcementMessage = await sendGlobalAnnouncement(client, guildId, `A **TV & Movie Quotes** game has started in <#${interaction.channelId}>! **${rounds} rounds**!`, thread.id);

        } catch (err) {
            console.error("Error starting TV & Movie Quotes game:", err);
        }
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
            type: 'moviequotes',
            intervalDays,
            intervalHours,
            data: { rounds, threadName, pointsOption },
            nextRun
        });
        const iv =
            (intervalDays ? `**${intervalDays}** day(s) ` : '') + (intervalHours ? `**${intervalHours}** hour(s)` : '');
        await interaction.reply({ content: `✅ TV & Movie Quotes scheduled to repeat every ${iv.trim()}!`, ephemeral: true });
        if (delay === 0) await start();
    } else if (delay > 0) {
        const sid = await scheduleGameFn(guildId, 'TV & Movie Quotes', interaction.channelId, delay, start);
        await interaction.reply({ content: `Scheduled! (ID: \`${sid}\`)`, ephemeral: true });
        announceScheduledGame(client, guildId, 'TV & Movie Quotes', delay);
    }
    else { await interaction.reply({ content: 'Game starting!', ephemeral: true }); await start(); }
}

async function handleMovieMessage(m, client) {
    const activeMovie = activeMovieGames.get(m.channel.id);
    if (activeMovie && activeMovie.currentMovie) {
        if (isFuzzyMatch(m.content, activeMovie.currentMovie)) {
            const timeTaken = (Date.now() - activeMovie.roundStartTime) / 1000;
            activeMovie.scores[m.author.id] = (activeMovie.scores[m.author.id] || 0) + 1;
            const movieName = activeMovie.currentMovie;
            activeMovie.currentMovie = null; // Prevent double points

            syncGameScores(m.channel.id, activeMovie);

            await m.react('✅').catch(() => {});
            await m.reply(`🎬 **Correct!** It was **${movieName}**!\n<@${m.author.id}> guessed it in **${timeTaken.toFixed(1)}s**.`);
            setTimeout(() => nextMovieQuote(client, m.channel.id), 3000);
            return true;
        } else {
            m.react('❌').catch(()=>{});
        }
        return true;
    }
    return false;
}

function forceEndMovie(channelId, client) {
    if (activeMovieGames.has(channelId)) {
        triggerMovieEnd(client, channelId);
        return true;
    }
    return false;
}

module.exports = {
    triggerMovieEnd,
    nextMovieQuote,
    handleMovieQuotesCommand,
    handleMovieMessage,
    forceEndMovie,
    activeMovieGames
};
