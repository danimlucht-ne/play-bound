'use strict';

const mongoRouter = require('../../lib/mongoRouter');

async function loadGameData(state) {
    try {
        const { Word, Phrase, MovieQuote } = mongoRouter.getCatalogModels();
        const wordsFromDb = await Word.find({});
        if (wordsFromDb.length > 0) {
            const five = wordsFromDb.filter(
                (w) => typeof w.word === 'string' && /^[A-Za-z]{5}$/.test(w.word.trim()),
            );
            if (five.length > 0) {
                state.WORDS = five.map((w) => w.word.toUpperCase());
            }
        }
        const phrasesFromDb = await Phrase.find({});
        if (phrasesFromDb.length > 0) {
            state.PHRASES = phrasesFromDb.map((p) => ({ phrase: p.phrase, clue: p.clue }));
        }

        const quotesFromDb = await MovieQuote.find({});
        console.log(`Loaded ${state.WORDS.length} words, ${state.PHRASES.length} phrases, and ${quotesFromDb.length} TV & movie quotes from database.`);
    } catch (err) {
        console.error('Failed to load game data from DB:', err);
    }
}

module.exports = { loadGameData };
