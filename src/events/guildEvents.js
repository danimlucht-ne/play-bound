'use strict';

const { EmbedBuilder, ChannelType } = require('discord.js');
const mongoRouter = require('../../lib/mongoRouter');
const { User } = require('../../models');
const { reconcileFactionTotalsForLeavingMember, removeUserFromFactionChallengeEnrollment } = require('../../lib/factionChallenge');
const { getSystemConfig, refreshLeaderboard, addScore } = require('../../lib/db');
const { syncFactionMemberRoles } = require('../../lib/factionGuild');
const { automatedServerPostsEnabled } = require('../../lib/automatedPosts');

function registerGuildEvents(client) {
    client.on('guildCreate', async (guild) => {
        console.log(`Joined new guild: ${guild.name} (${guild.id})`);
        const owner = await guild.fetchOwner();

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

        // Member log channel
        if (config.memberLogChannel && automatedServerPostsEnabled(config)) {
            const logCh = client.channels.cache.get(config.memberLogChannel);
            if (logCh) {
                const created = m.user.createdAt;
                const age = created ? `<t:${Math.floor(created.getTime() / 1000)}:R>` : 'unknown';
                logCh.send({
                    embeds: [new EmbedBuilder()
                        .setColor('#2dd4bf')
                        .setTitle('\ud83d\udfe2 Member Joined')
                        .setDescription(`<@${m.id}> (${m.user.tag})\nAccount created: ${age}`)
                        .setThumbnail(m.user.displayAvatarURL({ size: 64 }))
                        .setTimestamp()],
                }).catch(() => {});
            }
        }

        if (!config.welcomeChannel) return;

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
        });
    });

    client.on('guildMemberRemove', async (m) => {
        const guildId = m.guild.id;
        await mongoRouter.runWithGuild(guildId, async () => {
        // Member log channel
        try {
            const config = await getSystemConfig(guildId);
            if (config.memberLogChannel && automatedServerPostsEnabled(config)) {
                const logCh = client.channels.cache.get(config.memberLogChannel);
                if (logCh) {
                    logCh.send({
                        embeds: [new EmbedBuilder()
                            .setColor('#ef4444')
                            .setTitle('\ud83d\udd34 Member Left')
                            .setDescription(`<@${m.id}> (${m.user?.tag || m.id})`)
                            .setThumbnail(m.user?.displayAvatarURL?.({ size: 64 }) || null)
                            .setTimestamp()],
                    }).catch(() => {});
                }
            }
        } catch (_) {}
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
