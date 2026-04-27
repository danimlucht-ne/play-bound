const { Game } = require('../models');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    AttachmentBuilder,
    EmbedBuilder,
} = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const { addScore, updateUser, createActiveGame, updateActiveGame, endActiveGame, getUser } = require('../lib/db');
const {
    throwIfGameSchedulingBlocked,
    throwIfImmediateGameStartBlockedByMaintenance,
} = require('../lib/maintenanceScheduling');
const { FLAIR } = require('../lib/gameFlair');
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
const { DEFAULT_MASTERMIND_WINNER_POINTS, DEFAULT_PARTICIPATION_POINTS } = require('../lib/gamePointsDefaults');
const { getFactionChallengeStaffOverlapSuffix } = require('../lib/factionChallengeHostWarning');

const activeMastermind = new Map();

/** Max guesses per player (Wordle-style board rows). */
const MAX_USER_GUESSES = 6;
const BOARD_ROWS = 6;
/** Swatches for "colors" peg mode (1-based index). */
const PEG_SWATCH_HEX = [
    '#E05D5D',
    '#4A90D9',
    '#3BB273',
    '#D4A43B',
    '#9B59B6',
    '#E07B39',
    '#1ABC9C',
    '#D64D8B',
];

/** Short names for legend (matches PEG_SWATCH_HEX order). */
const PEG_SWATCH_NAMES = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Teal', 'Pink'];

/** @param {*} ctx napi-rs / Canvas 2D context */
function drawPegDigitOverlay(ctx, ch, cx, cy, pr) {
    const fontSize = Math.max(14, Math.floor(pr * 0.92));
    ctx.save();
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    const lw = Math.max(2.5, fontSize / 6);
    ctx.lineWidth = lw;
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.fillStyle = '#f8f8f8';
    ctx.strokeText(ch, cx, cy);
    ctx.fillText(ch, cx, cy);
    ctx.restore();
}

/** @param {*} ctx napi-rs / Canvas 2D context — Wordle-style: green=exact, gold=partial, ring=unused. */
function drawMastermindKeyPeg(ctx, cx, cy, pegR, kind) {
    const x = Math.round(cx) + 0.5;
    const y = Math.round(cy) + 0.5;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, pegR, 0, Math.PI * 2);
    if (kind === 'exact') {
        ctx.fillStyle = '#6aaa64';
        ctx.fill();
    } else if (kind === 'partial') {
        ctx.fillStyle = '#c9b458';
        ctx.fill();
    } else {
        ctx.strokeStyle = '#4e4e52';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
    ctx.restore();
}

/**
 * @param {string} secret digit string
 * @param {string} guess digit string
 * @returns {{ black: number, white: number }}
 */
function mastermindFeedback(secret, guess) {
    const n = secret.length;
    if (guess.length !== n) return { black: 0, white: 0 };
    let black = 0;
    const sRest = [];
    const gRest = [];
    for (let i = 0; i < n; i++) {
        const sc = secret[i];
        const gc = guess[i];
        if (sc === gc) black++;
        else {
            sRest.push(sc);
            gRest.push(gc);
        }
    }
    const count = (arr) => {
        const m = new Map();
        for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
        return m;
    };
    const sm = count(sRest);
    const gm = count(gRest);
    let white = 0;
    for (const [k, v] of gm) {
        white += Math.min(v, sm.get(k) || 0);
    }
    return { black, white };
}

/**
 * @param {number} L
 * @param {number} numColors
 * @param {{ noRepeat?: boolean }} [opts]
 * @returns {string} digit string '1'..'N'
 */
