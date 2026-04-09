'use strict';

const { playboundDebugLog } = require('../lib/playboundDebug');
const { MessageFlags } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    entersState,
    VoiceConnectionStatus,
    AudioPlayerStatus,
} = require('@discordjs/voice');
const { parsePointValues, defaultGameThreadName } = require('../lib/utils');
const {
    createHostedGamePublicThread,
    finalizeHostedGameThread,
    getSlashScheduleDelayMs,
    getSlashRepeatIntervalMs,
} = require('../lib/gameThreadLifecycle');
const { DEFAULT_PLACEMENT_POINTS, DEFAULT_PARTICIPATION_POINTS } = require('../lib/gamePointsDefaults');
const { splitRecurringParts } = require('../lib/recurringInterval');
const { throwIfGameSchedulingBlocked, throwIfImmediateGameStartBlockedByMaintenance } = require('../lib/maintenanceScheduling');
const { Game, RecurringGame } = require('../models');
const { makeGameFlairEmbed } = require('../lib/gameFlair');
const {
    appendPremiumGameResultFooter,
    sendGameEndPremiumUpsell,
    tryHostPremiumNudge,
    sendPremiumBoostSessionHint,
} = require('../lib/premiumUpsell');
const { sendInviteViralNudgeIfAllowed } = require('../lib/referrals');
const { sessionHasHostAura, clampHostGameInt } = require('../lib/premiumPerks');
const { registerAuraBoostTarget, unregisterAuraBoostTarget } = require('../lib/auraBoostRegistry');
const { auraBoostRow } = require('../lib/gameAuraButton');
const { createActiveGame, endActiveGame, getUser, addScore, updateUser } = require('../lib/db');
const { syncGameScores, clearSyncTimer } = require('../lib/gameScoreSync');
const { announceWinner, sendGlobalAnnouncement, announceScheduledGame } = require('../lib/announcements');
const { awardAchievement, milestoneAchievementKeys } = require('../lib/achievements');
const { buildRoundPool } = require('../lib/spellingBeeWords');
const { synthesizeEnglishWord, isTtsAvailable } = require('../lib/spellingBeeTts');
const { resolveGameHostChannel, resolveUserVoiceChannel } = require('../lib/discordGameHost');
const { getFactionChallengeStaffOverlapSuffix } = require('../lib/factionChallengeHostWarning');

const activeSpellingBees = new Map();

