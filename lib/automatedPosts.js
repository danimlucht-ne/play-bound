'use strict';

/**
 * Master switch for bot-driven channel posts (recaps, leaderboard message, game broadcasts, etc.).
 * @param {import('../models').SystemConfig|Record<string, unknown>} config
 * @returns {boolean}
 */
function automatedServerPostsEnabled(config) {
    return config.automatedServerPostsEnabled !== false;
}

module.exports = { automatedServerPostsEnabled };
