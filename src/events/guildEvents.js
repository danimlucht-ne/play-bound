'use strict';

const { EmbedBuilder, ChannelType } = require('discord.js');
const mongoRouter = require('../../lib/mongoRouter');
const { User } = require('../../models');
const { reconcileFactionTotalsForLeavingMember, removeUserFromFactionChallengeEnrollment } = require('../../lib/factionChallenge');
const { getSystemConfig, refreshLeaderboard, addScore } = require('../../lib/db');
const { syncFactionMemberRoles } = require('../../lib/factionGuild');
const { automatedServerPostsEnabled } = require('../../lib/automatedPosts');

/**
 * @param {'join'|'leave'} kind
 * @param {import('discord.js').Guild} guild
 * @param {{ ownerId?: string|null }} [extra]
 */
async function recordBotGuildInstall(kind, guild, extra = {}) {
    try {
        await mongoRouter.runWithForcedModels(mongoRouter.getModelsProd(), async () => {
            const { BotGuildInstallEvent } = mongoRouter.getModelsProd();
            await BotGuildInstallEvent.create({
                kind,
                guildId: guild.id,
                guildName: guild.name ? String(guild.name) : 'Unknown server',
                memberCount: typeof guild.memberCount === 'number' ? guild.memberCount : null,
                ownerId: extra.ownerId || null,
            });
        });
    } catch (e) {
        console.error('[guildInstallLog]', e.message || e);
    }
}

function registerGuildEvents(client) {
    client.on('guildCreate', async (guild) => {
        console.log(`Joined new guild: ${guild.name} (${guild.id})`);
        const owner = await guild.fetchOwner();
        await recordBotGuildInstall('join', guild, { ownerId: owner?.id || null });

        const welcomeEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🎮 Thanks for inviting PlayBound!')
            .setDescription('I am ready to help you boost engagement with games, streaks, and a full server economy!\n\nUse the checklist below to get the most out of PlayBound.')
            .addFields(
                {
                    name: '🚀 Quick Setup',
                    value:
                        '1. `/set_announcement_channel` + optional `/set_announce_everyone` and `/set_automated_posts` (master switch for recaps, leaderboard channel, broadcasts, welcomes, birthdays).\n\n' +
                        '2. `/set_welcome_channel` for join messages.\n\n' +
                        '3. `/help` for games and basics.\n\n' +
                        '4. **Referrer?** An admin can run `/claim_referral` with the inviter’s code from `/invite`.',
                },
                {
                    name: '🪙 Credits vs Arena score',
                    value:
                        '**Credits** — shop, dailies, transfers, duels.\n\n**Arena score** — competitive mini-games (profile/server).\n\n**Global `/factions`** = faction challenges only. `/help` explains both.',
                },
                { name: '🛠️ Support', value: `Need help? [Join our Support Server](${process.env.SUPPORT_SERVER_INVITE || 'https://discord.gg/your-link'})` }
            )
            .setFooter({ text: 'Happy Gaming!' });

        const targetChannel = guild.systemChannel || guild.channels.cache.find((ch) => ch.type === ChannelType.GuildText && ch.permissionsFor(client.user).has('SendMessages'));

        if (targetChannel) {
            await targetChannel.send({ embeds: [welcomeEmbed] });
        }

        try {
            await owner.send({ content: `Thanks for inviting my bot to **${guild.name}**!`, embeds: [welcomeEmbed] });
        } catch (e) { /* DMs closed */ }
    });

    client.on('guildDelete', async (guild) => {
        await recordBotGuildInstall('leave', guild, {});
    });

    client.on('guildMemberAdd', async (m) => {
        const guildId = m.guild.id;
        await mongoRouter.runWithGuild(guildId, async () => {
        const config = await getSystemConfig(guildId);

        if (config.autoRoleId) {
            try {
                await m.roles.add(config.autoRoleId);
            } catch (e) {
                console.error(`[Auto-Role] Failed to assign role in ${guildId}:`, e.message);
            }
        }

        try {
            const userDoc = await User.findOne({ guildId, userId: m.id });
            if (userDoc?.faction) {
                await syncFactionMemberRoles(m.guild, m.id, config, userDoc.faction);
            }
        } catch (e) {
            console.error(`[guildMemberAdd] Faction role sync ${m.id} in ${guildId}:`, e.message);
        }

        if (config.welcomeChannel) {
            addScore(client, guildId, m.id, 5);

            let wMsg = "👋 **Welcome <@" + m.id + ">!** Type `/help` to play!\n\nWe've started you off with **5 Credits**. You can earn more by winning games, participating in events, and even setting your birthday with `/set_birthday`!";
            if (config.welcomeMessages && config.welcomeMessages.length > 0) {
                wMsg = config.welcomeMessages[Math.floor(Math.random() * config.welcomeMessages.length)].replace(/\{user\}/g, "<@" + m.id + ">");
            } else if (config.welcomeMessage) {
                wMsg = config.welcomeMessage.replace(/\{user\}/g, "<@" + m.id + ">");
            }

            if (automatedServerPostsEnabled(config)) {
                client.channels.cache.get(config.welcomeChannel)?.send(wMsg);
            }
        }

        if (config.memberLogChannel && automatedServerPostsEnabled(config)) {
            const logCh = client.channels.cache.get(config.memberLogChannel);
            const tag = m.user?.tag ?? m.user?.username ?? m.id;
            logCh?.send({
                content: `📥 **Joined:** <@${m.id}> (${tag}) — **${m.guild.memberCount}** members`,
                allowedMentions: { users: [m.id] },
            });
        }
        });
    });

    client.on('guildMemberRemove', async (m) => {
        const guildId = m.guild.id;
        await mongoRouter.runWithGuild(guildId, async () => {
        const configLeave = await getSystemConfig(guildId);
        if (configLeave.memberLogChannel && automatedServerPostsEnabled(configLeave)) {
            const logCh = client.channels.cache.get(configLeave.memberLogChannel);
            const tag = m.user?.tag ?? m.user?.username ?? m.id;
            const who = m.user ? `<@${m.id}> (\`${tag}\`)` : `\`${m.id}\``;
            logCh?.send({
                content: `📤 **Left:** ${who} — **${m.guild.memberCount}** members`,
                allowedMentions: m.user ? { users: [m.id] } : { parse: [] },
            });
        }
        try {
            const userDoc = await User.findOne({ guildId, userId: m.id });
            if (userDoc?.faction) {
                await reconcileFactionTotalsForLeavingMember(userDoc.faction, userDoc.competitivePoints, guildId);
                await removeUserFromFactionChallengeEnrollment(guildId, m.id);
            }
        } catch (e) {
            console.error(`[guildMemberRemove] Faction cleanup ${m.id} in ${guildId}:`, e.message);
        }
        await User.deleteOne({ guildId, userId: m.id });
        console.log(`Removed data for user ${m.id} who left the server.`);
        await refreshLeaderboard(client, guildId);
        });
    });
}

module.exports = { registerGuildEvents };