function normalizeSpelling(s) {
    return String(s).trim().toLowerCase().replace(/[^a-z']/g, '');
}

async function endSpellingBeeGame(client, threadId) {
    const g = activeSpellingBees.get(threadId);
    if (!g || g._ending) return;
    g._ending = true;
    activeSpellingBees.delete(threadId);
    clearSyncTimer(threadId);
    unregisterAuraBoostTarget(threadId);

    if (g.announcementMessage) {
        try {
            await g.announcementMessage.delete();
        } catch (_) {
            /* ignore */
        }
    }
    if (g.roundTimeoutId) clearTimeout(g.roundTimeoutId);
    g.roundTimeoutId = null;
    g.roundWaiting = false;
    if (g.wordRepeatIntervalId) {
        clearInterval(g.wordRepeatIntervalId);
        g.wordRepeatIntervalId = null;
    }

    try {
        g.player.stop();
    } catch (_) {
        /* ignore */
    }
    if (g.connection) {
        try {
            g.connection.destroy();
        } catch (_) {
            /* ignore */
        }
    }

    const guildId = g.guildId;
    const hostAura = sessionHasHostAura(g);
    const thread = client.channels.cache.get(g.threadId);
    const stats = g.playerStats || {};
    const sorted = Object.entries(stats).sort((a, b) => {
        if (b[1].wins !== a[1].wins) return b[1].wins - a[1].wins;
        return a[1].totalTime - b[1].totalTime;
    });

    let res = '🐝 **Spelling Bee ended!**\n\n';
    let winnerText = 'No scores!';
    if (sorted.length > 0) {
        winnerText = `🏆 **Champion:** <@${sorted[0][0]}> with **${sorted[0][1].wins}** words!`;
        sorted.forEach(([uid, s], i) => {
            const t = (s.totalTime / 1000).toFixed(2);
            res += `${i + 1}. <@${uid}> — **${s.wins}** correct (${t}s total)\n`;
            const pts = i < g.pointValues.length ? g.pointValues[i] : DEFAULT_PARTICIPATION_POINTS;
            if (pts > 0) addScore(client, guildId, uid, pts, null, hostAura, 'spellingbee');
            if (i === 0) {
                awardAchievement(client, guildId, thread, uid, 'FIRST_WIN');
                updateUser(guildId, uid, (u) => {
                    u.stats.gamesWon = (u.stats.gamesWon || 0) + 1;
                    u.stats.spellingBeeWins = (u.stats.spellingBeeWins || 0) + 1;
                    for (const key of milestoneAchievementKeys('spellingBeeWins', u.stats.spellingBeeWins)) {
                        awardAchievement(client, guildId, thread, uid, key);
                    }
                });
            }
        });
    } else {
        res += winnerText;
    }

    await announceWinner(client, guildId, 'Spelling Bee', winnerText, g.parentChannelId);
    const beeIds = [...Object.keys(stats)];
    res = appendPremiumGameResultFooter(res);
    if (thread) {
        await thread.send(res);
        await sendGameEndPremiumUpsell(client, thread, guildId, beeIds, {
            gameType: 'SpellingBee',
            sessionId: threadId,
        });
        await sendInviteViralNudgeIfAllowed(guildId, thread);
        await finalizeHostedGameThread(thread, { disableComponents: true });
    }
    await endActiveGame(threadId, client).catch(() => {});
}

function forceEnd(client, threadId) {
    return endSpellingBeeGame(client, threadId);
}

function clearWordRepeatInterval(g) {
    if (g?.wordRepeatIntervalId) {
        clearInterval(g.wordRepeatIntervalId);
        g.wordRepeatIntervalId = null;
    }
}

/** Re-speak the current round word in VC while the round is open. */
function replaySpellingWordInVc(g) {
    if (!g?.currentEntry || !g.roundWaiting) return;
    const tts = synthesizeEnglishWord(g.currentEntry.word);
    if (!tts) return;
    try {
        g.player.stop();
    } catch (_) {
        /* ignore */
    }
    const resource = createAudioResource(tts.wavPath);
    const safety = setTimeout(() => {
        try {
            tts.cleanup();
        } catch (_) {
            /* ignore */
        }
    }, 90_000);
    function onState(os, ns) {
        if (ns.status === AudioPlayerStatus.Idle && os.status !== AudioPlayerStatus.Idle) {
            g.player.off('stateChange', onState);
            clearTimeout(safety);
            try {
                tts.cleanup();
            } catch (_) {
                /* ignore */
            }
        }
    }
    g.player.on('stateChange', onState);
    g.player.play(resource);
}

async function handleMessage(m, client) {
    const g = activeSpellingBees.get(m.channel.id);
    if (!g || !g.roundWaiting || !g.currentEntry) return false;

    const normGuess = normalizeSpelling(m.content);
    if (!normGuess) return false;

    if (normGuess !== normalizeSpelling(g.currentEntry.word)) {
        await m.react('❌').catch(() => {});
        return true;
    }

    await m.react('✅').catch(() => {});

    g.roundWaiting = false;
    clearWordRepeatInterval(g);
    if (g.roundTimeoutId) clearTimeout(g.roundTimeoutId);
    g.roundTimeoutId = null;

    const ms = Date.now() - g.roundStartMs;
    if (!g.playerStats[m.author.id]) g.playerStats[m.author.id] = { wins: 0, totalTime: 0 };
    g.playerStats[m.author.id].wins++;
    g.playerStats[m.author.id].totalTime += ms;

    syncGameScores(m.channel.id, g);

    await m.reply({
        content: `✅ **Correct!** The word was **${g.currentEntry.word}**.`,
        allowedMentions: { users: [] },
    });

    try {
        g.player.stop();
    } catch (_) {
        /* ignore */
    }
    g.currentEntry = null;

    const isLast = g.currentRound >= g.totalRounds;
    if (isLast) {
        await endSpellingBeeGame(client, m.channel.id);
    } else {
        setTimeout(() => {
            const run = g.playNext;
            if (run) run().catch((e) => console.error('[spellingbee] playNext:', e));
        }, 3500);
    }
    return true;
}

/**
 * @param {import('discord.js').Client} client
 * @param {{
 *   guild: import('discord.js').Guild,
 *   hostChannel: import('discord.js').GuildTextBasedChannel,
 *   hostMember: import('discord.js').GuildMember,
 *   voiceChannel: import('discord.js').VoiceBasedChannel,
 *   hostUser: object,
 *   threadName: string,
 *   pointsOption: string,
 *   roundsRequested: number,
 *   answerSeconds: number,
 *   repeatWordEverySec: number,
 *   interaction: import('discord.js').ChatInputCommandInteraction | null,
 * }} ctx
 */
async function startSpellingBeeSession(client, ctx) {
    const {
        guild,
        hostChannel,
        hostMember,
        voiceChannel,
        hostUser,
        threadName,
        pointsOption,
        roundsRequested,
        answerSeconds,
        repeatWordEverySec,
        interaction,
    } = ctx;
    const guildId = guild.id;
    const hostUserId = hostMember.id;

    const tellUser = interaction
        ? async (content) => {
              await interaction.editReply({ content }).catch(() => {});
          }
        : async (content) => {
              await hostChannel.send(content).catch(() => {});
          };

    const wordPool = await buildRoundPool(roundsRequested);
    const totalRounds = wordPool.length;
    if (totalRounds < 1) {
        await tellUser('❌ No words available for spelling bee.');
        return;
    }

    const player = createAudioPlayer();
    player.on('error', (e) => console.error('[spellingbee] AudioPlayer:', e));
    let connection = null;
    let thread;

    try {
        try {
            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guild.id,
                adapterCreator: guild.voiceAdapterCreator,
                selfDeaf: false,
            });
            connection.subscribe(player);
            const onState = (o, n) => playboundDebugLog(`[spellingbee] voice: ${o.status} → ${n.status}`);
            connection.on('stateChange', onState);
            try {
                await entersState(connection, VoiceConnectionStatus.Ready, 120_000);
            } finally {
                connection.off('stateChange', onState);
            }
        } catch (voiceErr) {
            console.error('[spellingbee] voice:', voiceErr);
            try {
                connection?.destroy();
            } catch (_) {
                /* ignore */
            }
            player.stop();
            await tellUser('❌ Could not connect to voice. Check **Connect** / **Speak** and UDP (same as Name That Tune).');
            return;
        }

        const spellingEstMs = totalRounds * (answerSeconds + 150) * 1000;
        throwIfImmediateGameStartBlockedByMaintenance(Date.now(), spellingEstMs);

        thread = await createHostedGamePublicThread(hostChannel, threadName);

        const parsedPoints = parsePointValues(pointsOption, DEFAULT_PLACEMENT_POINTS);
        const game = {
            guildId,
            parentChannelId: hostChannel.id,
            threadId: thread.id,
            voiceChannelId: voiceChannel.id,
            totalRounds,
            currentRound: 0,
            wordPool,
            answerSeconds,
            repeatWordEverySec,
            pointValues: parsedPoints,
            player,
            connection,
            playerStats: {},
            roundWaiting: false,
            roundTimeoutId: null,
            roundStartMs: 0,
            currentEntry: null,
            hostIsPremium: hostUser.isPremium === true,
            premiumAuraBoost: false,
            announcementMessage: null,
            playNext: null,
            wordRepeatIntervalId: null,
            _ending: false,
        };

        activeSpellingBees.set(thread.id, game);
        registerAuraBoostTarget(thread.id, () => {
            const t = activeSpellingBees.get(thread.id);
            if (t) t.premiumAuraBoost = true;
        });

        await createActiveGame(
            guildId,
            hostChannel.id,
            thread.id,
            'SpellingBee',
            { rounds: totalRounds, pointValues: parsedPoints },
            0,
            hostUser.isPremium === true,
            { maintenanceEstimatedDurationMs: spellingEstMs },
        );

        async function playRound() {
            const g = activeSpellingBees.get(thread.id);
            if (!g || g._ending) return;

            clearWordRepeatInterval(g);
            g.currentRound++;
            if (g.currentRound > g.totalRounds) {
                await endSpellingBeeGame(client, thread.id);
                return;
            }

            const entry = g.wordPool[g.currentRound - 1];
            g.currentEntry = entry;
            g.roundWaiting = false;
            if (g.roundTimeoutId) clearTimeout(g.roundTimeoutId);
            g.roundTimeoutId = null;

            const tts = synthesizeEnglishWord(entry.word);
            if (!tts) {
                await thread.send('❌ TTS failed for this word. Ending bee.');
                await endSpellingBeeGame(client, thread.id);
                return;
            }

            await thread.send({
                content: `📣 **Round ${g.currentRound}/${g.totalRounds}** — 🔊 Listen in <#${g.voiceChannelId}>.\n_Meaning:_ ${entry.def}\nThe bot will **say the word**; then type it here.${
                    g.repeatWordEverySec > 0 ? `\n🔁 Repeats every **${g.repeatWordEverySec}s** in voice while the round is open.` : ''
                }`,
            });

            const resource = createAudioResource(tts.wavPath);
            await new Promise((resolve) => {
                const safety = setTimeout(() => {
                    cleanup();
                    tts.cleanup();
                    resolve();
                }, 90_000);
                function onState(os, ns) {
                    if (ns.status === AudioPlayerStatus.Idle && os.status !== AudioPlayerStatus.Idle) {
                        cleanup();
                        clearTimeout(safety);
                        tts.cleanup();
                        resolve();
                    }
                }
                function cleanup() {
                    g.player.off('stateChange', onState);
                }
                g.player.on('stateChange', onState);
                g.player.play(resource);
            });

            if (!activeSpellingBees.has(thread.id) || g._ending) return;

            g.roundWaiting = true;
            g.roundStartMs = Date.now();
            await thread.send(
                `⏱️ **Go!** You have **${g.answerSeconds}s** to spell it in this thread (letters only; no spaces).`,
            );

            if (g.repeatWordEverySec > 0) {
                g.wordRepeatIntervalId = setInterval(() => {
                    const live = activeSpellingBees.get(thread.id);
                    if (!live || !live.roundWaiting || !live.currentEntry) return;
                    replaySpellingWordInVc(live);
                }, g.repeatWordEverySec * 1000);
            }

            g.roundTimeoutId = setTimeout(async () => {
                const live = activeSpellingBees.get(thread.id);
                if (!live || !live.roundWaiting) return;
                clearWordRepeatInterval(live);
                live.roundWaiting = false;
                live.currentEntry = null;
                await thread.send(`⌛ Time! The word was **${entry.word}**.`).catch(() => {});
                if (live.currentRound >= live.totalRounds) {
                    await endSpellingBeeGame(client, thread.id);
                } else {
                    setTimeout(() => playRound().catch((e) => console.error('[spellingbee]', e)), 3500);
                }
            }, g.answerSeconds * 1000);
        }

        game.playNext = playRound;

        const repeatLine =
            repeatWordEverySec > 0 ? `🔁 Word replay in VC every **${repeatWordEverySec}s** during each round.` : '_Word plays once per round (set `repeat_word_seconds` to replay)._';

        await thread.send({
            content: [
                '🐝 **Spelling Bee** (bot-hosted)',
                `🔊 **Join <#${voiceChannel.id}>** — the bot **speaks** each word.`,
                `✍️ **Type the spelling** in this thread after each clip.`,
                `**${totalRounds}** words · **${answerSeconds}s** per round after audio.`,
                repeatLine,
                totalRounds < roundsRequested ? `_(${totalRounds} rounds — word bank size limit)_` : '',
            ]
                .filter(Boolean)
                .join('\n'),
            embeds: [makeGameFlairEmbed('spellingbee')],
            components: [auraBoostRow(thread.id)],
        });

        await hostChannel.send(`🐝 **Spelling Bee** — listen in <#${voiceChannel.id}> · spell in ${thread}.`).catch(() => {});

        game.announcementMessage = await sendGlobalAnnouncement(
            client,
            guildId,
            `A **Spelling Bee** started in <#${hostChannel.id}>! **${totalRounds}** words — hear them in <#${voiceChannel.id}>.`,
            thread.id,
        );

        if (interaction) {
            const fcSuf = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, 0, 'spellingbee');
            await interaction.editReply({
                content: `✅ **Listen:** <#${voiceChannel.id}> · **Spell here:** <#${thread.id}>${fcSuf}`,
            });
            await tryHostPremiumNudge(interaction, hostUser, {
                gameType: 'SpellingBee',
                supportsRepeatHrs: true,
                supportsPremiumCaps: true,
            }).catch(() => {});
        }

        await sendPremiumBoostSessionHint(thread, hostUser.isPremium === true, {
            guildId,
            hostUserId,
            gameType: 'SpellingBee',
            sessionId: thread.id,
            hasAura: false,
        }).catch(() => {});

        await playRound();
    } catch (err) {
        console.error('[spellingbee] start:', err);
        try {
            connection?.destroy();
        } catch (_) {
            /* ignore */
        }
        try {
            player.stop();
        } catch (_) {
            /* ignore */
        }
        if (thread?.id) {
            activeSpellingBees.delete(thread.id);
            await endActiveGame(thread.id, client).catch(() => {});
            await thread.delete().catch(() => {});
        }
        await tellUser(`❌ Could not start: ${err.message || 'Unknown error'}`);
    }
}

