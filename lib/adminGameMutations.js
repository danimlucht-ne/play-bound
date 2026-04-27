'use strict';

const { Game, RecurringGame } = require('../models');
const { endActiveGame } = require('./db');
const { finalizeHostedGameThread } = require('./gameThreadLifecycle');

const guessthenumberGame = require('../games/guessthenumber');
const mastermindGame = require('../games/mastermind');
const spellingBeeGame = require('../games/spellingbee');
const serverdleGame = require('../games/serverdle');
const triviaGame = require('../games/trivia');

/**
 * Force-end, cancel, or delete a game session (aligned with `/endgame` + `endgame_select`).
 *
 * @param {object} ctx
 * @param {import('discord.js').Client} ctx.client
 * @param {object} ctx.state
 * @param {object} ctx.triggers
 * @param {string} ctx.guildId
 * @param {'active'|'scheduled'|'recurring'} kind
 * @param {string} id thread id, scheduled sid, or recurring Mongo id
 */
async function adminTerminateGame(ctx, kind, id) {
    const { client, state, triggers, guildId } = ctx;
    const { scheduledGames, activeGiveaways, activeSprints, activeCaptions, activeTunes, activeMovieGames, activeUnscrambles } =
        state;
    const { triggerTriviaSprintEnd, triggerCaptionEnd, triggerTuneEnd, triggerMovieEnd, triggerUnscrambleEnd } = triggers;

    if (kind === 'recurring') {
        const doc = await RecurringGame.findById(id);
        if (!doc || doc.guildId !== guildId) {
            return { ok: false, code: 'not_found', message: 'Recurring game not found in this server.' };
        }
        await RecurringGame.findByIdAndDelete(id);
        return { ok: true };
    }

    if (kind === 'scheduled') {
        if (scheduledGames.has(id)) {
            const sched = scheduledGames.get(id);
            if (sched.guildId !== guildId) {
                return { ok: false, code: 'forbidden', message: 'Scheduled item belongs to another server.' };
            }
            clearTimeout(sched.timeoutHandle);
            scheduledGames.delete(id);
        }
        await Game.findOneAndUpdate({ guildId, 'state.sid': id, status: 'scheduled' }, { status: 'ended' });
        await Game.findOneAndUpdate({ 'state.sid': id, status: 'scheduled' }, { status: 'ended' });
        return { ok: true };
    }

    if (kind === 'active') {
        if (activeGiveaways.has(id)) {
            const ga = activeGiveaways.get(id);
            if (ga.guildId !== guildId) {
                return { ok: false, code: 'forbidden', message: 'Giveaway belongs to another server.' };
            }
            clearTimeout(ga.timeoutHandle);
            activeGiveaways.delete(id);
            await endActiveGame(id, client);
            const thread = client.channels.cache.get(ga.threadId);
            if (thread) {
                try {
                    await thread.send('⚠️ This giveaway was cancelled via the PlayBound admin panel.');
                    await finalizeHostedGameThread(thread, { disableComponents: true });
                } catch (_) {
                    /* ignore */
                }
            }
            return { ok: true };
        }

        const existing = await Game.findOne({ threadId: id, status: 'active' }).lean();
        if (!existing || existing.guildId !== guildId) {
            return { ok: false, code: 'not_found', message: 'No active game with that id in this server.' };
        }

        const dbGame = await endActiveGame(id, client);
        if (!dbGame) {
            return { ok: false, code: 'not_found', message: 'Could not end game.' };
        }

        guessthenumberGame.forceEnd(client, id);
        mastermindGame.forceEnd(client, id);
        spellingBeeGame.forceEnd(client, id);
        serverdleGame.forceEnd(client, id);
        triviaGame.forceEnd(client, id);
        if (activeSprints.has(id)) triggerTriviaSprintEnd(id);
        if (activeCaptions.has(id)) triggerCaptionEnd(id);
        if (activeTunes.has(id)) triggerTuneEnd(id);
        if (activeMovieGames.has(id)) triggerMovieEnd(id);
        if (activeUnscrambles.has(id)) triggerUnscrambleEnd(id);

        return { ok: true };
    }

    return { ok: false, code: 'invalid_kind', message: 'Invalid kind.' };
}

module.exports = { adminTerminateGame };
