'use strict';

/**
 * Game tags valid for faction challenges / competitive ledger (no Mongoose — safe to import before DB init).
 */
const { PLATFORM_GAME_TAGS } = require('./gamePlatform/registry');

const VALID_TAGS = new Set([
    'all',
    'trivia',
    'triviasprint',
    'serverdle',
    'guessthenumber',
    'mastermind',
    'moviequotes',
    'unscramble',
    'caption',
    'namethattune',
    'spellingbee',
    ...PLATFORM_GAME_TAGS,
]);

module.exports = { VALID_TAGS };