async function startSpellingBeeFromScheduled(client, payload) {
    const guild = await client.guilds.fetch(payload.guildId).catch(() => null);
    const hostChannel = await client.channels.fetch(payload.channelId).catch(() => null);
    if (!guild || !hostChannel?.isTextBased?.()) return;
    if ([...activeSpellingBees.values()].some((g) => g.parentChannelId === hostChannel.id)) {
        await hostChannel
            .send('⏭️ **Spelling Bee** (scheduled): skipped — a bee is already running for this channel.')
            .catch(() => {});
        return;
    }
    const member = await guild.members.fetch(payload.hostUserId).catch(() => null);
    if (!member) {
        await hostChannel.send('❌ **Spelling Bee** (scheduled): host not found in this server.').catch(() => {});
        return;
    }
    const voiceChannel = await resolveUserVoiceChannel(guild, payload.hostUserId, member);
    if (!voiceChannel) {
        await hostChannel
            .send(
                `❌ **Spelling Bee** (scheduled): <@${payload.hostUserId}> must be in **voice** when it starts so the bot can speak words.`,
            )
            .catch(() => {});
        return;
    }
    const hostUser = await getUser(payload.guildId, payload.hostUserId);
    await startSpellingBeeSession(client, {
        guild,
        hostChannel,
        hostMember: member,
        voiceChannel,
        hostUser,
        threadName: payload.threadName,
        pointsOption: payload.pointsOption,
        roundsRequested: payload.roundsRequested,
        answerSeconds: payload.answerSeconds,
        repeatWordEverySec: payload.repeatWordEverySec,
        interaction: null,
    });
}

