'use strict';

const { isBotDeveloper } = require('./isBotDeveloper');
const { logOpsEvent } = require('./opsEventLog');

/**
 * Slash commands treated as “hosted / competitive games” for PLAYBOUND_DISABLE_ALL_GAMES.
 * Not included: /endgame, /listgames, /help, economy, etc.
 */
const DEFAULT_GAME_SLASH_COMMANDS = [
    'playgame',
    'giveaway',
    'moviequotes',
    'namethattune',
    'caption',
    'triviasprint',
    'unscramble',
    'trivia',
    'guessthenumber',
    'mastermind',
    'startserverdle',
    'spellingbee',
    'duel',
    'tournament',
    'faction_challenge',
];

const GAME_SLASH_COMMANDS = new Set(DEFAULT_GAME_SLASH_COMMANDS);

const ENV_DISABLE_A = 'PLAYBOUND_DISABLE_ALL_GAME_COMMANDS';
const ENV_DISABLE_B = 'PLAYBOUND_DISABLE_ALL_GAMES';
const ENV_UNTIL_A = 'PLAYBOUND_DISABLE_ALL_GAME_COMMANDS_UNTIL';
const ENV_UNTIL_B = 'PLAYBOUND_DISABLE_ALL_GAMES_UNTIL';
const ENV_DISABLED_LIST = 'PLAYBOUND_DISABLED_SLASH_COMMANDS';
const ENV_MESSAGE = 'PLAYBOUND_DISABLED_COMMANDS_MESSAGE';
const ENV_BYPASS_DEV = 'PLAYBOUND_COMMAND_GATE_BYPASS_DEVELOPER';

function truthyEnv(v) {
    if (v == null) return false;
    const s = String(v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function parseUntilMs() {
    for (const k of [ENV_UNTIL_A, ENV_UNTIL_B]) {
        const raw = process.env[k];
        if (raw == null || String(raw).trim() === '') continue;
        const t = Date.parse(String(raw).trim());
        if (Number.isFinite(t)) return t;
    }
    return null;
}

function isMasterGameDisableActive() {
    if (!truthyEnv(process.env[ENV_DISABLE_A]) && !truthyEnv(process.env[ENV_DISABLE_B])) {
        return false;
    }
    const until = parseUntilMs();
    if (until != null && Date.now() >= until) {
        return false;
    }
    return true;
}

function parseDisabledSlashCommands() {
    const raw = process.env[ENV_DISABLED_LIST] || '';
    const set = new Set();
    for (const part of raw.split(/[\s,]+/)) {
        const s = part.trim().toLowerCase();
        if (s) set.add(s);
    }
    return set;
}

function getPerCommandDisableCount() {
    return parseDisabledSlashCommands().size;
}

function defaultDenialMessage() {
    const custom = process.env[ENV_MESSAGE];
    if (custom != null && String(custom).trim() !== '') {
        return String(custom).trim();
    }
    return '⏸️ This command is temporarily unavailable. Please try again later.';
}

/**
 * @param {string} commandName
 * @param {string} [discordUserId]
 * @param {{ guildId?: string|null }} [ctx]
 * @returns {string|null} user-facing message if blocked
 */
function getDisabledSlashCommandMessage(commandName, discordUserId, ctx = {}) {
    if (!commandName) return null;
    const name = String(commandName).toLowerCase();

    if (discordUserId && truthyEnv(process.env[ENV_BYPASS_DEV]) && isBotDeveloper(discordUserId)) {
        return null;
    }

    const perCommand = parseDisabledSlashCommands();
    if (perCommand.has(name)) {
        logOpsEvent('command_gate', {
            reason: 'per_command_list',
            command: name,
            guildId: ctx.guildId ?? null,
            userId: discordUserId ?? null,
        });
        return defaultDenialMessage();
    }

    if (isMasterGameDisableActive() && GAME_SLASH_COMMANDS.has(name)) {
        logOpsEvent('command_gate', {
            reason: 'master_game_disable',
            command: name,
            guildId: ctx.guildId ?? null,
            userId: discordUserId ?? null,
        });
        return defaultDenialMessage();
    }

    return null;
}

function getCommandGateStatusForLog() {
    const until = parseUntilMs();
    const master = isMasterGameDisableActive();
    const extra = parseDisabledSlashCommands();
    return {
        masterGameCommandsDisabled: master,
        masterUntilMs: master ? until : null,
        extraDisabledCount: extra.size,
    };
}

module.exports = {
    GAME_SLASH_COMMANDS,
    getDisabledSlashCommandMessage,
    getCommandGateStatusForLog,
    getPerCommandDisableCount,
    isMasterGameDisableActive,
};
