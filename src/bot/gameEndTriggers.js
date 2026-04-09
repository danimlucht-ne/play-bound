'use strict';

const { addScore, updateUser, endActiveGame } = require('../../lib/db');
const { announceWinner } = require('../../lib/announcements');
const { awardAchievement, milestoneAchievementKeys } = require('../../lib/achievements');
const { parsePointValues } = require('../../lib/utils');
const { finalizeHostedGameThread } = require('../../lib/gameThreadLifecycle');
const {
    DEFAULT_GIVEAWAY_PLACEMENT,
    DEFAULT_PARTICIPATION_POINTS,
    DEFAULT_SINGLE_WINNER_POINTS,
} = require('../../lib/gamePointsDefaults');
const { sessionHasHostAura } = require('../../lib/premiumPerks');
const { unregisterAuraBoostTarget } = require('../../lib/auraBoostRegistry');
const { appendPremiumGameResultFooter, sendGameEndPremiumUpsell } = require('../../lib/premiumUpsell');
const { sendInviteViralNudgeIfAllowed } = require('../../lib/referrals');
const mongoRouter = require('../../lib/mongoRouter');

function createGameEndTriggers(client, state) {
    const {
        activeSprints,
        activeCaptions,
        activeTunes,
        activeUnscrambles,
        activeGiveaways,
        activeMovieGames,
    } = state;

async function triggerTriviaSprintEnd(threadId) {
    const activeSprint = activeSprints.get(threadId);
    if (!activeSprint) return;
    const guildId = activeSprint.guildId;
    await mongoRouter.runWithGuild(guildId, async () => {
    const hostAura = sessionHasHostAura(activeSprint);
    unregisterAuraBoostTarget(threadId);
    if (activeSprint.announcementMessage) {
        try { await activeSprint.announcementMessage.delete(); } catch(e) {}
    }
    const thread = client.channels.cache.get(activeSprint.threadId);
    let res = `🏃 **Sprint Results:**\n`;
    let winnerText = "No finishers!";
    const players = Object.entries(activeSprint.players || {}).filter(([u, p]) => p.timeTaken != null).sort((a, b) => {
        if (b[1].score !== a[1].score) return b[1].score - a[1].score;
        return a[1].timeTaken - b[1].timeTaken;
    });
    if (players.length > 0) {
        winnerText = `🏆 **Winner:** <@${players[0][0]}> with **${players[0][1].score}/${activeSprint.targetScore}** correct in **${(players[0][1].timeTaken / 1000).toFixed(1)}s**!`;
        players.forEach(([uid, p], i) => {
            const time = (p.timeTaken / 1000).toFixed(1);
            const pts = i < activeSprint.pointValues.length ? activeSprint.pointValues[i] : 1;
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
    for (const pid of Object.keys(activeSprint.players)) { addScore(client, guildId, pid, 3, null, hostAura, 'triviasprint'); }
    await announceWinner(client, guildId, 'Trivia Sprint', winnerText, activeSprint.channelId);
    const sprintIds = [...Object.keys(activeSprint.players || {})];
    res = appendPremiumGameResultFooter(res);
    if (thread) {
        await thread.send(res);
        await sendGameEndPremiumUpsell(client, thread, guildId, sprintIds, {
            gameType: 'TriviaSprint',
            sessionId: threadId,
        });
        await sendInviteViralNudgeIfAllowed(guildId, thread);
        await finalizeHostedGameThread(thread, { disableComponents: true });
    }
    clearTimeout(activeSprint.timeoutHandle); activeSprints.delete(threadId);
    await endActiveGame(threadId, client).catch(() => {});
    });
}

async function triggerCaptionEnd(threadId) {
    const activeCaption = activeCaptions.get(threadId);
    if (!activeCaption) return;
    const guildId = activeCaption.guildId;
    await mongoRouter.runWithGuild(guildId, async () => {
    const hostAura = sessionHasHostAura(activeCaption);
    unregisterAuraBoostTarget(threadId);
    if (activeCaption.announcementMessage) {
        try { await activeCaption.announcementMessage.delete(); } catch(e) {}
    }
    const thread = client.channels.cache.get(activeCaption.threadId);
    const capIds = activeCaption.participants ? [...activeCaption.participants] : [];
    let res = `🖼️ **Caption Contest Ended!**\n`;
    let winnerText = "No clear winner! Thanks for playing.";
    
    if (thread) {
        try {
            const messages = await thread.messages.fetch();
            const userMessages = messages.filter(m => !m.author.bot);
            
            let winnerMsg = null;
            let maxVotes = -1;
            
            for (const m of userMessages.values()) {
                let totalVotes = 0;
                for (const r of m.reactions.cache.values()) {
                    let count = r.count;
                    if (r.me) count--;
                    if (count > 0) {
                        try {
                            const users = await r.users.fetch();
                            if (users.has(m.author.id)) count--;
                        } catch(e) {}
                    }
                    totalVotes += Math.max(0, count);
                }
                
                if (totalVotes > maxVotes) {
                    maxVotes = totalVotes;
                    winnerMsg = m;
                } else if (totalVotes === maxVotes && winnerMsg && m.createdTimestamp < winnerMsg.createdTimestamp) {
                    winnerMsg = m;
                }
            }
            
            const capPts =
                Array.isArray(activeCaption.pointValues) && activeCaption.pointValues.length > 0
                    ? activeCaption.pointValues
                    : parsePointValues(DEFAULT_SINGLE_WINNER_POINTS, DEFAULT_SINGLE_WINNER_POINTS);
            const winPts = capPts[0] || 0;

            if (winnerMsg && maxVotes > 0) {
                winnerText = `🏆 **Winner:** <@${winnerMsg.author.id}> with **${maxVotes}** reactions!\nCaption: *"${winnerMsg.content}"*`;
                res += `${winnerText}\nThey earn **${winPts}** leaderboard points!`;
                if (winPts > 0) {
                    addScore(client, guildId, winnerMsg.author.id, winPts, null, hostAura, 'caption');
                }
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

            const winnerId = winnerMsg && maxVotes > 0 ? winnerMsg.author.id : null;
            for (const pid of capIds) {
                if (winnerId && pid === winnerId) continue;
                if (DEFAULT_PARTICIPATION_POINTS > 0) {
                    addScore(client, guildId, pid, DEFAULT_PARTICIPATION_POINTS, null, hostAura, 'caption');
                }
            }
        } catch (e) {
            console.error('Caption resolution error:', e);
            res += "Thanks for participating!";
        }
        res = appendPremiumGameResultFooter(res);
        await thread.send(res);
        await sendGameEndPremiumUpsell(client, thread, guildId, capIds, {
            gameType: 'CaptionContest',
            sessionId: threadId,
        });
        await sendInviteViralNudgeIfAllowed(guildId, thread);
        await finalizeHostedGameThread(thread, { disableComponents: true });
    }
    
    await announceWinner(client, guildId, 'Caption Contest', winnerText, activeCaption.channelId);
    clearTimeout(activeCaption.timeoutHandle); activeCaptions.delete(threadId);
    await endActiveGame(threadId, client).catch(() => {});
    });
}

async function triggerTuneEnd(threadId) {
    const activeTune = activeTunes.get(threadId);
    if (!activeTune) return;
    const guildId = activeTune.guildId;
    await mongoRouter.runWithGuild(guildId, async () => {
    const hostAura = sessionHasHostAura(activeTune);
    unregisterAuraBoostTarget(threadId);
    if (activeTune.announcementMessage) {
        try { await activeTune.announcementMessage.delete(); } catch(e) {}
    }
    if (activeTune.roundTimeout) clearTimeout(activeTune.roundTimeout);
    
    const stats = activeTune.playerStats || {};
    const sorted = Object.entries(stats).sort((a, b) => {
        if (b[1].wins !== a[1].wins) return b[1].wins - a[1].wins;
        return a[1].totalTime - b[1].totalTime;
    });

    const thread = client.channels.cache.get(activeTune.threadId);
    let res = `🎵 **Name That Tune — finished!**\n\n---\n\n`;
    let winnerText = "No scores!";
    if (sorted.length > 0) {
        winnerText = `🏆 **Overall Winner:** <@${sorted[0][0]}> with **${sorted[0][1].wins}** wins in **${(sorted[0][1].totalTime / 1000).toFixed(2)}s** total!`;
        res += '**Leaderboard**\n\n';
        sorted.forEach(([uid, s], i) => {
            const time = (s.totalTime / 1000).toFixed(2);
            res += `${i + 1}. <@${uid}> — **${s.wins}** wins · _${time}s total_\n\n`;
            
            const pts = i < activeTune.pointValues.length ? activeTune.pointValues[i] : 1;
            if (pts > 0) {
                addScore(client, guildId, uid, pts, null, hostAura, 'namethattune');
            }
            if (i === 0) {
                awardAchievement(client, guildId, thread, uid, "FIRST_WIN");
                updateUser(guildId, uid, u => {
                    u.stats.gamesWon = (u.stats.gamesWon || 0) + 1;
                    u.stats.tuneWins = (u.stats.tuneWins || 0) + 1;
                    for (const key of milestoneAchievementKeys('tuneWins', u.stats.tuneWins)) {
                        awardAchievement(client, guildId, thread, uid, key);
                    }
                });
            }
        });
    } else {
        res += `${winnerText}\n\n`;
    }

    for (const pid of Object.keys(activeTune.playerStats)) { addScore(client, guildId, pid, 3, null, hostAura, 'namethattune'); }
    await announceWinner(client, guildId, 'Name That Tune', winnerText, activeTune.parentChannelId);
    const tuneIds = [...Object.keys(activeTune.playerStats || {})];
    res = appendPremiumGameResultFooter(res);
    if (thread) {
        await thread.send(res);
        await sendGameEndPremiumUpsell(client, thread, guildId, tuneIds, {
            gameType: 'NameThatTune',
            sessionId: threadId,
        });
        await sendInviteViralNudgeIfAllowed(guildId, thread);
        await finalizeHostedGameThread(thread, { disableComponents: true });
    }
    clearTimeout(activeTune.timeoutHandle); 
    if (activeTune.connection) {
        try { activeTune.connection.destroy(); } catch(e) {}
    }
    activeTunes.delete(threadId);
    await endActiveGame(threadId, client).catch(() => {});
    });
}

function clearMovieQuoteRoundTimer(activeMovie) {
    if (activeMovie.roundTimeoutHandle) {
        clearTimeout(activeMovie.roundTimeoutHandle);
        activeMovie.roundTimeoutHandle = null;
    }
}

async function triggerMovieEnd(threadId) {
    const activeMovie = activeMovieGames.get(threadId);
    if (!activeMovie) return;
    clearMovieQuoteRoundTimer(activeMovie);
    if (activeMovie.sessionTimeoutHandle) {
        clearTimeout(activeMovie.sessionTimeoutHandle);
        activeMovie.sessionTimeoutHandle = null;
    }
    const guildId = activeMovie.guildId;
    await mongoRouter.runWithGuild(guildId, async () => {
    const hostAura = sessionHasHostAura(activeMovie);
    unregisterAuraBoostTarget(threadId);
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
    const movieIds = [...Object.keys(activeMovie.scores || {})];
    res = appendPremiumGameResultFooter(res);
    if (channel) {
        await channel.send(res);
        await sendGameEndPremiumUpsell(client, channel, guildId, movieIds, {
            gameType: 'MovieQuotes',
            sessionId: threadId,
        });
        await sendInviteViralNudgeIfAllowed(guildId, channel);
        await finalizeHostedGameThread(channel, { disableComponents: true });
    }
    activeMovieGames.delete(threadId);
    await endActiveGame(threadId, client).catch(() => {});
    });
}

async function nextMovieQuote(threadId) {
    const activeMovie = activeMovieGames.get(threadId);
    if (!activeMovie) return;
    await mongoRouter.runWithGuild(activeMovie.guildId, async () => {
    const thread = client.channels.cache.get(threadId);

    if (activeMovie.currentRound >= activeMovie.totalRounds) {
        await triggerMovieEnd(threadId);
        return;
    }

    clearMovieQuoteRoundTimer(activeMovie);

    const quoteIdx = Math.floor(Math.random() * activeMovie.catalog.length);
    const quoteData = activeMovie.catalog.splice(quoteIdx, 1)[0];
    activeMovie.currentMovie = quoteData.movie;
    activeMovie.currentRound++;
    activeMovie.roundStartTime = Date.now();

    const hintLine =
        activeMovie.currentRound === 1
            ? '\n\n_Type `!moviehint` here if you have a **Movie quote hint** from `/shop`._'
            : '';
    await thread.send(
        `🎬 **Round ${activeMovie.currentRound}:** Guess the **movie or TV show** from this quote!\n\n` +
            `> "${quoteData.quote}"` +
            hintLine
    );

    const sec = activeMovie.roundSeconds;
    if (thread && sec > 0) {
        activeMovie.roundTimeoutHandle = setTimeout(async () => {
            const am = activeMovieGames.get(threadId);
            if (!am || !am.currentMovie) return;
            const answer = am.currentMovie;
            am.currentMovie = null;
            am.roundTimeoutHandle = null;
            try {
                const ch = client.channels.cache.get(threadId);
                if (ch) await ch.send(`⏰ **Time's up!** The answer was **${answer}**.\n\n—\n\n_Next round starting…_`);
                setTimeout(() => nextMovieQuote(threadId), 4500);
            } catch (e) {
                console.error('[MovieQuotes] Round timeout send failed:', e);
            }
        }, sec * 1000);
    }
    });
}

async function triggerUnscrambleEnd(threadId) {
    const activeUnscramble = activeUnscrambles.get(threadId);
    if (!activeUnscramble) return;
    const guildId = activeUnscramble.guildId;
    await mongoRouter.runWithGuild(guildId, async () => {
    const hostAura = sessionHasHostAura(activeUnscramble);
    unregisterAuraBoostTarget(threadId);
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
                addScore(client, guildId, uid, pts, null, hostAura, 'unscramble');
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
    
    for (const pid of Object.keys(activeUnscramble.players)) { addScore(client, guildId, pid, 3, null, hostAura, 'unscramble'); }
    await announceWinner(client, guildId, 'Unscramble Sprint', winnerText, activeUnscramble.parentChannelId);
    const unscIds = [...Object.keys(activeUnscramble.players || {})];
    res = appendPremiumGameResultFooter(res);
    if (thread) {
        await thread.send(res);
        await sendGameEndPremiumUpsell(client, thread, guildId, unscIds, {
            gameType: 'UnscrambleSprint',
            sessionId: threadId,
        });
        await sendInviteViralNudgeIfAllowed(guildId, thread);
        await finalizeHostedGameThread(thread, { disableComponents: true });
    }
    clearTimeout(activeUnscramble.timeoutHandle); activeUnscrambles.delete(threadId);
    await endActiveGame(threadId, client).catch(() => {});
    });
}

async function endGiveaway(msgId) {
    const ga = activeGiveaways.get(msgId);
    if (!ga) return;
    const guildId = ga.guildId;
    await mongoRouter.runWithGuild(guildId, async () => {
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
        await sendGameEndPremiumUpsell(client, thread, guildId, pArr);
        await sendInviteViralNudgeIfAllowed(guildId, thread);
        await finalizeHostedGameThread(thread, { disableComponents: true });
    }
    ga.messageRef.edit({ content: res, components: [] }).catch(()=>{});
    clearTimeout(ga.timeoutHandle); activeGiveaways.delete(msgId);
    await endActiveGame(msgId, client).catch(() => {});
    });
}
    return {
        triggerTriviaSprintEnd,
        triggerCaptionEnd,
        triggerTuneEnd,
        triggerMovieEnd,
        nextMovieQuote,
        triggerUnscrambleEnd,
        endGiveaway,
    };
}

module.exports = { createGameEndTriggers };