async function startSpellingBeeFromRecurring(client, rec) {
    const d = rec.data || {};
    await startSpellingBeeFromScheduled(client, {
        guildId: rec.guildId,
        channelId: rec.channelId,
        hostUserId: d.hostUserId,
        threadName: d.threadName || defaultGameThreadName('Spelling Bee'),
        pointsOption: d.pointsOption || DEFAULT_PLACEMENT_POINTS,
        roundsRequested: d.roundsRequested,
        answerSeconds: d.answerSeconds ?? 45,
        repeatWordEverySec: typeof d.repeatWordEverySec === 'number' ? d.repeatWordEverySec : 10,
    });
}

async function handleInteraction(interaction, client) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'spellingbee') return false;

    const guildId = interaction.guildId;
    const hostChannel = resolveGameHostChannel(interaction);
    if (!hostChannel) {
        await interaction.reply({
            content:
                '❌ Run this from a **text channel** (or forum). If you are in a **thread**, use the **parent channel**.',
            ephemeral: true,
        });
        return true;
    }

    if ([...activeSpellingBees.values()].some((g) => g.parentChannelId === hostChannel.id)) {
        await interaction.reply({ content: '❌ A **Spelling Bee** is already running for this channel.', ephemeral: true });
        return true;
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    if (!isTtsAvailable()) {
        await interaction.editReply({
            content:
                '❌ **Text-to-speech is not available.** Install **espeak-ng** on the machine running the bot (e.g. `sudo apt install espeak-ng` on Linux), then restart.',
        });
        return true;
    }

    const threadName = interaction.options.getString('thread_name') || defaultGameThreadName('Spelling Bee');
    const pointsOption = interaction.options.getString('points') || DEFAULT_PLACEMENT_POINTS;
    const hostUser = await getUser(guildId, interaction.user.id);
    const roundsRequested = clampHostGameInt(interaction.options.getInteger('rounds'), hostUser.isPremium, 'spellingBeeRounds');
    const answerSeconds = Math.min(600, Math.max(10, interaction.options.getInteger('answer_seconds') ?? 45));
    const repeatWordRaw = interaction.options.getInteger('repeat_word_seconds');
    const repeatWordEverySec = repeatWordRaw === null ? 10 : Math.min(120, Math.max(0, repeatWordRaw));
    const delay = getSlashScheduleDelayMs(interaction);
    const repeatMs = getSlashRepeatIntervalMs(interaction);

    if (repeatMs > 0 && !hostUser.isPremium) {
        await interaction.editReply({ content: '❌ **Recurring games** are a Premium feature! Use `/premium` for Autopilot.' });
        return true;
    }

    if (repeatMs > 0) {
        const nextRun = new Date(Date.now() + delay + repeatMs);
        throwIfGameSchedulingBlocked(nextRun.getTime());
        const { intervalDays, intervalHours } = splitRecurringParts({
            repeat_days: interaction.options.getInteger('repeat_days') || 0,
            repeat_hrs: interaction.options.getInteger('repeat_hrs') || 0,
        });
        await RecurringGame.create({
            guildId,
            channelId: interaction.channelId,
            type: 'spellingbee',
            intervalDays,
            intervalHours,
            data: {
                hostUserId: interaction.user.id,
                roundsRequested,
                answerSeconds,
                repeatWordEverySec,
                pointsOption,
                threadName,
                hostIsPremium: hostUser.isPremium === true,
            },
            nextRun,
        });
        const iv =
            (intervalDays ? `**${intervalDays}** day(s) ` : '') + (intervalHours ? `**${intervalHours}** hour(s)` : '');
        const fcSuf = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, delay, 'spellingbee');
        await interaction.editReply({ content: `✅ Spelling Bee set to repeat every ${iv.trim()}!${fcSuf}` });
        if (delay === 0) {
            await startSpellingBeeFromScheduled(client, {
                guildId,
                channelId: interaction.channelId,
                hostUserId: interaction.user.id,
                threadName,
                pointsOption,
                roundsRequested,
                answerSeconds,
                repeatWordEverySec,
            });
        }
        return true;
    }

    if (delay > 0) {
        throwIfGameSchedulingBlocked(Date.now() + delay);
        const id = Math.random().toString(36).substring(2, 9).toUpperCase();
        const startTime = new Date(Date.now() + delay);
        await Game.create({
            guildId,
            channelId: interaction.channelId,
            type: 'Scheduled_SpellingBee',
            status: 'scheduled',
            startTime,
            state: {
                sid: id,
                originalType: 'SpellingBee',
                hostUserId: interaction.user.id,
                roundsRequested,
                answerSeconds,
                repeatWordEverySec,
                pointsOption,
                threadName,
            },
        });
        setTimeout(async () => {
            await Game.findOneAndUpdate({ 'state.sid': id }, { status: 'ended' });
            await startSpellingBeeFromScheduled(client, {
                guildId,
                channelId: interaction.channelId,
                hostUserId: interaction.user.id,
                threadName,
                pointsOption,
                roundsRequested,
                answerSeconds,
                repeatWordEverySec,
            });
        }, delay);
        const fcSuf2 = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, delay, 'spellingbee');
        await interaction.editReply({ content: `Scheduled! (ID: \`${id}\`)${fcSuf2}` });
        announceScheduledGame(client, guildId, 'Spelling Bee', delay);
        return true;
    }

    const voiceChannel = await resolveUserVoiceChannel(interaction.guild, interaction.user.id, interaction.member);
    if (!voiceChannel) {
        await interaction.editReply({
            content: '❌ Join a **voice channel** first (the bot must see you). Spelling bee **speaks** the word there.',
        });
        return true;
    }

    await startSpellingBeeSession(client, {
        guild: interaction.guild,
        hostChannel,
        hostMember: interaction.member,
        voiceChannel,
        hostUser,
        threadName,
        pointsOption,
        roundsRequested,
        answerSeconds,
        repeatWordEverySec,
        interaction,
    });

    return true;
}

module.exports = {
    activeSpellingBees,
    handleMessage,
    handleInteraction,
    forceEnd,
    endSpellingBeeGame,
    startSpellingBeeFromRecurring,
};
