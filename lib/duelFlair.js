'use strict';

/**
 * Rotating flavor for `/duel` challenge embeds (picked independently each time).
 * GIFs are direct HTTPS links suitable for Discord embed `image.url`.
 */
const DUEL_CHALLENGE_QUOTES = [
    '“There can be only one… owner of the pot.”',
    '“I’ve studied the wiki. I’ve read the patch notes. You’re toast.”',
    '“This is not personal. It’s trivia.”',
    '“May the best brain win.”',
    '“Stakes up. Egos higher.”',
    '“You brought facts? Cute. I brought *facts*.”',
    '“First correct answer takes all. No pressure.”',
    '“It’s just one question… said every duel loser ever.”',
    '“The house always wins—unless you do.”',
    '“Bold of you to challenge me before coffee.”',
    '“RNGesus take the wheel.”',
    '“Wrong answer = instant regret. Choose wisely.”',
];

/** SFW fight / duel energy — replace URLs if any ever break. */
const DUEL_GIF_URLS = [
    'https://media.giphy.com/media/26ufdipCqD2i0bc0g/giphy.gif',
    'https://media.giphy.com/media/l0MYC0LajbaPoEADu/giphy.gif',
    'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif',
    'https://media.giphy.com/media/Is1O1TWV0LEbA/giphy.gif',
    'https://media.giphy.com/media/3o7abldj0b3rxrZ4Wg/giphy.gif',
    'https://media.giphy.com/media/3o7btPCcdNniyf0ArS/giphy.gif',
    'https://media.giphy.com/media/3o7btZ0bq79m5OuuCs/giphy.gif',
    'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif',
];

/** Larger pool for game-start embeds (SFW celebration / hype). */
const GAME_START_EXTRA_GIFS = [
    'https://media.giphy.com/media/3o7aD2saalBwwftBIY/giphy.gif',
    'https://media.giphy.com/media/l0HlNQ03JzpJtmyKA/giphy.gif',
    'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif',
    'https://media.giphy.com/media/26gspipWnu5DzqeSk/giphy.gif',
    'https://media.giphy.com/media/3o7btPCcdNniyf0ArS/giphy.gif',
    'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif',
    'https://media.giphy.com/media/d2Z9QYSTvW8Rncjm/giphy.gif',
    'https://media.giphy.com/media/ICOgUNjpvO0PC/giphy.gif',
    'https://media.giphy.com/media/3o7TKSjRrfIPjeiVZC/giphy.gif',
    'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif',
    'https://media.giphy.com/media/3o7abldj0b3rxrZ4Wg/giphy.gif',
    'https://media.giphy.com/media/Is1O1TWV0LEbA/giphy.gif',
];

const GAME_START_GIF_URLS = [...DUEL_GIF_URLS, ...GAME_START_EXTRA_GIFS];

const EMBED_COLORS = [0xff4500, 0xe74c3c, 0x9b59b6, 0x3498db, 0xf39c12, 0x1abc9c, 0xe91e63];

function pickDuelChallengeFlair() {
    const quote = DUEL_CHALLENGE_QUOTES[Math.floor(Math.random() * DUEL_CHALLENGE_QUOTES.length)];
    const imageUrl = DUEL_GIF_URLS[Math.floor(Math.random() * DUEL_GIF_URLS.length)];
    const color = EMBED_COLORS[Math.floor(Math.random() * EMBED_COLORS.length)];
    return { quote, imageUrl, color };
}

/** One-liner when the duel question appears (optional spice). */
const DUEL_FIGHT_LINES = [
    '⚡ **Fight!** First correct answer wins the pot.',
    '🔥 **Here we go!** No second chances on the buzzer.',
    '⚔️ **Blades out, brains on.**',
    '🎯 **Lock in.** One shot each mentality (wrong = lose).',
];

function pickDuelFightLine() {
    return DUEL_FIGHT_LINES[Math.floor(Math.random() * DUEL_FIGHT_LINES.length)];
}

module.exports = {
    pickDuelChallengeFlair,
    pickDuelFightLine,
    DUEL_CHALLENGE_QUOTES,
    DUEL_GIF_URLS,
    GAME_START_GIF_URLS,
    EMBED_COLORS,
};
