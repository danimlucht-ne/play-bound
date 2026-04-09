const { EmbedBuilder } = require('discord.js');
const { getSystemConfig } = require('./db');
const { automatedServerPostsEnabled } = require('./automatedPosts');
const {
    RANKED_FIXED_SCORING_MODE,
    RANKED_FIXED_TOP_N,
    RANKED_SCORING_DISPLAY_LABEL,
} = require('./rankedFactionWar');

/** @param {import('../models').SystemConfig} config */
function shouldPingEveryone(config) {
    if (config.announcePingEveryone === true) return true;
    if (config.announcePingEveryone === false) return false;
    return true;
}

async function sendGlobalAnnouncement(client, guildId, content, threadId = null) {
    const config = await getSystemConfig(guildId);
    if (!automatedServerPostsEnabled(config)) return null;
    if (config.announceChannel) {
        const chan = client.channels.cache.get(config.announceChannel);
        if (chan) {
            const message = threadId ? `${content.replace(/<#\d+>/, `<#${threadId}>`)}` : content;
            const body = shouldPingEveryone(config) ? `@everyone\n${message}` : message;
            return await chan.send({ content: body });
        }
    }
    return null;
}

async function announceScheduledGame(client, guildId, gameName, delay) {
    const hours = Math.floor(delay / 3600000);
    const minutes = Math.floor((delay % 3600000) / 60000);
    let delayText = [];
    if (hours > 0) delayText.push(`${hours} hour${hours === 1 ? '' : 's'}`);
    if (minutes > 0) delayText.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
    if (delayText.length === 0) delayText.push('less than a minute');
    await sendGlobalAnnouncement(client, guildId, `A **${gameName}** will be starting in ${delayText.join(' and ')}!`);
}

/**
 * Public faction war notice (scoring live when posted).
 * @returns {Promise<boolean>}
 */
async function announceFactionChallengeToGuild(client, guildId, config, params) {
    const chanId = config.announceChannel;
    if (!chanId) return false;
    if (!automatedServerPostsEnabled(config)) return false;
    let chan = client.channels.cache.get(chanId);
    if (!chan) chan = await client.channels.fetch(chanId).catch(() => null);
    if (!chan?.send) return false;

    const {
        matchupLine,
        endAt,
        gameType,
        gameFilterLabel,
        scoringMode,
        topN,
        pointCap,
        maxPerTeam,
        isRoyale,
        factionA,
        factionB,
        challengeMode,
    } = params;

    const isRanked = (challengeMode || 'ranked') !== 'unranked';
    const standingsLine = isRanked
        ? '\n\n**Official ranked war** — affects **global** standings (**match points**: win **+3**, tie **+1**). Only **enrolled** players and **allowed game types** count.'
        : '\n\n**Casual challenge** — **this server only**. Does **not** change global standings.';

    const endTs = Math.floor(endAt.getTime() / 1000);

    const gamesLabel = gameFilterLabel || gameType || 'all';
    const scoringHuman =
        scoringMode === RANKED_FIXED_SCORING_MODE && Number(topN) === RANKED_FIXED_TOP_N
            ? RANKED_SCORING_DISPLAY_LABEL
            : scoringMode === 'top_n_avg'
              ? `Top **${topN}** average`
              : String(scoringMode || '');
    const modeLine = `Games that count: \`${gamesLabel}\` · Scoring: **${scoringHuman}**`;

    let rosterVal =
        'Run **/faction_challenge join** to lock in. **No cap** — everyone who joins can score for their faction.';
    if (maxPerTeam) {
        rosterVal = isRoyale
            ? `**First ${maxPerTeam}** players **per faction** to use **/faction_challenge join** get a roster spot — after that, that team is **full** until the next war.`
            : `**First ${maxPerTeam}** **${factionA}** and **first ${maxPerTeam}** **${factionB}** to enroll are in — then that side is **full**.`;
    }

    const timeLine = `Scoring is **live now** · ends <t:${endTs}:F> (<t:${endTs}:R>).`;

    const embed = new EmbedBuilder()
        .setColor('#DC143C')
        .setTitle('⚔️ Faction war announced')
        .setDescription(
            `**${matchupLine}**\n\n${timeLine}\n\n${modeLine}` +
                (pointCap
                    ? `\n\n**Point goal:** **${Number(pointCap).toLocaleString()}** enrolled raw pts — first team there can end it early.`
                    : '') +
                `${standingsLine}` +
                `\n\n_Only **enrolled** players contribute to this challenge._` +
                `\n_Only **allowed game types** count during this challenge._`,
        )
        .addFields({ name: 'Roster', value: rosterVal, inline: false })
        .setFooter({ text: 'Global team first: /faction join · then /faction_challenge join to enroll' });

    await chan.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return true;
}

async function announceWinner(client, guildId, gameName, winnerText, parentChannelId) {
    const config = await getSystemConfig(guildId);
    const message = `🎉 **${gameName} has ended!** 🎉\n${winnerText}`;

    if (!automatedServerPostsEnabled(config)) {
        if (!config.announceChannel) {
            const chan = client.channels.cache.get(parentChannelId);
            if (chan) await chan.send({ content: message });
        }
        return;
    }

    if (config.announceChannel) {
        const chan = client.channels.cache.get(config.announceChannel);
        if (chan) {
            const body = shouldPingEveryone(config) ? `@everyone\n${message}` : message;
            await chan.send({ content: body });
        }
    } else {
        const chan = client.channels.cache.get(parentChannelId);
        if (chan) {
            await chan.send({ content: message });
        }
    }
}

/**
 * Post war announcement content to each participating faction's private channel.
 * If no faction channel exists for a faction, skip it (the main announce channel already gets the announcement).
 * Catches errors per-channel so one failure doesn't block others.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {import('../models').SystemConfig} config
 * @param {string[]} factionNames — participating factions
 * @param {string|object} content — the war announcement content (string or message options)
 */
async function announceFactionWarToFactionChannels(client, guildId, config, factionNames, content) {
    for (const faction of factionNames) {
        const channelId =
            config.factionChannelMap instanceof Map
                ? config.factionChannelMap.get(faction)
                : config.factionChannelMap?.[faction];
        if (!channelId) continue;
        try {
            let chan = client.channels.cache.get(channelId);
            if (!chan) chan = await client.channels.fetch(channelId).catch(() => null);
            if (chan?.send) {
                await chan.send(typeof content === 'string' ? { content } : content);
            }
        } catch (_err) {
            // Per-channel error — continue to next faction channel
        }
    }
}

module.exports = {
    shouldPingEveryone,
    sendGlobalAnnouncement,
    announceScheduledGame,
    announceFactionChallengeToGuild,
    announceFactionWarToFactionChannels,
    announceWinner,
};