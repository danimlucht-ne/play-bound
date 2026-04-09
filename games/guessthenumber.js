const { Game } = require('../models');
const { addScore, updateUser, updateActiveGame, createActiveGame, endActiveGame, getUser } = require('../lib/db');
const {
    throwIfGameSchedulingBlocked,
    throwIfImmediateGameStartBlockedByMaintenance,
} = require('../lib/maintenanceScheduling');
const { makeGameFlairEmbed } = require('../lib/gameFlair');
const { sessionHasHostAura } = require('../lib/premiumPerks');
const { registerAuraBoostTarget, unregisterAuraBoostTarget } = require('../lib/auraBoostRegistry');
const { auraBoostRow } = require('../lib/gameAuraButton');
const { awardAchievement, milestoneAchievementKeys } = require('../lib/achievements');
const { announceWinner, sendGlobalAnnouncement, announceScheduledGame } = require('../lib/announcements');
const {
    appendPremiumGameResultFooter,
    sendGameEndPremiumUpsell,
    tryHostPremiumNudge,
    sendPremiumBoostSessionHint,
} = require('../lib/premiumUpsell');
const { sendInviteViralNudgeIfAllowed } = require('../lib/referrals');
const { defaultGameThreadName, parsePointValues } = require('../lib/utils');
const {
    createHostedGamePublicThread,
    finalizeHostedGameThread,
    getSlashScheduleDelayMs,
} = require('../lib/gameThreadLifecycle');
const { DEFAULT_GUESS_NUMBER_WINNER_POINTS, DEFAULT_PARTICIPATION_POINTS } = require('../lib/gamePointsDefaults');
const { getFactionChallengeStaffOverlapSuffix } = require('../lib/factionChallengeHostWarning');

const activeGuessTheNumber = new Map();

/** Smallest distance to target; ties → earlier guess wins. */
function findWinnerClosest(guesses, target) {
    let winnerId = null;
    let minDiff = Infinity;
    let earliestTime = Infinity;

    for (const [userId, guess] of Object.entries(guesses)) {
        const diff = Math.abs(guess.value - target);
        if (diff < minDiff) {
            minDiff = diff;
            winnerId = userId;
            earliestTime = guess.timestamp;
        } else if (diff === minDiff && guess.timestamp < earliestTime) {
            winnerId = userId;
            earliestTime = guess.timestamp;
        }
    }
    return winnerId;
}

/** Price is Right: highest guess ≤ target; ties → earlier guess. No one ≤ target → null. */
function findWinnerWithoutOver(guesses, target) {
    let winnerId = null;
    let bestVal = -Infinity;
    let earliestTime = Infinity;

    for (const [userId, guess] of Object.entries(guesses)) {
        if (guess.value > target) continue;
        if (guess.value > bestVal) {
            bestVal = guess.value;
            winnerId = userId;
            earliestTime = guess.timestamp;
        } else if (guess.value === bestVal && guess.timestamp < earliestTime) {
            winnerId = userId;
            earliestTime = guess.timestamp;
        }
    }
    return winnerId;
}

function pickWinner(guesses, target, winRule) {
    if (winRule === 'without_over') return findWinnerWithoutOver(guesses, target);
    return findWinnerClosest(guesses, target);
}

