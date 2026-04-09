const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { getUser, getSystemConfig } = require('../lib/db');
const { announceWinner, shouldPingEveryone } = require('../lib/announcements');
const { formatPoints, defaultGameThreadName } = require('../lib/utils');
const { createHostedGamePublicThread, finalizeHostedGameThread } = require('../lib/gameThreadLifecycle');
const { makeGameFlairEmbed } = require('../lib/gameFlair');
const { appendPremiumGameResultFooter, sendGameEndPremiumUpsell } = require('../lib/premiumUpsell');

const activeTournaments = new Map();

async function runTournamentRound(client, messageId, players, roundNum) {
    const tournament = activeTournaments.get(messageId);
    if (!tournament) return;
    const thread = await client.channels.fetch(tournament.threadId).catch(()=>null);
    if (!thread) return activeTournaments.delete(messageId);

    if (players.length === 1) {
        const winnerId = players[0];
        let winMsg = `🏆 **TOURNAMENT WINNER!** 🏆
Congratulations <@${winnerId}>! You won the entire pot of **${formatPoints(tournament.pot)} points**!`;
        winMsg = appendPremiumGameResultFooter(winMsg);
        await thread.send(winMsg);
        await sendGameEndPremiumUpsell(client, thread, tournament.guildId, [...tournament.players], {
            gameType: 'Tournament',
            sessionId: tournament.threadId,
        });

        const user = await getUser(tournament.guildId, winnerId);
        user.points += tournament.pot;
        user.stats.gamesWon = (user.stats.gamesWon || 0) + 1;
        await user.save();
        
        await announceWinner(client, tournament.guildId, 'Dice Tournament', `<@${winnerId}> won the tournament pot of **${formatPoints(tournament.pot)}** points!`, thread.parentId);
        await finalizeHostedGameThread(thread, { disableComponents: true });
        activeTournaments.delete(messageId);
        return;
    }

    const nextRoundPlayers = [];
    let resultsMsg = `📦 **ROUND ${roundNum} MATCHUPS**

`;
    
    const currentRoundPlayers = [...players];
    if (currentRoundPlayers.length % 2 !== 0) {
        const lucky = currentRoundPlayers.pop();
        nextRoundPlayers.push(lucky);
        resultsMsg += `✨ <@${lucky}> got a **BYE** and moves to the next round automatically!
`;
    }

    for (let i = 0; i < currentRoundPlayers.length; i += 2) {
        const p1 = currentRoundPlayers[i];
        const p2 = currentRoundPlayers[i+1];
        
        let r1 = Math.floor(Math.random() * 100) + 1;
        let r2 = Math.floor(Math.random() * 100) + 1;
        while (r1 === r2) {
            r1 = Math.floor(Math.random() * 100) + 1;
            r2 = Math.floor(Math.random() * 100) + 1;
        }

        const winner = r1 > r2 ? p1 : p2;
        nextRoundPlayers.push(winner);
        
        resultsMsg += `⚔️ <@${p1}> (**${r1}**) vs <@${p2}> (**${r2}**) -> **Winner: <@${winner}>**
`;
    }

    await thread.send(resultsMsg);
    setTimeout(() => runTournamentRound(client, messageId, nextRoundPlayers, roundNum + 1), 10000);
}

async function triggerTournamentStart(client, messageId) {
    const tournament = activeTournaments.get(messageId);
    if (!tournament) return;

    tournament.status = 'playing';
    const thread = await client.channels.fetch(tournament.threadId).catch(()=>null);
    if (!thread) return activeTournaments.delete(messageId);

    if (tournament.players.size < 2) {
        await thread.send("❌ Tournament cancelled: Not enough players (minimum 2). Points have been refunded.");
        for (const pid of tournament.players) {
            const u = await getUser(tournament.guildId, pid);
            u.points += tournament.entryFee;
            await u.save();
        }
        await finalizeHostedGameThread(thread, { disableComponents: true });
        return activeTournaments.delete(messageId);
    }

    await thread.send(`🎲 **Registration Closed!** ${tournament.players.size} players entered.
Generating the bracket...`);
    const playersList = Array.from(tournament.players).sort(() => Math.random() - 0.5);
    
    setTimeout(() => runTournamentRound(client, messageId, playersList, 1), 3000);
}

