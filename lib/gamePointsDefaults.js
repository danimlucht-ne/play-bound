'use strict';

/** Default podium string for multi-place games (1st, 2nd, 3rd, …). */
const DEFAULT_PLACEMENT_POINTS = '25,15,5';

/** Credits-style points for players who played but did not place on the podium. */
const DEFAULT_PARTICIPATION_POINTS = 1;

/** Single-winner default (caption, etc.). */
const DEFAULT_SINGLE_WINNER_POINTS = '25';

/** Guess the number: only the winner’s slice from this string (default 25). Everyone who submitted a guess also gets `DEFAULT_PARTICIPATION_POINTS`. */
const DEFAULT_GUESS_NUMBER_WINNER_POINTS = '25';

/** Serverdle placement ladder default. */
const DEFAULT_SERVERDLE_PLACEMENT = '25,15,5';

/** Giveaway: first N winners use placement string; non-winners who entered get participation. */
const DEFAULT_GIVEAWAY_PLACEMENT = '25,15,5';

module.exports = {
    DEFAULT_PLACEMENT_POINTS,
    DEFAULT_PARTICIPATION_POINTS,
    DEFAULT_SINGLE_WINNER_POINTS,
    DEFAULT_GUESS_NUMBER_WINNER_POINTS,
    DEFAULT_SERVERDLE_PLACEMENT,
    DEFAULT_GIVEAWAY_PLACEMENT,
};