async function triggerNumberGuessingEnd(client, threadId) {
    const activeGame = activeGuessTheNumber.get(threadId);
    if (!activeGame) return;
    
    const guildId = activeGame.guildId;
    const hostAura = sessionHasHostAura(activeGame);
    unregisterAuraBoostTarget(threadId);
    if (activeGame.announcementMessage) {
        try { await activeGame.announcementMessage.delete(); } catch(e) {}
    }
    const winRule = activeGame.winRule || 'closest';
    const winnerId = pickWinner(activeGame.guesses, activeGame.target, winRule);
    const thread = client.channels.cache.get(activeGame.threadId);
    const ruleLabel =
        winRule === 'without_over'
            ? 'Closest **without going over** (Price is Right)'
            : '**Closest** guess (over or under)';
    let result = `⏰ **Game Over!** Secret number: **${activeGame.target}**!
_Rule: ${ruleLabel}_

`;
    let winnerText = 'No winner!';

    if (winnerId) {
        const winPtsRaw = activeGame.pointValues?.[0];
        const pts = typeof winPtsRaw === 'number' && winPtsRaw > 0 ? winPtsRaw : 25;
        winnerText = `🏆 **Winner:** <@${winnerId}>!`;
        result += `${winnerText} (Earned ${pts} pts)`;
        addScore(client, guildId, winnerId, pts, null, hostAura, 'guessthenumber');
        awardAchievement(client, guildId, thread, winnerId, "FIRST_WIN");

        updateUser(guildId, winnerId, u => {
            u.stats.gamesWon = (u.stats.gamesWon || 0) + 1;
            u.stats.guessWins = (u.stats.guessWins || 0) + 1;
            for (const key of milestoneAchievementKeys('guessWins', u.stats.guessWins)) {
                awardAchievement(client, guildId, thread, winnerId, key);
            }
        });
    } else {
        if (winRule === 'without_over' && Object.keys(activeGame.guesses).length > 0) {
            result += 'No guess was **at or under** the secret number — no winner this round.';
        } else {
            result += winnerText;
        }
    }

    for (const pid of Object.keys(activeGame.guesses)) {
        if (winnerId && pid === winnerId) continue;
        addScore(client, guildId, pid, DEFAULT_PARTICIPATION_POINTS, null, hostAura, 'guessthenumber');
    }
    await announceWinner(client, guildId, 'Guess The Number', winnerText, activeGame.parentChannelId);

    const guessIds = [...Object.keys(activeGame.guesses || {})];
    result = appendPremiumGameResultFooter(result);
    if (thread) {
        await thread.send(result);
        await sendGameEndPremiumUpsell(client, thread, guildId, guessIds, {
            gameType: 'GuessTheNumber',
            sessionId: threadId,
        });
        await sendInviteViralNudgeIfAllowed(guildId, thread);
        await finalizeHostedGameThread(thread, { disableComponents: true });
    }

    await endActiveGame(activeGame.threadId, client).catch(() => {});

    clearTimeout(activeGame.timeoutHandle); 
    activeGuessTheNumber.delete(threadId);
}

