'use strict';

const { ChannelType } = require('discord.js');
const { disableComponentsInThread } = require('./utils');
const { recurringIntervalMs } = require('./recurringInterval');

/** Auto-archive duration (minutes) for hosted mini-game threads. */
const HOSTED_GAME_THREAD_AUTO_ARCHIVE_MINUTES = 1440;

/** Auto-archive duration (minutes) for `/playgame` platform threads (short sessions). */
const PLATFORM_GAME_THREAD_AUTO_ARCHIVE_MINUTES = 60;

/** After archiving, delete the thread after this delay so logs stay readable briefly. */
const HOSTED_GAME_THREAD_DELETE_DELAY_MS = 86400000;

/**
 * @param {import('discord.js').TextChannel} channel
 * @param {string} name
 */
async function createHostedGamePublicThread(channel, name) {
    return channel.threads.create({
        name: String(name).slice(0, 100),
        autoArchiveDuration: HOSTED_GAME_THREAD_AUTO_ARCHIVE_MINUTES,
        reason: 'Hosted game',
    });
}

/**
 * @param {import('discord.js').TextChannel} channel
 * @param {string} name
 */
async function createHostedGamePrivateThread(channel, name) {
    return channel.threads.create({
        name: String(name).slice(0, 100),
        type: ChannelType.PrivateThread,
        invitable: false,
        autoArchiveDuration: HOSTED_GAME_THREAD_AUTO_ARCHIVE_MINUTES,
        reason: 'Hosted game',
    });
}

/**
 * @param {import('discord.js').GuildTextBasedChannel} channel
 * @param {string} name
 * @param {string} displayNameForReason
 * @param {{ privateThread?: boolean }} [opts]
 */
async function createPlatformGameThread(channel, name, displayNameForReason, opts = {}) {
    const threadOptions = {
        name: String(name).slice(0, 100),
        autoArchiveDuration: PLATFORM_GAME_THREAD_AUTO_ARCHIVE_MINUTES,
        reason: `PlayBound: ${displayNameForReason}`,
    };
    if (opts.privateThread) {
        threadOptions.type = ChannelType.PrivateThread;
        threadOptions.invitable = false;
    }
    return channel.threads.create(threadOptions);
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
function getSlashScheduleDelayMs(interaction) {
    return (
        (interaction.options.getInteger('delay_hrs') || 0) * 3600000 +
        (interaction.options.getInteger('delay_days') || 0) * 86400000
    );
}

/**
 * Premium recurring interval from `repeat_hrs` + `repeat_days` (same rules as {@link recurringIntervalMs}).
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
function getSlashRepeatIntervalMs(interaction) {
    return recurringIntervalMs({
        repeat_hrs: interaction.options.getInteger('repeat_hrs'),
        repeat_days: interaction.options.getInteger('repeat_days'),
    });
}

/**
 * Lock, archive, and schedule deletion. Hosted-game standard teardown.
 *
 * @param {import('discord.js').ThreadChannel | import('discord.js').AnyThreadChannel | null | undefined} thread
 * @param {{ disableComponents?: boolean }} [opts]
 */
async function finalizeHostedGameThread(thread, opts = {}) {
    if (!thread || typeof thread.setArchived !== 'function') return;
    const { disableComponents = false } = opts;
    const client = thread.client;
    const threadId = thread.id;
    try {
        if (disableComponents) {
            await disableComponentsInThread(thread);
        }
        if (typeof thread.setLocked === 'function' && thread.isThread?.()) {
            await thread.setLocked(true).catch(() => {});
        }
        await thread.setArchived(true).catch(() => {});
        setTimeout(() => {
            client.channels
                .fetch(threadId)
                .then((ch) => {
                    if (ch && typeof ch.delete === 'function') {
                        return ch.delete().catch(() => {});
                    }
                })
                .catch(() => {});
        }, HOSTED_GAME_THREAD_DELETE_DELAY_MS);
    } catch (err) {
        console.error(`[finalizeHostedGameThread] ${threadId}:`, err);
    }
}

module.exports = {
    HOSTED_GAME_THREAD_AUTO_ARCHIVE_MINUTES,
    PLATFORM_GAME_THREAD_AUTO_ARCHIVE_MINUTES,
    HOSTED_GAME_THREAD_DELETE_DELAY_MS,
    createHostedGamePublicThread,
    createHostedGamePrivateThread,
    createPlatformGameThread,
    getSlashScheduleDelayMs,
    getSlashRepeatIntervalMs,
    finalizeHostedGameThread,
};