module.exports = {
    async handleInteraction(interaction, client) {
        const commandName = interaction.commandName;
        const customId = interaction.customId;

        if (commandName === 'tournament') {
            const guildId = interaction.guildId;
            const dur = interaction.options.getInteger('duration') || 5;
            const entryFee = interaction.options.getInteger('entry_fee') || 0;
            const pot = interaction.options.getInteger('pot') || 0;
            const threadName = interaction.options.getString('thread_name') || defaultGameThreadName('Dice Tournament');
            
            await interaction.deferReply({ ephemeral: true });

            const host = await getUser(guildId, interaction.user.id);

            const thread = await createHostedGamePublicThread(interaction.channel, threadName);

            const sys = await getSystemConfig(guildId);
            const tournamentIntro = shouldPingEveryone(sys)
                ? '@everyone A new tournament has started!'
                : 'A new tournament has started!';

            const embed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('🎲 Dice Roll Tournament!')
                .setDescription(`Click the button below to enter!

**Current Players:** 0

**Total Pot:** ${formatPoints(pot)} pts

**Entry Fee:** ${formatPoints(entryFee)} pts

**Registration Ends:** <t:${Math.floor(Date.now()/1000 + dur*60)}:R>

🪙 _Tap **Enter** to see your balance vs the fee (private)._`)
                .setFooter({ text: 'The bot will automatically generate the bracket and simulate the rolls!' });

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('tournament_join').setLabel('📝 Enter Tournament').setStyle(ButtonStyle.Success)
            );

            const msg = await thread.send({
                content: tournamentIntro,
                embeds: [makeGameFlairEmbed('tournament'), embed],
                components: [row],
            });
            
            activeTournaments.set(msg.id, {
                guildId,
                threadId: thread.id,
                players: new Set(),
                entryFee,
                pot,
                status: 'registration',
                timeoutHandle: setTimeout(() => triggerTournamentStart(client, msg.id), dur * 60000)
            });

            await interaction.editReply({
                content:
                    `✅ Tournament started in <#${thread.id}>!\n` +
                    `🪙 **Your balance:** **${formatPoints(host.points ?? 0)}** points _(entry fee is deducted when someone joins)_`,
            });
            return true;
        }

        if (interaction.isButton() && customId === 'tournament_join') {
            const tournament = activeTournaments.get(interaction.message.id);
            if (!tournament || tournament.status !== 'registration') {
                return interaction.reply({ content: "This tournament is no longer accepting entries.", ephemeral: true });
            }
            if (tournament.players.has(interaction.user.id)) {
                return interaction.reply({ content: "You have already joined this tournament!", ephemeral: true });
            }

            const user = await getUser(interaction.guildId, interaction.user.id);
            if (user.points < tournament.entryFee) {
                return interaction.reply({
                    content:
                        `❌ You need **${formatPoints(tournament.entryFee)}** points to enter.\n` +
                        `🪙 **Your balance:** **${formatPoints(user.points ?? 0)}** points`,
                    ephemeral: true,
                });
            }

            user.points -= tournament.entryFee;
            await user.save();

            tournament.players.add(interaction.user.id);
            tournament.pot += tournament.entryFee;

            await interaction.reply({
                content:
                    `✅ You're in! **-${formatPoints(tournament.entryFee)}** pts entry · 🪙 **Balance:** **${formatPoints(user.points ?? 0)}** points · Good luck!`,
                ephemeral: true,
            });
            
            const embed = EmbedBuilder.from(interaction.message.embeds[0]);
            embed.setDescription(`Click the button below to enter!

**Current Players:** ${tournament.players.size}

**Total Pot:** ${formatPoints(tournament.pot)} pts

**Entry Fee:** ${formatPoints(tournament.entryFee)} pts

**Registration Ends:** <t:${Math.floor((interaction.message.createdTimestamp + tournament.timeoutHandle._idleTimeout) / 1000)}:R>

🪙 _Tap **Enter** to see your balance vs the fee (private)._`);
            await interaction.message.edit({ embeds: [embed] });
            return true;
        }

        return false;
    },
    forceEnd(client, messageId) {
        const tournament = activeTournaments.get(messageId);
        if (tournament) {
            clearTimeout(tournament.timeoutHandle);
            triggerTournamentStart(client, messageId);
            return true;
        }
        return false;
    },
    getActiveGames() {
        return activeTournaments;
    }
}
