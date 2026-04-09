const fs = require("fs");
const path = require("path");
const p = path.join(__dirname, "..", "src", "events", "interactionCreate.js");
let s = fs.readFileSync(p, "utf8");

function sj(from, to) {
    s = s.split(from).join(to);
}

sj("duel.bet.toLocaleString()", "formatPoints(duel.bet)");
sj("(duel.bet * 2).toLocaleString()", "formatPoints(duel.bet * 2)");
sj("target.points.toLocaleString()", "formatPoints(target.points)");
sj("challenger.points.toLocaleString()", "formatPoints(challenger.points)");
sj("bet.toLocaleString()", "formatPoints(bet)");
sj("(bet * 2).toLocaleString()", "formatPoints(bet * 2)");
sj("opponent.points.toLocaleString()", "formatPoints(opponent.points)");
sj("factionDoc.totalPoints.toLocaleString()", "formatPoints(factionDoc.totalPoints)");
sj("factionDoc.members.toLocaleString()", "formatPoints(factionDoc.members)");
sj("user.points.toLocaleString()", "formatPoints(user.points)");
sj("f.totalPoints.toLocaleString()", "formatPoints(f.totalPoints)");
sj("| *Members:* ${f.members}", "| *Members:* ${formatPoints(f.members)}");

fs.writeFileSync(p, s);
console.log("ok");
