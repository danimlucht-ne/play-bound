'use strict';

const { updateUser, addScore, getSystemConfig, getUser, updateActiveGame } = require('../../lib/db');
const { sessionHasHostAura } = require('../../lib/premiumPerks');
const { awardAchievement } = require('../../lib/achievements');
const { isFuzzyMatch, normalizeSongTitle } = require('../../lib/utils');
const guessthenumberGame = require('../../games/guessthenumber');
const spellingBeeGame = require('../../games/spellingbee');
const { playboundDebugLog } = require('../../lib/playboundDebug');
const mongoRouter = require('../../lib/mongoRouter');
const { isShuttingDown } = require('../../lib/botLifecycle');

function registerMessageCreate(client, deps) {
    const { state, triggers } = deps;
    const {
        activeMovieGames,
        activeTunes,
        activeCaptions,
        storyLastUserId,
    } = state;
    const { nextMovieQuote } = triggers;

    client.on('messageCreate', async m => {
    if (m.author.bot) return;
    const guildId = m.guild ? m.guild.id : null;
    if (!guildId) return;
    if (isShuttingDown()) return;
    await mongoRouter.runWithGuild(guildId, async () => {
    updateUser(guildId, m.author.id, u => { u.stats.messagesSent = (u.stats.messagesSent || 0) + 1; if (u.stats.messagesSent === 100) awardAchievement(client, guildId, m.channel, m.author.id, "CHATTERBOX"); });
    
    // Auto-Redirect check
    const config = await getSystemConfig(guildId);
    if (config.redirects) {
        const lowerContent = m.content.toLowerCase();
        const entries = config.redirects.entries ? Array.from(config.redirects.entries()) : Object.entries(config.redirects);
        
        for (const [key, data] of entries) {
            const channelId = typeof data === 'string' ? data : data.channelId;
            const link = (typeof data === 'object' && data.link) ? data.link : null;
            const target = link ? (channelId ? `<#${channelId}> or ${link}` : link) : `<#${channelId}>`;
            const defaultMsg = `Hey <@${m.author.id}>, please take discussions regarding **${key.replace(/,/g, ', ')}** to ${target}!`;
            let customMsg = (typeof data === 'object' && data.message) ? data.message : defaultMsg;
            if (channelId) {
                const destinationUrl = m.guild ? `https://discord.com/channels/${m.guild.id}/${channelId}` : null;
                const includesChannel = customMsg.includes(`<#${channelId}>`);
                const includesLink = destinationUrl && customMsg.includes(destinationUrl);
                if (!includesChannel && !includesLink) {
                    customMsg += `\nGo here: <#${channelId}>${destinationUrl ? ` (${destinationUrl})` : ''}`;
                }
            } else if (link && !customMsg.includes(link)) {
                customMsg += `\nGo here: ${link}`;
            }
            
            let match = false;
            if (key.includes(',')) {
                const words = key.split(',');
                match = words.every(word => new RegExp(`\\b${word}\\b`, 'i').test(lowerContent));
            } else {
                match = new RegExp(`\\b${key}\\b`, 'i').test(lowerContent);
            }

            if (match && m.channel.id !== channelId) {
                playboundDebugLog(
                    `[Auto-Redirect] guild=${guildId} user=${m.author.id} key="${key}"`,
                );
                await m.reply(customMsg);
                break; 
            }
        }
    }

    // One-Word Story Check
    const configuredStoryChannelId = config.storyChannel || null;
    const inStoryFlow =
        configuredStoryChannelId &&
        (
            m.channel.id === configuredStoryChannelId ||
            (m.channel.isThread?.() && m.channel.parentId === configuredStoryChannelId)
        );
    if (inStoryFlow) {
        const normalized = String(m.content || '').trim();
        const words = normalized.split(/\s+/).filter(Boolean);
        const channelStoryKey = m.channel.id;
        const invalid = words.length !== 1 || storyLastUserId.get(channelStoryKey) === m.author.id;
        if (invalid) {
            let deleted = false;
            try {
                await m.delete();
                deleted = true;
            } catch (_) {
                deleted = false;
            }
            const warningText = deleted
                ? `⚠️ <@${m.author.id}>, only **one word** per message, and you cannot go twice in a row!`
                : `⚠️ <@${m.author.id}>, story mode is **one word only** and no consecutive turns. (I could not auto-delete your message; check my channel permissions.)`;
            const warning = await m.channel.send({ content: warningText, allowedMentions: { users: [m.author.id] } }).catch(() => null);
            if (warning) setTimeout(() => warning.delete().catch(()=>{}), 6000);
            return;
        }
        storyLastUserId.set(channelStoryKey, m.author.id);
        await m.react('📝').catch(()=>{});
        addScore(client, guildId, m.author.id, 3); // Small reward for participating
    }

    const activeMovie = activeMovieGames.get(m.channel.id);
    if (activeMovie && activeMovie.currentMovie) {
        const trimmed = m.content.trim();
        if (/^!moviehint$/i.test(trimmed)) {
            const u = await getUser(guildId, m.author.id);
            const idx = u.inventory ? u.inventory.indexOf('hint_movie_quotes') : -1;
            if (idx === -1) {
                await m.reply({
                    content: 'You need a **Movie quote hint** from `/shop` (`hint_movie_quotes`).',
                    allowedMentions: { users: [] },
                });
                return;
            }
            u.inventory.splice(idx, 1);
            await u.save();
            const title = activeMovie.currentMovie;
            const hint =
                title.length <= 2
                    ? `The title has **${title.length}** characters.`
                    : `First letter: **${title[0].toUpperCase()}** · **${title.length}** characters (including spaces).`;
            await m.reply({
                content: `💡 **Hint** (item used): ${hint}`,
                allowedMentions: { users: [] },
            });
            return;
        }
        if (isFuzzyMatch(m.content, activeMovie.currentMovie)) {
            if (activeMovie.roundTimeoutHandle) {
                clearTimeout(activeMovie.roundTimeoutHandle);
                activeMovie.roundTimeoutHandle = null;
            }
            const timeTaken = (Date.now() - activeMovie.roundStartTime) / 1000;
            activeMovie.scores[m.author.id] = (activeMovie.scores[m.author.id] || 0) + 1;
            const movieName = activeMovie.currentMovie;
            activeMovie.currentMovie = null; // Prevent double points

            void updateActiveGame(m.channel.id, (s) => {
                s.scores = { ...activeMovie.scores };
            }).catch((e) => console.error('[persist MovieQuotes scores]', e));

            await m.reply(
                `🎬 **Correct!** It was **${movieName}**!\n<@${m.author.id}> guessed it in **${timeTaken.toFixed(1)}s**.\n\n` +
                    `—\n\n_Next round in a few seconds…_`
            );
            setTimeout(() => nextMovieQuote(m.channel.id), 4500);
            return;
        }
        m.react('❌').catch(()=>{});
        return;
    }
    if (await guessthenumberGame.handleMessage(m, client)) return;
    if (await spellingBeeGame.handleMessage(m, client)) return;

    const activeTune = activeTunes.get(m.channel.id);
    const activeCaption = activeCaptions.get(m.channel.id);
    if (activeCaption) { 
        if (activeCaption.participants.has(m.author.id)) {
            try {
                await m.delete();
                const warningMsg = await m.channel.send(`<@${m.author.id}>, you can only submit one caption!`);
                setTimeout(() => warningMsg.delete().catch(()=>{}), 5000);
            } catch(e) {}
            return;
        }
        activeCaption.participants.add(m.author.id);
        void updateActiveGame(m.channel.id, (s) => {
            s.participants = Array.from(activeCaption.participants);
        }).catch((e) => console.error('[persist CaptionContest participants]', e));
        const emojis = ['😂', '🔥', '👍', '🤯', '❤️'];
        for (const emoji of emojis) {
            await m.react(emoji).catch(()=>{});
        }
    }

    if (activeTune) {
        const normalizedTarget = normalizeSongTitle(activeTune.currentSong);
        if (isFuzzyMatch(m.content, normalizedTarget)) {
            const timeTaken = Date.now() - activeTune.roundStartTime;
            if (activeTune.roundTimeout) clearTimeout(activeTune.roundTimeout);
            
            if (!activeTune.playerStats[m.author.id]) activeTune.playerStats[m.author.id] = { wins: 0, totalTime: 0 };
            activeTune.playerStats[m.author.id].wins++;
            activeTune.playerStats[m.author.id].totalTime += timeTaken;

            addScore(client, guildId, m.author.id, 1, null, sessionHasHostAura(activeTune), 'namethattune');
            m.reply(
                `✅ **Correct!**\n\n` +
                    `The song was **${activeTune.currentSong}**.\n\n` +
                    `_Guessed in ${(timeTaken / 1000).toFixed(2)}s._\n\n` +
                    `—\n\n` +
                    `_Next round in a few seconds…_`,
            );
            activeTune.scores[m.author.id] = (activeTune.scores[m.author.id] || 0) + 1;
            void updateActiveGame(m.channel.id, (s) => {
                s.scores = { ...activeTune.scores };
                s.playerStats = JSON.parse(JSON.stringify(activeTune.playerStats || {}));
            }).catch((e) => console.error('[persist NameThatTune participants]', e));
            activeTune.player.stop(); // Stop current audio
            setTimeout(activeTune.startNextRound, 3500);
        } else {
            m.react('❌');
        }
    }
    });
});
}

module.exports = { registerMessageCreate };
