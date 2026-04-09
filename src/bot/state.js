'use strict';

/** In-memory game/session state shared across event handlers. */
const state = {
    activeSprints: new Map(),
    activeCaptions: new Map(),
    activeTunes: new Map(),
    activeUnscrambles: new Map(),
    activeGiveaways: new Map(),
    activeMovieGames: new Map(),
    storyLastUserId: new Map(),
    scheduledGames: new Map(),
    activeDuels: new Map(),
    WORDS: ['APPLE', 'BRAIN', 'CRANE', 'DANCE', 'EAGLE'],
    PHRASES: [
        { phrase: 'APPLE PIE', clue: 'A tasty dessert' },
        { phrase: 'SUPERMAN', clue: 'A hero from Krypton' },
    ],
    ACHIEVEMENTS_DB: {},
};

module.exports = state;
