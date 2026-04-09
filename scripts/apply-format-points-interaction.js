/**
 * One-shot: apply formatPoints() across interactionCreate.js user-facing numbers.
 * Run: node scripts/apply-format-points-interaction.js
 */
const fs = require("fs");
const path = require("path");

const p = path.join(__dirname, "..", "src", "events", "interactionCreate.js");
let s = fs.readFileSync(p, "utf8");

function sj(a, b) {
    const n = s.split(a).length - 1;
    if (n > 0) s = s.split(a).join(b);
    return n;
}

// Shop catalog & dropdowns
sj("${item.price} pts", "${formatPoints(item.price)} pts");
sj("return `${price} pts`.substring", "return `${formatPoints(price)} pts`.substring");
sj("return `${price} pts ·", "return `${formatPoints(price)} pts ·");
sj("Number(userPoints).toLocaleString()", "formatPoints(userPoints)");

// Duel / bet (order: specific before generic)
sj("(duel.bet * 2).toLocaleString()", "formatPoints(duel.bet * 2)");
sj("duel.bet.toLocaleString()", "formatPoints(duel.bet)");
sj("target.points.toLocaleString()", "formatPoints(target.points)");
sj("challenger.points.toLocaleString()", "formatPoints(challenger.points)");
sj("(bet * 2).toLocaleString()", "formatPoints(bet * 2)");
sj("bet.toLocaleString()", "formatPoints(bet)");
sj("opponent.points.toLocaleString()", "formatPoints(opponent.points)");

// Duel over pot (raw multiplication)
sj("**${duel.bet * 2} points**!", "**${formatPoints(duel.bet * 2)} points**!");

// Factions
sj("factionDoc.totalPoints.toLocaleString()", "formatPoints(factionDoc.totalPoints)");
sj("factionDoc.members.toLocaleString()", "formatPoints(factionDoc.members)");
sj("user.points.toLocaleString()", "formatPoints(user.points)");
sj("f.totalPoints.toLocaleString()", "formatPoints(f.totalPoints)");
sj("| *Members:* ${f.members}", "| *Members:* ${formatPoints(f.members)}");

// Shop insufficient funds
sj(
    "`You don't have enough points! (Need ${item.price}, have ${user.points})`",
    "`You don't have enough points! (Need **${formatPoints(item.price)}**, have **${formatPoints(user.points)}**)`"
);
sj(
    "`You don't have enough points! (Need ${item.price}, have ${user.points})`, ephemeral: true",
    "`You don't have enough points! (Need **${formatPoints(item.price)}**, have **${formatPoints(user.points)}**)`, ephemeral: true"
);

// Admin adjust / daily / pay
sj(
    "`Adjusted points for ${user.username} by ${points}. New total: ${targetUser.points}.`",
    "`Adjusted points for ${user.username} by **${formatPoints(points)}**. New total: **${formatPoints(targetUser.points)}**.`"
);
sj(
    "`Your points have been adjusted by ${points}. Reason: ${reason}`",
    "`Your points have been adjusted by ${formatPoints(points)}. Reason: ${reason}`"
);
sj(
    "`${prefix} You claimed **${reward} points**! Come back tomorrow for more.`",
    "`${prefix} You claimed **${formatPoints(reward)} points**! Come back tomorrow for more.`"
);
sj(
    "`❌ You do not have enough points. (Balance: ${sender.points})`",
    "`❌ You do not have enough points. (Balance: **${formatPoints(sender.points)}**)`"
);
sj(
    "`💸 **Transfer Complete!**\\nYou sent **${amount} points** to <@${targetUser.id}>.`",
    "`💸 **Transfer Complete!**\\nYou sent **${formatPoints(amount)} points** to <@${targetUser.id}>.`"
);

// Leaderboard command output
sj("`${i+1}. ${badge}<@${u.userId}> - ${u.points} pts\\n`", "`${i+1}. ${badge}<@${u.userId}> - ${formatPoints(u.points)} pts\\n`");

// Profile embed
sj(
    "`Total: **${user.points || 0}**\\nWeekly: **${user.weeklyPoints || 0}**`",
    "`Total: **${formatPoints(user.points || 0)}**\\nWeekly: **${formatPoints(user.weeklyPoints || 0)}**`"
);

fs.writeFileSync(p, s);
console.log("Updated", p);
