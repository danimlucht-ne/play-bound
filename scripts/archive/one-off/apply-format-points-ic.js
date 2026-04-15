'use strict';
const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, '../src/events/interactionCreate.js');
let s = fs.readFileSync(f, 'utf8');

const steps = [
    [
        `    disableComponentsInThread,
} = require('../../lib/utils');`,
        `    disableComponentsInThread,
    formatPoints,
} = require('../../lib/utils');`,
    ],
    [
        'lines.push(`${p}**${item.name}** — ${item.price} pts',
        'lines.push(`${p}**${item.name}** — ${formatPoints(item.price)} pts',
    ],
    [
        'lines.push(`🏠 **${item.name}** — ${item.price} pts',
        'lines.push(`🏠 **${item.name}** — ${formatPoints(item.price)} pts',
    ],
    ['return `${price} pts`.substring', 'return `${formatPoints(price)} pts`.substring'],
    ['return `${price} pts ·', 'return `${formatPoints(price)} pts ·'],
    [
        '**🪙 Your balance: ${Number(userPoints).toLocaleString()} points**',
        '**🪙 Your balance: ${formatPoints(userPoints)} points**',
    ],
    [
        '`❌ You need **${duel.bet.toLocaleString()}** points to accept this duel.\\n🪙 **Your balance:** **${target.points.toLocaleString()}** points`',
        '`❌ You need **${formatPoints(duel.bet)}** points to accept this duel.\\n🪙 **Your balance:** **${formatPoints(target.points)}** points`',
    ],
    [
        '`🪙 Stake **${duel.bet.toLocaleString()}** each · Pot **${(duel.bet * 2).toLocaleString()}** · After stake: <@${duel.challengerId}> **${challenger.points.toLocaleString()}** pts · <@${duel.targetId}> **${target.points.toLocaleString()}** pts\\n\\n` +',
        '`🪙 Stake **${formatPoints(duel.bet)}** each · Pot **${formatPoints(duel.bet * 2)}** · After stake: <@${duel.challengerId}> **${formatPoints(challenger.points)}** pts · <@${duel.targetId}> **${formatPoints(target.points)}** pts\\n\\n` +',
    ],
    [
        '**${duel.bet * 2} points**!',
        '**${formatPoints(duel.bet * 2)} points**!',
    ],
    [
        'return interaction.editReply({ content: `You don\'t have enough points! (Need ${item.price}, have ${user.points})` });',
        'return interaction.editReply({ content: `You don\'t have enough points! (Need ${formatPoints(item.price)}, have ${formatPoints(user.points)})` });',
    ],
    [
        '`Adjusted points for ${user.username} by ${points}. New total: ${targetUser.points}.`',
        '`Adjusted points for ${user.username} by ${formatPoints(points)}. New total: ${formatPoints(targetUser.points)}.`',
    ],
    [
        '`Your points have been adjusted by ${points}. Reason: ${reason}`',
        '`Your points have been adjusted by ${formatPoints(points)}. Reason: ${reason}`',
    ],
    [
        '`${prefix} You claimed **${reward} points**! Come back tomorrow for more.`',
        '`${prefix} You claimed **${formatPoints(reward)} points**! Come back tomorrow for more.`',
    ],
    [
        '`❌ You do not have enough points. (Balance: ${sender.points})`',
        '`❌ You do not have enough points. (Balance: ${formatPoints(sender.points)})`',
    ],
    [
        '`💸 **Transfer Complete!**\\nYou sent **${amount} points** to <@${targetUser.id}>.`',
        '`💸 **Transfer Complete!**\\nYou sent **${formatPoints(amount)} points** to <@${targetUser.id}>.`',
    ],
    [
        '`❌ You don\'t have enough points to bet **${bet.toLocaleString()}**.\\n🪙 **Your balance:** **${challenger.points.toLocaleString()}** points`',
        '`❌ You don\'t have enough points to bet **${formatPoints(bet)}**.\\n🪙 **Your balance:** **${formatPoints(challenger.points)}** points`',
    ],
    [
        '`**Stake:** **${bet.toLocaleString()}** points each · **Pot:** **${(bet * 2).toLocaleString()}** points to the winner\\n\\n` +',
        '`**Stake:** **${formatPoints(bet)}** points each · **Pot:** **${formatPoints(bet * 2)}** points to the winner\\n\\n` +',
    ],
    [
        '`🪙 **Balances:** Challenger <@${interaction.user.id}>: **${challenger.points.toLocaleString()}** pts · Opponent <@${targetUser.id}>: **${opponent.points.toLocaleString()}** pts\\n` +',
        '`🪙 **Balances:** Challenger <@${interaction.user.id}>: **${formatPoints(challenger.points)}** pts · Opponent <@${targetUser.id}>: **${formatPoints(opponent.points)}** pts\\n` +',
    ],
    [
        '`_Opponent needs **${bet.toLocaleString()}**+ pts to accept._\\n\\n` +',
        '`_Opponent needs **${formatPoints(bet)}**+ pts to accept._\\n\\n` +',
    ],
    [
        '`${i+1}. ${badge}<@${u.userId}> - ${u.points} pts\\n`',
        '`${i+1}. ${badge}<@${u.userId}> - ${formatPoints(u.points)} pts\\n`',
    ],
    [
        "{ name: 'Global Points', value: `**${factionDoc.totalPoints.toLocaleString()}** pts`, inline: true },",
        "{ name: 'Global Points', value: `**${formatPoints(factionDoc.totalPoints)}** pts`, inline: true },",
    ],
    [
        "{ name: 'Total Members', value: `**${factionDoc.members.toLocaleString()}**`, inline: true },",
        "{ name: 'Total Members', value: `**${formatPoints(factionDoc.members)}**`, inline: true },",
    ],
    [
        "{ name: 'Your Contribution', value: `**${user.points.toLocaleString()}** pts`, inline: false }",
        "{ name: 'Your Contribution', value: `**${formatPoints(user.points)}** pts`, inline: false }",
    ],
    [
        'desc += `${medal} **${f.emoji} ${f.name}**\\n*Points:* **${f.totalPoints.toLocaleString()}** | *Members:* ${f.members}\\n\\n`;',
        'desc += `${medal} **${f.emoji} ${f.name}**\\n*Points:* **${formatPoints(f.totalPoints)}** | *Members:* ${formatPoints(f.members)}\\n\\n`;',
    ],
    [
        '`Total: **${user.points || 0}**\\nWeekly: **${user.weeklyPoints || 0}**`',
        '`Total: **${formatPoints(user.points || 0)}**\\nWeekly: **${formatPoints(user.weeklyPoints || 0)}**`',
    ],
];

for (let i = 0; i < steps.length; i++) {
    const [a, b] = steps[i];
    if (!s.includes(a)) {
        console.error('Step', i, 'missing:', a.slice(0, 120).replace(/\n/g, '\\n'));
        process.exit(1);
    }
    s = s.split(a).join(b);
}
fs.writeFileSync(f, s);
console.log('apply-format-points-ic: ok', steps.length, 'steps');