module.exports = {
    async handleInteraction(interaction, client) {
        if (interaction.isChatInputCommand() && interaction.commandName === 'guessthenumber') {
            const guildId = interaction.guildId;
            const min = interaction.options.getInteger('min'); 
            const max = interaction.options.getInteger('max');
            const threadName =
                interaction.options.getString('thread_name') ||
                defaultGameThreadName(`Guessing Game (${min}-${max})`);
            const dur = interaction.options.getInteger('duration') || 60; 
            const target = Math.floor(Math.random()*(max-min+1))+min;
            const pointsOption = interaction.options.getString('points') || DEFAULT_GUESS_NUMBER_WINNER_POINTS;
            const delay = getSlashScheduleDelayMs(interaction);
            const slowMode = interaction.options.getInteger('slow_mode') || 0;
            const winRule = interaction.options.getString('win_rule') || 'closest';

            await interaction.deferReply({ ephemeral: true });

            const hostUser = await getUser(guildId, interaction.user.id);

            const ruleExplain =
                winRule === 'without_over'
                    ? 'Highest guess **at or under** the secret number wins (everyone over loses).'
                    : '**Closest** guess wins (over or under).';

            const start = async () => {
                throwIfImmediateGameStartBlockedByMaintenance(Date.now(), dur * 60000);
                const thread = await createHostedGamePublicThread(interaction.channel, threadName);
                await thread.send({
                    content: `🔢 **Guessing Game!** (${min}-${max})
${ruleExplain}
Ends in **${dur} minutes**.`,
                    embeds: [makeGameFlairEmbed('guessthenumber')],
                    components: [auraBoostRow(thread.id)],
                });
                
                const state = {
                    target,
                    min,
                    max,
                    winRule,
                    pointValues: parsePointValues(pointsOption, DEFAULT_GUESS_NUMBER_WINNER_POINTS),
                    guesses: {},
                    usedNumbers: [],
                };
                await createActiveGame(guildId, interaction.channelId, thread.id, 'GuessTheNumber', state, dur, hostUser.isPremium === true);
                
                const gameData = { 
                    guildId, 
                    parentChannelId: interaction.channelId, 
                    threadId: thread.id, 
                    target, 
                    min, 
                    max, 
                    winRule,
                    pointValues: parsePointValues(pointsOption, DEFAULT_GUESS_NUMBER_WINNER_POINTS),
                    guesses: {}, 
                    usedNumbers: new Set(), 
                    hostIsPremium: hostUser.isPremium === true,
                    premiumAuraBoost: false,
                    timeoutHandle: setTimeout(() => triggerNumberGuessingEnd(client, thread.id), dur * 60000) 
                };
                activeGuessTheNumber.set(thread.id, gameData);
                registerAuraBoostTarget(thread.id, () => {
                    const g = activeGuessTheNumber.get(thread.id);
                    if (g) g.premiumAuraBoost = true;
                });

                if (slowMode > 0) await thread.setRateLimitPerUser(slowMode).catch(()=>{});
                const annWinPts =
                    typeof gameData.pointValues?.[0] === 'number' && gameData.pointValues[0] > 0
                        ? gameData.pointValues[0]
                        : 25;
                gameData.announcementMessage = await sendGlobalAnnouncement(
                    client,
                    guildId,
                    `A Guessing Game has started in <#${interaction.channelId}>! Ends in **${dur} minutes**. Winner gets **${annWinPts}** pts; everyone who guesses gets **${DEFAULT_PARTICIPATION_POINTS}**.`,
                    thread.id,
                );
            };

            if (delay > 0) { 
                throwIfGameSchedulingBlocked(Date.now() + delay);
                const id = Math.random().toString(36).substring(2, 9).toUpperCase();
                const startTime = new Date(Date.now() + delay);
                await Game.create({
                    guildId,
                    channelId: interaction.channelId,
                    type: 'Scheduled_GuessTheNumber',
                    status: 'scheduled',
                    startTime,
                    state: { sid: id, originalType: 'GuessTheNumber' }
                });

                setTimeout(async () => {
                    await Game.findOneAndUpdate({ 'state.sid': id }, { status: 'ended' });
                    await start();
                }, delay);
                
                const fcSuf = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, delay, 'guessthenumber');
                await interaction.editReply({ content: `Scheduled! (ID: \`${id}\`)${fcSuf}` });
                announceScheduledGame(client, guildId, 'Guess The Number', delay);
            }
            else {
                const fcSuf2 = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, 0, 'guessthenumber');
                await interaction.editReply({ content: `Game started!${fcSuf2}` });
                const tid = await start();
                if (tid) {
                    const th = await client.channels.fetch(tid).catch(() => null);
                    if (th) {
                        await tryHostPremiumNudge(interaction, hostUser, {
                            gameType: 'GuessTheNumber',
                            supportsRepeatHrs: false,
                            supportsPremiumCaps: false,
                        }).catch(() => {});
                        await sendPremiumBoostSessionHint(th, hostUser.isPremium === true, {
                            guildId,
                            hostUserId: interaction.user.id,
                            gameType: 'GuessTheNumber',
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
    async handleMessage(message, client) {
        const activeGame = activeGuessTheNumber.get(message.channel.id);
        if (activeGame) {
            const val = parseInt(message.content.trim()); 
            if (isNaN(val)) return;
            if (activeGame.guesses[message.author.id]) {
                await message.react('❌').catch(() => {});
                return true;
            }
            if (activeGame.usedNumbers.has(val)) { await message.react('❌'); return; }
            
            activeGame.guesses[message.author.id] = { value: val, timestamp: Date.now() };
            activeGame.usedNumbers.add(val); 
            await message.react('✅');

            updateActiveGame(activeGame.threadId, (state) => {
                if (!state || typeof state !== 'object') return;
                if (!state.guesses || typeof state.guesses !== 'object') state.guesses = {};
                if (!Array.isArray(state.usedNumbers)) state.usedNumbers = [];
                state.guesses[message.author.id] = activeGame.guesses[message.author.id];
                state.usedNumbers.push(val);
            });
            return true;
        }
        return false;
    },
    forceEnd(client, threadId) {
        if (activeGuessTheNumber.has(threadId)) {
            triggerNumberGuessingEnd(client, threadId);
            return true;
        }
        return false;
    },
    getActiveGames() {
        return activeGuessTheNumber;
    }
};