function randomSecret(L, numColors, opts) {
    const noRepeat = opts?.noRepeat === true;
    if (!noRepeat) {
        let s = '';
        for (let i = 0; i < L; i++) {
            s += String(1 + Math.floor(Math.random() * numColors));
        }
        return s;
    }
    if (L > numColors) {
        throw new Error('randomSecret no-repeat requires code length <= pool size');
    }
    const pool = Array.from({ length: numColors }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool
        .slice(0, L)
        .map((n) => String(n))
        .join('');
}

/** @param {string} digitStr normalized digit secret 1-9 per position */
function secretHasUniqueDigits(digitStr) {
    if (!digitStr) return true;
    return new Set(digitStr).size === digitStr.length;
}

/**
 * @param {string} raw
 * @param {number} L
 * @param {number} numColors
 * @returns {string|null} normalized digit string
 */
function parseDigitGuess(raw, L, numColors) {
    const s = String(raw || '')
        .trim()
        .replace(/\s+/g, '');
    if (s.length !== L) return null;
    for (let i = 0; i < s.length; i++) {
        const d = s.charCodeAt(i) - 48;
        if (d < 1 || d > numColors) return null;
    }
    return s;
}

/**
 * @param {string} raw
 * @param {number} L
 * @param {number} numColors
 * @returns {string|null} digit string
 */
function parseLetterGuess(raw, L, numColors) {
    const s = String(raw || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '');
    if (s.length !== L) return null;
    const base = 'A'.charCodeAt(0);
    let out = '';
    for (const ch of s) {
        const o = ch.charCodeAt(0) - base;
        if (o < 0 || o >= numColors) return null;
        out += String(o + 1);
    }
    return out;
}

/**
 * @param {string} raw
 * @param {number} L
 * @param {number} numColors
 * @param {'numbers'|'letters'|'colors'} pegMode
 */
function parseGuessByMode(raw, L, numColors, pegMode) {
    if (pegMode === 'letters') return parseLetterGuess(raw, L, numColors);
    return parseDigitGuess(raw, L, numColors);
}

/**
 * @param {string} digitSecret
 * @param {'numbers'|'letters'|'colors'} pegMode
 */
function formatSecretForDisplay(digitSecret, pegMode) {
    if (pegMode === 'letters') {
        return [...digitSecret].map((d) => String.fromCharCode(64 + Number(d))).join('');
    }
    return digitSecret;
}

/**
 * @param {Array<{ guess: string, black: number, white: number }|null>} userRows
 * @param {object} opts
 * @param {number} [opts.displayRowCount] — rows to draw (default 6; use 1 for thread intro = larger legend)
 * @param {string} [opts.boardTopLabel] — e.g. "Example row" above the grid
 * @param {boolean} [opts.emphasizeLegend] — larger color chips (color mode) for intro
 */
async function generateMastermindBoardImage(userRows, opts) {
    const { codeLength: L, numColors, pegMode, boardTopLabel, emphasizeLegend } = opts;
    let displayRowCount = Number(opts.displayRowCount);
    if (!Number.isFinite(displayRowCount) || displayRowCount < 1) displayRowCount = BOARD_ROWS;
    displayRowCount = Math.min(BOARD_ROWS, Math.max(1, Math.floor(displayRowCount)));

    const gap = 10;
    const tileSize = L <= 5 ? 64 : 54;
    const keyW = 56;
    const cols = L;
    const boardWidth = cols * tileSize + (cols - 1) * gap + 16 + keyW;
    const boardHeight = displayRowCount * tileSize + (displayRowCount - 1) * gap;
    const paddingX = 18;
    const labelH = boardTopLabel ? 22 : 0;
    const paddingTop = 18 + labelH;
    const keyHintBlock = 32;
    const legendGap = pegMode === 'colors' ? 10 : 0;
    const chipR = emphasizeLegend && pegMode === 'colors' ? 14 : 11;
    const legendH = pegMode === 'colors' ? 20 + (chipR * 2 + 18) : 0;
    const paddingBottom = 10 + keyHintBlock + legendGap + legendH;
    const canvas = createCanvas(boardWidth + paddingX * 2, boardHeight + paddingTop + paddingBottom);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#121213';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (boardTopLabel) {
        ctx.save();
        ctx.font = '12px Arial';
        ctx.fillStyle = '#b0b4ba';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(boardTopLabel, paddingX, 16, canvas.width - paddingX * 2);
        ctx.restore();
    }

    for (let row = 0; row < displayRowCount; row++) {
        const g = userRows[row] !== undefined ? userRows[row] : null;
        const y = paddingTop + row * (tileSize + gap);
        const x0 = paddingX;
        for (let col = 0; col < L; col++) {
            const x = x0 + col * (tileSize + gap);
            if (g) {
                const dChar = g.guess[col];
                ctx.fillStyle = '#3a3a3c';
                ctx.fillRect(x, y, tileSize, tileSize);
                if (pegMode === 'colors') {
                    const idx = Number(dChar) - 1;
                    const hex = PEG_SWATCH_HEX[Math.max(0, Math.min(PEG_SWATCH_HEX.length - 1, idx))];
                    const cx = x + tileSize / 2;
                    const cy = y + tileSize / 2;
                    const pr = Math.max(8, tileSize / 2 - 8);
                    ctx.save();
                    ctx.beginPath();
                    ctx.fillStyle = hex;
                    ctx.arc(cx, cy, pr, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                    ctx.restore();
                    drawPegDigitOverlay(ctx, dChar, cx, cy, pr);
                } else {
                    const label =
                        pegMode === 'letters'
                            ? String.fromCharCode(64 + Number(dChar))
                            : dChar;
                    ctx.save();
                    ctx.fillStyle = '#ffffff';
                    ctx.font = `bold ${pegMode === 'letters' ? 32 : 34}px Arial`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(label, x + tileSize / 2, y + tileSize / 2 + 1);
                    ctx.restore();
                }
            } else {
                ctx.strokeStyle = '#3a3a3c';
                ctx.lineWidth = 2;
                ctx.strokeRect(x, y, tileSize, tileSize);
            }
        }
        if (g) {
            const { black, white } = g;
            const pegR = 5.5;
            const rowCenterY = y + (tileSize >> 1) + 0.5;
            let ix = x0 + L * (tileSize + gap) + 8;
            for (let p = 0; p < L; p++) {
                const cx = ix + p * (pegR * 2 + 3);
                let kind = 'empty';
                if (p < black) kind = 'exact';
                else if (p < black + white) kind = 'partial';
                drawMastermindKeyPeg(ctx, cx, rowCenterY, pegR, kind);
            }
        }
    }

    {
        const yK = paddingTop + boardHeight + 4;
        const maxW = canvas.width - paddingX * 2;
        ctx.save();
        ctx.font = '11px Arial';
        ctx.fillStyle = '#9aa0a6';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Key (right of grid): green = value + slot · gold = value only, wrong slot · ring = unused', paddingX, yK, maxW);
        ctx.font = '10px Arial';
        ctx.fillText('(Order of green/gold is not 1:1 with slots — use the two counts.)', paddingX, yK + 14, maxW);
        ctx.restore();
    }

    if (pegMode === 'colors' && numColors > 0) {
        const yLeg = paddingTop + boardHeight + keyHintBlock + legendGap;
        ctx.save();
        ctx.font = '12px Arial';
        ctx.fillStyle = '#9aa0a6';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('Digit → color (type the digit in your guess)', paddingX, yLeg);
        ctx.restore();

        const labelY = yLeg + 16;
        const n = Math.min(numColors, PEG_SWATCH_HEX.length);
        const legendInnerW = boardWidth;
        const slotW = legendInnerW / n;

        for (let i = 0; i < n; i++) {
            const digit = String(i + 1);
            const hex = PEG_SWATCH_HEX[i];
            const name = PEG_SWATCH_NAMES[i] || '';
            const cx = paddingX + slotW * (i + 0.5);
            const cy = labelY + chipR;
            ctx.save();
            ctx.beginPath();
            ctx.fillStyle = hex;
            ctx.arc(cx, cy, chipR, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.4)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
            drawPegDigitOverlay(ctx, digit, cx, cy, chipR);
            ctx.save();
            ctx.font = '10px Arial';
            ctx.fillStyle = '#b0b4ba';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(name, cx, cy + chipR + 3);
            ctx.restore();
        }
    }

    return canvas.toBuffer('image/png');
}

/**
 * @param {string} customCode
 * @param {number} L
 * @param {number} numColors
 * @param {'numbers'|'letters'|'colors'} pegMode
 * @returns {string|null}
 */
function parseCustomCode(customCode, L, numColors, pegMode) {
    if (!customCode) return null;
    return parseGuessByMode(customCode, L, numColors, pegMode);
}

/**
 * @param {Array} guessLog
 * @param {string} userId
 * @returns {Array<{ guess: string, black: number, white: number }|null>}
 */
function buildUserBoardRows(guessLog, userId) {
    const mine = guessLog.filter((e) => e.userId === userId);
    const out = [];
    for (let i = 0; i < BOARD_ROWS; i++) {
        if (i < mine.length) {
            const e = mine[i];
            out.push({ guess: e.guess, black: e.black, white: e.white });
        } else {
            out.push(null);
        }
    }
    return out;
}

function formatDuration(ms) {
    if (ms < 0) ms = 0;
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    if (m > 0) return `${m}m ${r}s`;
    if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
    return `${sec}s`;
}

function pegModeLine(pegMode) {
    if (pegMode === 'letters') return 'Letters: A, B, C… = 1, 2, 3… in order.';
    if (pegMode === 'colors') return 'Color mode: type digits 1–N; the board shows the digit on each swatch, key under the grid.';
    return 'Numbers: digits 1–N only per slot.';
}

async function triggerMastermindEnd(client, threadId) {
    const g = activeMastermind.get(threadId);
    if (!g) return;

    const guildId = g.guildId;
    const hostAura = sessionHasHostAura(g);
    unregisterAuraBoostTarget(threadId);
    if (g.announcementMessage) {
        try {
            await g.announcementMessage.delete();
        } catch (_) {}
    }

    const thread = client.channels.cache.get(g.threadId);
    const show = formatSecretForDisplay(g.secret, g.pegMode || 'numbers');
    const line = `⏰ **Mastermind over!** Nobody cracked the code in time.
The code was: \`${show}\``;

    const winnerText = 'No winner!';
    await announceWinner(client, guildId, 'Mastermind', winnerText, g.parentChannelId);

    for (const pid of g.participantIds) {
        if (DEFAULT_PARTICIPATION_POINTS > 0) {
            addScore(client, guildId, pid, DEFAULT_PARTICIPATION_POINTS, null, hostAura, 'mastermind');
        }
    }

    const guessIds = [...g.participantIds];
    let result = appendPremiumGameResultFooter(line);
    if (thread) {
        await thread.send(result);
        await sendGameEndPremiumUpsell(client, thread, guildId, guessIds, {
            gameType: 'Mastermind',
            sessionId: threadId,
        });
        await sendInviteViralNudgeIfAllowed(guildId, thread);
        await finalizeHostedGameThread(thread, { disableComponents: true });
    }

    clearTimeout(g.timeoutHandle);
    activeMastermind.delete(threadId);
    await endActiveGame(threadId, client).catch(() => {});
}

async function finishMastermindWin(client, threadId, winnerId, solveTimeMs, guessCount) {
    const g = activeMastermind.get(threadId);
    if (!g) return;
    g.winnerId = winnerId;

    const guildId = g.guildId;
    const hostAura = sessionHasHostAura(g);
    unregisterAuraBoostTarget(threadId);
    if (g.announcementMessage) {
        try {
            await g.announcementMessage.delete();
        } catch (_) {}
    }

    const winPtsRaw = g.pointValues?.[0];
    const pts = typeof winPtsRaw === 'number' && winPtsRaw > 0 ? winPtsRaw : 25;

    addScore(client, guildId, winnerId, pts, null, hostAura, 'mastermind');
    awardAchievement(client, guildId, null, winnerId, 'FIRST_WIN');
    if (solveTimeMs < 120000) {
        awardAchievement(client, guildId, null, winnerId, 'CODEBREAKER');
    }

    updateUser(guildId, winnerId, (u) => {
        u.stats.gamesWon = (u.stats.gamesWon || 0) + 1;
        u.stats.mastermindWins = (u.stats.mastermindWins || 0) + 1;
        for (const key of milestoneAchievementKeys('mastermindWins', u.stats.mastermindWins)) {
            awardAchievement(client, guildId, null, winnerId, key);
        }
    });

    for (const pid of g.participantIds) {
        if (pid === winnerId) continue;
        if (DEFAULT_PARTICIPATION_POINTS > 0) {
            addScore(client, guildId, pid, DEFAULT_PARTICIPATION_POINTS, null, hostAura, 'mastermind');
        }
    }

    const winnerText = `🏆 <@${winnerId}> cracked it in **${formatDuration(solveTimeMs)}** (${guessCount} guess${
        guessCount === 1 ? '' : 'es'
    })!`;
    await announceWinner(client, guildId, 'Mastermind', winnerText, g.parentChannelId);

    const thread = client.channels.cache.get(threadId);
    const guessIds = [...g.participantIds];
    const show = formatSecretForDisplay(g.secret, g.pegMode || 'numbers');
    let result = `🎉 **Solved!** ${winnerText}
The code was \`${show}\`. **+${pts}** pts to the winner.`;
    result = appendPremiumGameResultFooter(result);
    if (thread) {
        await thread.send(result);
        await sendGameEndPremiumUpsell(client, thread, guildId, guessIds, {
            gameType: 'Mastermind',
            sessionId: threadId,
        });
        await sendInviteViralNudgeIfAllowed(guildId, thread);
        await finalizeHostedGameThread(thread, { disableComponents: true });
    }

    clearTimeout(g.timeoutHandle);
    activeMastermind.delete(threadId);
    await endActiveGame(threadId, client).catch(() => {});
}

function mastermindSubmitButtonRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('mastermind_guess_btn')
            .setLabel('🎯 Submit guess')
            .setStyle(ButtonStyle.Primary),
    );
}

