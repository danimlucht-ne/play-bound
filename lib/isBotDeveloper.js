'use strict';

/**
 * Matches `DEVELOPER_ID` from `.env` (same gate as `/broadcast`, `/admin_premium`).
 * @param {string} userId Discord snowflake
 */
function isBotDeveloper(userId) {
    const dev = process.env.DEVELOPER_ID;
    return Boolean(dev && userId === dev);
}

module.exports = { isBotDeveloper };
