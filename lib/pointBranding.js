'use strict';

/** Spendable balance: shop, dailies, transfers, duels, admin `/adjustpoints`, etc. (`User.points`) */
const CREDITS = 'Credits';

/** Competitive total from listed mini-games (`User.competitivePoints`) — personal / server boards; global faction standings use challenges only. */
const ARENA_SCORE = 'Arena score';

/** Short explainer for `/help` and similar. */
function creditsVsArenaBlurb() {
    return (
        `**${CREDITS}** — shop, dailies, transfers, duels, admin grants; what \`/leaderboard\` ranks (per server cadence).\n\n` +
        `**${ARENA_SCORE}** — from the main mini-games (your profile & server views). **Global \`/factions\`** = **match points** from **ranked** faction wars (\`/faction_challenge join\`). Casual wars are local only.`
    );
}

module.exports = {
    CREDITS,
    ARENA_SCORE,
    creditsVsArenaBlurb,
};