/**
 * @param {object} opts
 * @param {boolean} [opts.solved]
 * @param {boolean} [opts.outOfGuesses]
 * @param {object} [opts.turnSummary] `showGuess, black, white, guessIndex, elapsedLabel`
 */
function buildMastermindTurnDescription(opts) {
    const { solved, outOfGuesses, turnSummary } = opts;
    if (!turnSummary) {
        if (solved) return `🎉 **Solved!**`;
        if (outOfGuesses) return `❌ **Out of personal guesses** (${MAX_USER_GUESSES} max). The game is still on for others.`;
        return '';
    }
    const oneLine = `**${turnSummary.showGuess}**  →  **${turnSummary.black}** in the right place · **${turnSummary.white}** right value, wrong place  ·  _${turnSummary.elapsedLabel} · #${turnSummary.guessIndex}_`;
    if (solved) {
        return `🎉 **Solved!** in **${turnSummary.guessIndex}** tr${turnSummary.guessIndex === 1 ? 'y' : 'ies'}.\n\n${oneLine}`;
    }
    if (outOfGuesses) {
        return `❌ **Out of guesses** (${MAX_USER_GUESSES} per player).\n\n**Last try:**\n${oneLine}\n\n_Others can still play._`;
    }
    return `**This round:**\n${oneLine}`;
}

