'use strict';

const {
    shouldShowPremiumPrompt,
    markPremiumPromptShown,
    trackPremiumPromptShown,
} = require('./premiumAnalytics');

/** Public game result text: soft upsell (thread is multi-audience). */
function appendPremiumGameResultFooter(messageText) {
    if (!messageText || typeof messageText !== 'string') return messageText;
    const marker = '💡 **Premium**';
    if (messageText.includes(marker)) return messageText;
    return (
        `${messageText.trimEnd()}\n\n—\n` +
        `${marker} = **2×** points, better \`/daily\`, higher streak bonuses, session boosts — \`/premium\``
    );
}

/**
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').TextChannel|import('discord.js').ThreadChannel|null} thread
 * @param {string} guildId
 * @param {string[]} userIds
 * @param {object} [options]
 * @param {string|null} [options.gameType]
 * @param {string|null} [options.sessionId]
 * @param {Record<string, Record<string, unknown>>|null} [options.metadataByUser]
 */
async function sendGameEndPremiumUpsell(client, thread, guildId, userIds, options = {}) {
    if (!thread || !userIds || userIds.length === 0) return;
    const unique = [...new Set(userIds)];
    const eligible = [];
    const { User } = require('../models');
    for (const uid of unique) {
        const u = await User.findOne({ guildId, userId: uid });
        if (u && !u.isPremium && shouldShowPremiumPrompt(u)) eligible.push(uid);
    }
    if (eligible.length === 0) return;

    await thread.send({
        content:
            '✨ **Earn more with Premium!**\n' +
            '• **2×** points\n' +
            '• Better `/daily` rewards\n' +
            '• Higher streak bonuses\n' +
            '• Boost entire sessions\n\n' +
            'Use `/premium` to upgrade.',
    });

    const gameType = options.gameType ?? null;
    const sessionId = options.sessionId ?? thread.id ?? null;
    const byUser = options.metadataByUser || null;

    for (const uid of eligible) {
        const extra = byUser && typeof byUser[uid] === 'object' ? byUser[uid] : {};
        await trackPremiumPromptShown({
            userId: uid,
            guildId,
            trigger: 'game_end',
            metadata: { gameType, ...extra },
            sessionId,
        }).catch(() => {});
        await markPremiumPromptShown(guildId, uid);
    }
}

/**
 * Ephemeral follow-up for streak ≥ 3 (caller ensures interaction matches point recipient).
 * @param {object} [analytics]
 * @param {number} [analytics.pointsAwarded]
 * @param {string|null} [analytics.gameType]
 * @param {number} [analytics.streak]
 */
async function tryPremiumStreakFollowUp(interaction, guildId, userId, analytics = {}) {
    const { User } = require('../models');
    const u = await User.findOne({ guildId, userId });
    if (!u || u.isPremium || u.currentStreak < 3 || !shouldShowPremiumPrompt(u)) return;
    if (!interaction.isRepliable()) return;
    if (!interaction.deferred && !interaction.replied) return;

    await interaction.followUp({
        ephemeral: true,
        content:
            '🔥 **You\'re on a streak!**\n\n' +
            'Premium users can push streak bonuses even higher.\n' +
            'Use `/premium`',
    });
    await trackPremiumPromptShown({
        userId,
        guildId,
        trigger: 'streak',
        metadata: {
            streak: analytics.streak ?? u.currentStreak,
            pointsAwarded: analytics.pointsAwarded ?? null,
            gameType: analytics.gameType ?? null,
        },
    }).catch(() => {});
    await markPremiumPromptShown(guildId, userId);
}

/**
 * Host-only ephemeral after starting a game (immediate start paths with deferred interaction).
 * @param {object} [opts]
 * @param {string|null} [opts.gameType]
 * @param {boolean} [opts.supportsRepeatHrs]
 * @param {boolean} [opts.supportsPremiumCaps]
 */
async function tryHostPremiumNudge(interaction, hostUserDoc, opts = {}) {
    if (!hostUserDoc || hostUserDoc.isPremium || !shouldShowPremiumPrompt(hostUserDoc)) return;
    if (!interaction.deferred && !interaction.replied) return;

    await interaction.followUp({
        ephemeral: true,
        content:
            '🚀 **Want more control?**\n\n' +
            'Premium hosts can:\n' +
            '• Run **bigger** games\n' +
            '• **Autopilot** games (`repeat_hrs`)\n' +
            '• **Boost** sessions\n\n' +
            'Use `/premium`',
    });
    await trackPremiumPromptShown({
        userId: interaction.user.id,
        guildId: interaction.guildId,
        trigger: 'game_start_host',
        metadata: {
            gameType: opts.gameType ?? null,
            supportsRepeatHrs: opts.supportsRepeatHrs === true,
            supportsPremiumCaps: opts.supportsPremiumCaps !== false,
        },
        sessionId: null,
    }).catch(() => {});
    await markPremiumPromptShown(interaction.guildId, interaction.user.id);
}

/**
 * Thread hint when host has not activated session aura.
 * @param {object} [opts]
 * @param {string|null} [opts.gameType]
 * @param {string|null} [opts.sessionId]
 * @param {boolean} [opts.hasAura]
 * @param {string|null} [opts.guildId]
 * @param {string|null} [opts.hostUserId] — attribution user (game host)
 */
async function sendPremiumBoostSessionHint(thread, hostIsPremium, opts = {}) {
    if (!thread || hostIsPremium) return;
    await thread
        .send({
            content:
                '✨ **Premium** members can **boost this session** for everyone — look for the **Boost session** button.',
        })
        .catch(() => {});

    const hostUserId = opts.hostUserId;
    if (!hostUserId) return;

    await trackPremiumPromptShown({
        userId: hostUserId,
        guildId: opts.guildId ?? thread.guildId ?? null,
        trigger: 'session_boost_reminder',
        metadata: {
            gameType: opts.gameType ?? null,
            sessionId: opts.sessionId ?? thread.id ?? null,
            hasAura: opts.hasAura === true,
        },
        sessionId: opts.sessionId ?? thread.id ?? null,
    }).catch(() => {});
}

module.exports = {
    shouldShowPremiumPrompt,
    markPremiumPromptShown,
    appendPremiumGameResultFooter,
    sendGameEndPremiumUpsell,
    tryPremiumStreakFollowUp,
    tryHostPremiumNudge,
    sendPremiumBoostSessionHint,
};
