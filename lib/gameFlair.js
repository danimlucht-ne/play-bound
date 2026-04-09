'use strict';

const { EmbedBuilder } = require('discord.js');
const { GAME_START_GIF_URLS, EMBED_COLORS } = require('./duelFlair');

/**
 * Rotating titles + taglines for game **start** messages (one embed per session).
 * GIFs/colors reuse the duel pool for variety; swap URLs in duelFlair if needed.
 */
const FLAIR = {
    trivia: {
        titles: ['🧠 Trivia match!', '🧠 Brain battle begins!', '📚 Quiz time!', '🎯 Facts only!'],
        lines: [
            'Warm up those neurons—highest score after all questions wins.',
            'Speed *and* accuracy matter. May the odds be ever in your favor.',
            'No lifelines—just buttons and vibes.',
            'Wrong answers sting. Right answers sparkle.',
        ],
    },
    serverdle: {
        titles: ['🟩 Serverdle!', '🟩 Five letters. Six tries.', '⌨️ Word time!'],
        lines: [
            'Green means go. Yellow means “close enough to panic.”',
            'Think Wordle, but your whole server is watching.',
            'Six guesses to glory—or six guesses to “I’ll get next round.”',
        ],
    },
    guessthenumber: {
        titles: ['🔢 Guess the number!', '🎲 Closest wins!', '📊 Number crunch time!'],
        lines: [
            'Closest guess takes the pot. May your intuition be oddly specific.',
            'It’s not the price is right—it’s “how wrong are you?”',
            'Pick a lane. Commit to the bit.',
        ],
    },
    moviequotes: {
        titles: ['🎬 TV & movie quotes!', '📺 Quote showdown!', '🎭 Name that show!'],
        lines: [
            'You know this one. Your brain is just buffering.',
            'Film school? No. Couch credentials? Absolutely.',
            'Spoiler: the answer is never “Citizen Kane” (probably).',
        ],
    },
    namethattune: {
        titles: ['🎵 Name That Tune!', '🎧 Listen up!', '🎶 Ear exam!'],
        lines: [
            'Thirty seconds of preview. A lifetime of bragging rights.',
            'Hum along internally. Out loud is optional chaos.',
            'Title match or it doesn’t count—fuzzy logic is on your side.',
        ],
    },
    caption: {
        titles: ['🖼️ Caption contest!', '✏️ Make it funny!', '🎭 Roast this image!'],
        lines: [
            'One caption per person—make it count.',
            'Reactions vote. Chaos decides.',
            'The image is cursed. Your caption can be worse.',
        ],
    },
    triviasprint: {
        titles: ['🏃 Trivia sprint!', '⚡ Speedrun mode!', '💨 Fast fingers!'],
        lines: [
            'Answer fast. Panic faster.',
            'The clock is rude and so is the difficulty.',
            'Sprint, don’t stroll—your time is literally ticking.',
        ],
    },
    unscramble: {
        titles: ['📝 Unscramble sprint!', '🔤 Letters, assemble!', '🧩 Word chaos!'],
        lines: [
            'The letters are wrong on purpose. Fix them.',
            'Your brain will unscramble before your pride does.',
            'Speed unscrambling: not on Duolingo, but it should be.',
        ],
    },
    spellingbee: {
        titles: ['🐝 Spelling Bee!', '📣 Listen and spell!', '🔤 Ears on, keyboards ready!'],
        lines: [
            'The bot says it; you type it. No human host required.',
            'VC for audio, thread for letters — stay in your lane.',
            'Pronunciation courtesy of robots. Dignity is optional.',
        ],
    },
    giveaway: {
        titles: ['🎁 Giveaway!', '🎉 Free stuff arc!', '🎊 Prize time!'],
        lines: [
            'Click enter. Manifest luck. Blame RNG if needed.',
            'No skill issue—just button issue.',
            'May your ping be low and your odds be fictional but hopeful.',
        ],
    },
    tournament: {
        titles: ['🎲 Dice tournament!', '🏆 Bracket energy!', '🎰 Roll for it!'],
        lines: [
            'High roll advances. Drama is included at no extra cost.',
            'Entry fee paid? Courage tax collected.',
            'The dice are fair. Your friends are not.',
        ],
    },
};

/**
 * @param {keyof typeof FLAIR} gameKey
 * @returns {EmbedBuilder}
 */
function makeGameFlairEmbed(gameKey) {
    const cfg = FLAIR[gameKey];
    if (!cfg) {
        return new EmbedBuilder().setColor(0x5865f2).setDescription('Game on!');
    }
    const title = cfg.titles[Math.floor(Math.random() * cfg.titles.length)];
    const desc = cfg.lines[Math.floor(Math.random() * cfg.lines.length)];
    const imageUrl = GAME_START_GIF_URLS[Math.floor(Math.random() * GAME_START_GIF_URLS.length)];
    const color = EMBED_COLORS[Math.floor(Math.random() * EMBED_COLORS.length)];
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(desc)
        .setImage(imageUrl)
        .setFooter({ text: 'PlayBound' });
}

module.exports = {
    makeGameFlairEmbed,
    FLAIR,
};
