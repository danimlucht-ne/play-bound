'use strict';

/** Channel where game threads are created (slash may be used from inside a thread). */
function resolveGameHostChannel(interaction) {
    const ch = interaction.channel;
    if (!ch) return null;
    const host = ch.isThread() ? ch.parent : ch;
    if (!host || typeof host.threads?.create !== 'function') return null;
    return host;
}

/**
 * Prefer guild voice-state cache, then slash member payload, then a forced member fetch.
 */
async function resolveUserVoiceChannel(guild, userId, fromInteractionMember) {
    const vs = guild.voiceStates.cache.get(userId);
    if (vs?.channelId) {
        let ch = guild.channels.cache.get(vs.channelId);
        if (!ch) ch = await guild.channels.fetch(vs.channelId).catch(() => null);
        if (ch) return ch;
    }
    if (fromInteractionMember?.voice?.channel) return fromInteractionMember.voice.channel;
    const member = await guild.members.fetch({ user: userId, force: true }).catch(() => null);
    return member?.voice?.channel ?? null;
}

module.exports = { resolveGameHostChannel, resolveUserVoiceChannel };