async function replyMastermindEmbed(
    interaction,
    g,
    userId,
    { solved, outOfGuesses, turnSummary } = {},
) {
    g.boardLastInteraction = g.boardLastInteraction || new Map();
    const lastBoardInteraction = g.boardLastInteraction.get(userId);

    const userRows = buildUserBoardRows(g.guessLog, userId);
    const buffer = await generateMastermindBoardImage(userRows, {
        codeLength: g.codeLength,
        numColors: g.numColors,
        pegMode: g.pegMode || 'numbers',
    });
    const attachment = new AttachmentBuilder(buffer, { name: 'mastermind.png' });
    const guessN = g.guessLog.filter((e) => e.userId === userId).length;
    const canSubmitAgain = !solved && !outOfGuesses && guessN < MAX_USER_GUESSES;
    const body = buildMastermindTurnDescription({ solved, outOfGuesses, turnSummary });
    const boardFooter =
        !solved && !outOfGuesses
            ? 'On the image: green = right place · gold = right value, wrong slot — the column shows counts, not 1:1 to holes.'
            : '';
    const buildBaseEmbed = (title) => {
        const e = new EmbedBuilder()
            .setColor('#121213')
            .setImage('attachment://mastermind.png')
            .setTitle(title);
        if (body) e.setDescription(body);
        if (boardFooter) e.setFooter({ text: boardFooter });
        return e;
    };
    const boardEmbed = buildBaseEmbed('🎯 Your board');
    if (solved) {
        boardEmbed.setFooter({ text: 'See the game thread for the code and points.' });
    } else if (outOfGuesses) {
        boardEmbed.setFooter({ text: 'Out of personal guesses — follow the game thread to watch others.' });
    } else if (boardFooter) {
        boardEmbed.setFooter({
            text: `${boardFooter} Tap **🎯 Submit** below for the next guess.`,
        });
    } else {
        boardEmbed.setFooter({ text: 'Use **🎯 Submit** below for the next guess.' });
    }
    const payload = {
        embeds: [boardEmbed],
        files: [attachment],
        components: canSubmitAgain ? [mastermindSubmitButtonRow()] : [],
    };

    await interaction.reply({ ...payload, ephemeral: true });
    if (lastBoardInteraction) {
        try {
            await lastBoardInteraction.deleteReply();
        } catch (_) {
            /* same as Serverdle: ignore (message already gone, etc.) */
        }
    }
    g.boardLastInteraction.set(userId, interaction);
}

