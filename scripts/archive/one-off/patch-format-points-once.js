'use strict';
const fs = require('fs');
const path = require('path');

const ic = path.join(__dirname, '../src/events/interactionCreate.js');
let s = fs.readFileSync(ic, 'utf8');

const pairs = [
    [
        `const {
    decodeHTMLEntities,
    scramblePhrase,
    parsePointValues,
    isFuzzyMatch,
    normalizeText,
    disableComponentsInThread,
} = require('../../lib/utils');`,
        `const {
    decodeHTMLEntities,
    scramblePhrase,
    parsePointValues,
    isFuzzyMatch,
    normalizeText,
    disableComponentsInThread,
    formatPoints,
} = require('../../lib/utils');`,
    ],
    ['`${p}**${item.name}** — ${item.price} pts', '`${p}**${item.name}** — ${formatPoints(item.price)} pts'],
    ['`🏠 **${item.name}** — ${item.price} pts', '`🏠 **${item.name}** — ${formatPoints(item.price)} pts'],
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
        '`🪙 Stake **${duel.bet.toLocaleString()}** each · Pot **${(duel.bet * 2).toLocaleString()}** · After stake: <@${duel.challengerId}> **${challenger.points.toLocaleString()}** pts · <@${duel.targetId}> **${target.points.toLocaleString()}** pts\\n\\n`',
        '`🪙 Stake **${formatPoints(duel.bet)}** each · Pot **${formatPoints(duel.bet * 2)}** · After stake: <@${duel.challengerId}> **${formatPoints(challenger.points)}** pts · <@${duel.targetId}> **${formatPoints(target.points)}** pts\\n\\n`',
    ],
    [
        '**${duel.bet * 2} points**!',
        '**${formatPoints(duel.bet * 2)} points**!',
    ],
    [
        '`You don\'t have enough points! (Need ${item.price}, have ${user.points})`',
        '`You don\'t have enough points! (Need ${formatPoints(item.price)}, have ${formatPoints(user.points)})`',
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
        '`*Points:* **${f.totalPoints.toLocaleString()}** | *Members:* ${f.members}\\n\\n`;',
        '`*Points:* **${formatPoints(f.totalPoints)}** | *Members:* ${formatPoints(f.members)}\\n\\n`;',
    ],
    [
        '`Total: **${user.points || 0}**\\nWeekly: **${user.weeklyPoints || 0}**`',
        '`Total: **${formatPoints(user.points || 0)}**\\nWeekly: **${formatPoints(user.weeklyPoints || 0)}**`',
    ],
    [
        '`You don\'t have enough points! (Need ${item.price}, have ${user.points})`, ephemeral: true`',
        '`You don\'t have enough points! (Need ${formatPoints(item.price)}, have ${formatPoints(user.points)})`, ephemeral: true`',
    ],
];

let n = 0;
for (const [a, b] of pairs) {
    if (!s.includes(a)) {
        console.error('MISSING:', JSON.stringify(a.slice(0, 80)));
        process.exit(1);
    }
    s = s.split(a).join(b);
    n++;
}
fs.writeFileSync(ic, s);
console.log('OK', n, 'replacements');