module.exports = {
    async handleInteraction(interaction, client) {
        const customId = interaction.customId;

        if (interaction.isChatInputCommand() && interaction.commandName === 'mastermind') {
            const guildId = interaction.guildId;
            const duration = interaction.options.getInteger('duration') || 45;
            const codeLen = interaction.options.getInteger('code_length') || 5;
            const isEasy = interaction.options.getString('difficulty') === 'easy';
            const rawColors = interaction.options.getInteger('colors');
            const numColors = isEasy
                ? 6
                : [5, 6, 7, 8].includes(rawColors)
                  ? rawColors
                  : 6;
            const rawPeg = interaction.options.getString('peg_mode');
            const pegMode = rawPeg === 'letters' || rawPeg === 'colors' || rawPeg === 'numbers' ? rawPeg : 'numbers';
            const customCode = interaction.options.getString('custom_code');
            const threadName =
                interaction.options.getString('thread_name') ||
                defaultGameThreadName(`Mastermind (${codeLen}·${numColors}·${pegMode}·${isEasy ? 'E' : 'H'})`);
            const pointsOption = interaction.options.getString('points') || DEFAULT_MASTERMIND_WINNER_POINTS;
            const delay = getSlashScheduleDelayMs(interaction);
            const slowMode = interaction.options.getInteger('slow_mode') || 0;

            await interaction.deferReply({ ephemeral: true });
            const hostUser = await getUser(guildId, interaction.user.id);

            if (codeLen < 4 || codeLen > 6) {
                return interaction.editReply({ content: '❌ **code_length** must be **4**, **5**, or **6**.' });
            }

            let secret;
            if (customCode) {
                const p = parseCustomCode(customCode, codeLen, numColors, pegMode);
                if (!p) {
                    return interaction.editReply({
                        content:
                            pegMode === 'letters'
                                ? `❌ **custom_code** must be **${codeLen}** letters (${String.fromCharCode(65)}–${String.fromCharCode(64 + numColors)}).`
                                : `❌ **custom_code** must be **${codeLen}** digits, each from **1** to **${numColors}** (no spaces).`,
                    });
                }
                if (isEasy && !secretHasUniqueDigits(p)) {
                    return interaction.editReply({
                        content: `❌ **Easy** mode: **custom_code** may not repeat the same value; every position is different (like the random **Easy** secret).`,
                    });
                }
                secret = p;
            } else {
                try {
                    secret = randomSecret(codeLen, numColors, { noRepeat: isEasy });
                } catch (e) {
                    return interaction.editReply({ content: '❌ Could not build a no-repeat code for that length. Try a shorter code length for **Easy**.' });
                }
            }

            const start = async () => {
                throwIfImmediateGameStartBlockedByMaintenance(Date.now(), duration * 60000);
                const thread = await createHostedGamePublicThread(interaction.channel, threadName);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('mastermind_guess_btn')
                        .setLabel('🎯 Submit guess')
                        .setStyle(ButtonStyle.Primary),
                );
                const auraR = auraBoostRow(thread.id);
                const sample = pegMode === 'letters' ? 'A'.repeat(codeLen) : '1'.repeat(codeLen);
                const startBoardBuf = await generateMastermindBoardImage([null], {
                    codeLength: codeLen,
                    numColors,
                    pegMode,
                    displayRowCount: 1,
                    boardTopLabel: `Example row — your game has ${MAX_USER_GUESSES} such rows (private board)`,
                    emphasizeLegend: pegMode === 'colors',
                });
                const startBoardFile = new AttachmentBuilder(startBoardBuf, { name: 'mastermind-board.png' });
                const boardIntroEmbed = new EmbedBuilder()
                    .setColor('#121213')
                    .setImage('attachment://mastermind-board.png');
                if (pegMode === 'colors') {
                    boardIntroEmbed
                        .setTitle('🎯 Color key — use digits 1–' + numColors)
                        .setDescription(
                            `**1 = leftmost swatch … ${numColors} = rightmost** in the key under the image. ` +
                                `One guess = **${codeLen}** digits (e.g. \`${sample.slice(0, codeLen)}\`). ` +
                                `**🎯** is below. Your **private** board (only you) works like **Serverdle**: a new line each guess, then the previous is cleared.`,
                        );
                } else {
                    boardIntroEmbed
                        .setTitle('🎯 Your board')
                        .setDescription(
                            `**${codeLen}** positions · **1–${numColors}** per cell` +
                                (pegMode === 'letters' ? ` (A–${String.fromCharCode(64 + numColors)})` : '') +
                                ` · e.g. \`${sample.slice(0, codeLen)}\`. ` +
                                `**🎯** below — private board is **ephemeral** in this thread (same **Serverdle** pattern: latest guess replaces the last private line).`,
                        );
                }
                boardIntroEmbed.setFooter({
                    text: `${pegModeLine(pegMode)} · ${MAX_USER_GUESSES} guess rows each · key: green = right place · gold = right value, wrong slot`,
                });

                const mc = FLAIR.mastermind;
                if (mc && mc.titles?.length && mc.lines?.length) {
                    const t = mc.titles[Math.floor(Math.random() * mc.titles.length)];
                    const d = mc.lines[Math.floor(Math.random() * mc.lines.length)];
                    boardIntroEmbed.addFields({ name: String(t).slice(0, 256), value: String(d).slice(0, 1024) });
                }

                const introLine = `⏱️ **${duration}** min · **${codeLen}** positions · **${
                    isEasy ? 'Easy' : 'Hard'
                }** — ${
                    isEasy
                        ? '**6** possible values per slot, but the **secret** uses **no repeated** values (each color/number/letter at most once).'
                        : `**1**–**${numColors}** per slot; the **secret** may **repeat** values.`
                } First to crack the code wins.`;

                await thread.send({
                    content: introLine,
                    embeds: [boardIntroEmbed],
                    files: [startBoardFile],
                    components: [row, auraR],
                });

                const startTime = Date.now();
                const state = {
                    secret,
                    codeLength: codeLen,
                    numColors,
                    pegMode,
                    difficulty: isEasy ? 'easy' : 'hard',
                    startTime,
                    pointValues: parsePointValues(pointsOption, DEFAULT_MASTERMIND_WINNER_POINTS),
                    guessLog: [],
                    won: false,
                    participants: {},
                };
                await createActiveGame(
                    guildId,
                    interaction.channelId,
                    thread.id,
                    'Mastermind',
                    state,
                    duration,
                    hostUser.isPremium === true,
                );

                const gameData = {
                    guildId,
                    parentChannelId: interaction.channelId,
                    threadId: thread.id,
                    secret,
                    codeLength: codeLen,
                    numColors,
                    pegMode,
                    difficulty: isEasy ? 'easy' : 'hard',
                    startTime,
                    pointValues: parsePointValues(pointsOption, DEFAULT_MASTERMIND_WINNER_POINTS),
                    guessLog: [],
                    participantIds: new Set(),
                    won: false,
                    hostIsPremium: hostUser.isPremium === true,
                    premiumAuraBoost: false,
                    /** @type {Map<string, import('discord.js').BaseInteraction>} userId -> prior modal interaction (Serverdle-style deleteReply) */
                    boardLastInteraction: new Map(),
                    timeoutHandle: setTimeout(() => triggerMastermindEnd(client, thread.id), duration * 60000),
                };
                activeMastermind.set(thread.id, gameData);
                registerAuraBoostTarget(thread.id, () => {
                    const a = activeMastermind.get(thread.id);
                    if (a) a.premiumAuraBoost = true;
                });

                if (slowMode > 0) await thread.setRateLimitPerUser(slowMode).catch(() => {});

                const annWinPts =
                    typeof gameData.pointValues?.[0] === 'number' && gameData.pointValues[0] > 0
                        ? gameData.pointValues[0]
                        : 25;
                gameData.announcementMessage = await sendGlobalAnnouncement(
                    client,
                    guildId,
                    `A **Mastermind** has started in <#${interaction.channelId}>! **${duration}** min — **+${annWinPts}** pts to whoever cracks the code first; other guessers get **+${DEFAULT_PARTICIPATION_POINTS}** participation.`,
                    thread.id,
                );
                return thread.id;
            };

            if (delay > 0) {
                throwIfGameSchedulingBlocked(Date.now() + delay);
                const sid = Math.random().toString(36).substring(2, 9).toUpperCase();
                const startTime = new Date(Date.now() + delay);
                await Game.create({
                    guildId,
                    channelId: interaction.channelId,
                    type: 'Scheduled_Mastermind',
                    status: 'scheduled',
                    startTime,
                    state: { sid, originalType: 'Mastermind' },
                });

                setTimeout(async () => {
                    await Game.findOneAndUpdate({ 'state.sid': sid }, { status: 'ended' });
                    await start();
                }, delay);
                const fcSuf = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, delay, 'mastermind');
                const modeLabel =
                    pegMode === 'colors' ? 'Color swatches' : pegMode === 'letters' ? 'Letters' : 'Numbers';
                const levelLabel = isEasy ? 'Easy' : 'Hard';
                await interaction.editReply({
                    content: `Scheduled! (ID: \`${sid}\`) · **Mode:** ${modeLabel} · **${levelLabel}**${fcSuf}`,
                });
                announceScheduledGame(client, guildId, 'Mastermind', delay);
            } else {
                const fcSuf2 = await getFactionChallengeStaffOverlapSuffix(interaction, guildId, 0, 'mastermind');
                const modeLabel =
                    pegMode === 'colors' ? 'Color swatches' : pegMode === 'letters' ? 'Letters' : 'Numbers';
                const levelLabel2 = isEasy ? 'Easy' : 'Hard';
                await interaction.editReply({
                    content: `Mastermind started! **Mode:** ${modeLabel} · **${levelLabel2}** (${codeLen}×${numColors}).${fcSuf2}`,
                });
                const tid = await start();
                if (tid) {
                    const th = await client.channels.fetch(tid).catch(() => null);
                    if (th) {
                        await tryHostPremiumNudge(interaction, hostUser, {
                            gameType: 'Mastermind',
                            supportsRepeatHrs: false,
                            supportsPremiumCaps: false,
                        }).catch(() => {});
                        await sendPremiumBoostSessionHint(th, hostUser.isPremium === true, {
                            guildId,
                            hostUserId: interaction.user.id,
                            gameType: 'Mastermind',
                            sessionId: th.id,
                            hasAura: false,
                        }).catch(() => {});
                    }
                }
            }
            return true;
        }

        if (interaction.isButton() && customId === 'mastermind_guess_btn') {
            const g = activeMastermind.get(interaction.channelId);
            if (!g) {
                return interaction.reply({ content: 'This game has ended.', ephemeral: true });
            }
            if (g.won) {
                return interaction.reply({ content: 'Someone already cracked the code!', ephemeral: true });
            }
            const myTry = g.guessLog.filter((e) => e.userId === interaction.user.id).length;
            if (myTry >= MAX_USER_GUESSES) {
                return interaction.reply({ content: `You’ve used all **${MAX_USER_GUESSES}** guesses.`, ephemeral: true });
            }
            const m = new ModalBuilder().setCustomId('mastermind_modal').setTitle('Mastermind');
            const pegMode = g.pegMode || 'numbers';
            const label =
                pegMode === 'letters'
                    ? `${g.codeLength} letters (A–${String.fromCharCode(64 + g.numColors)})`
                    : `${g.codeLength} digits (1–${g.numColors})`;
            const i = new TextInputBuilder()
                .setCustomId('mastermind_input')
                .setLabel(label)
                .setStyle(TextInputStyle.Short)
                .setMinLength(g.codeLength)
                .setMaxLength(g.codeLength)
                .setRequired(true);
            m.addComponents(new ActionRowBuilder().addComponents(i));
            await interaction.showModal(m);
            return true;
        }

        if (interaction.isModalSubmit() && customId === 'mastermind_modal') {
            const g = activeMastermind.get(interaction.channelId);
            if (!g) {
                return interaction.reply({ content: 'This game has ended.', ephemeral: true });
            }
            if (g.won) {
                return interaction.reply({ content: 'Someone already cracked the code!', ephemeral: true });
            }
            const uid = interaction.user.id;
            if (g.guessLog.filter((e) => e.userId === uid).length >= MAX_USER_GUESSES) {
                return interaction.reply({ content: `You’ve used all **${MAX_USER_GUESSES}** guesses.`, ephemeral: true });
            }

            const raw = interaction.fields.getTextInputValue('mastermind_input');
            const pegMode = g.pegMode || 'numbers';
            const guess = parseGuessByMode(raw, g.codeLength, g.numColors, pegMode);
            if (!guess) {
                const err =
                    pegMode === 'letters'
                        ? `Use exactly **${g.codeLength}** letters: **A** to **${String.fromCharCode(64 + g.numColors)}** (no spaces).`
                        : `Use exactly **${g.codeLength}** digits from **1** to **${g.numColors}** (no spaces). Colors mode still uses number keys.`;
                return interaction.reply({ content: err, ephemeral: true });
            }

            const { black, white } = mastermindFeedback(g.secret, guess);
            if (black === g.codeLength && g.won) {
                return interaction.reply({ content: 'Someone else just solved it!', ephemeral: true });
            }

            g.participantIds.add(uid);
            g.guessLog.push({ userId: uid, guess, black, white, t: Date.now() });
            if (black === g.codeLength) g.won = true;

            const guessIndex = g.guessLog.filter((x) => x.userId === uid).length;
            const elapsed = Date.now() - g.startTime;
            const showGuess = formatSecretForDisplay(guess, pegMode);
            const line = `**<@${uid}>**  \`${showGuess}\`  →  **${black}** in the right place · **${white}** right value, wrong place  ·  _${formatDuration(elapsed)} since start_  (#${guessIndex})`;
            const turnSummary = {
                showGuess,
                black,
                white,
                guessIndex,
                elapsedLabel: `${formatDuration(elapsed)} since start`,
            };

            updateActiveGame(g.threadId, (st) => {
                if (!st || typeof st !== 'object') return;
                if (!st.players) st.players = {};
                if (!st.participants) st.participants = {};
                st.guessLog = g.guessLog;
                st.participants[uid] = (st.participants[uid] || 0) + 1;
            });

            const outOf = guessIndex >= MAX_USER_GUESSES && black < g.codeLength;

            if (outOf) {
                await replyMastermindEmbed(interaction, g, uid, { outOfGuesses: true, turnSummary });
                try {
                    await interaction.channel.send(
                        `**<@${uid}>** used all **${MAX_USER_GUESSES}** guesses — not the code. _(Still playing for others.)_`,
                    );
                } catch (e) {
                    console.error('mastermind public send', e);
                }
                return true;
            }

            if (black === g.codeLength) {
                const solveTime = Date.now() - g.startTime;
                await replyMastermindEmbed(interaction, g, uid, { solved: true, turnSummary });
                try {
                    await interaction.channel.send(line + '\n✅ **CODE SOLVED!**');
                } catch (e) {
                    console.error('mastermind public send', e);
                }
                await finishMastermindWin(client, g.threadId, uid, solveTime, guessIndex);
                return true;
            }

            try {
                await replyMastermindEmbed(interaction, g, uid, { turnSummary });
            } catch (e) {
                console.error('mastermind embed', e);
                const fallback = `✅ Guess recorded: **${black}** in the right place · **${white}** right value, wrong place. _Board image failed to render._`;
                try {
                    if (interaction.deferred) {
                        await interaction.editReply({ content: fallback });
                    } else if (interaction.replied) {
                        await interaction.followUp({ content: fallback, ephemeral: true });
                    } else {
                        await interaction.reply({ content: fallback, ephemeral: true });
                    }
                } catch (_) {
                    /* ignore */
                }
            }
            try {
                await interaction.channel.send(line);
            } catch (e) {
                console.error('mastermind public send', e);
            }
            return true;
        }

        return false;
    },
    forceEnd(client, threadId) {
        if (activeMastermind.has(threadId)) {
            triggerMastermindEnd(client, threadId);
            return true;
        }
        return false;
    },
    getActiveGames() {
        return activeMastermind;
    },
};
