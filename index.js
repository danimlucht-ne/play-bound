'use strict';

require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || '.env' });
require('./lib/instrument');
require('./lib/processLogCapture').install();
const { playboundDebugEnabled } = require('./lib/playboundDebug');

console.log('[BOT STARTUP] Initializing PlayBound Bot...');

const { generateDependencyReport } = require('@discordjs/voice');
if (playboundDebugEnabled()) {
    console.log('[BOT STARTUP] @discordjs/voice dependency report:\n' + generateDependencyReport());
}

async function main() {
    const mongoRouter = require('./lib/mongoRouter');
    await mongoRouter.initMongo();

    const { getActiveMaintenanceWindow } = require('./lib/maintenanceScheduling');
    const maintWin = getActiveMaintenanceWindow();
    if (maintWin) {
        console.log(
            `[BOT STARTUP] Maintenance scheduling window active — new schedules blocked for start times in [${new Date(maintWin.startMs).toISOString()}, ${new Date(maintWin.endMs).toISOString()})`,
        );
    }
    const { isMaintenanceAutoBroadcastEnabled, getBroadcastMaxLeadMs } = require('./lib/maintenanceBroadcast');
    if (maintWin && isMaintenanceAutoBroadcastEnabled()) {
        const lead = getBroadcastMaxLeadMs();
        console.log(
            `[BOT STARTUP] Maintenance auto-broadcast enabled — templated advance posts to announce channels (lead cap: ${lead != null ? `${lead}ms` : 'none'})`,
        );
    }

    const { getCommandGateStatusForLog } = require('./lib/commandGate');
    const gate = getCommandGateStatusForLog();
    if (gate.masterGameCommandsDisabled) {
        const u =
            gate.masterUntilMs != null
                ? ` (auto-clear after ${new Date(gate.masterUntilMs).toISOString()} UTC)`
                : '';
        console.log(`[BOT STARTUP] Slash game commands disabled${u} — see PLAYBOUND_DISABLE_ALL_GAMES in .env.example`);
    }
    if (gate.extraDisabledCount > 0) {
        console.log(
            `[BOT STARTUP] ${gate.extraDisabledCount} extra slash command(s) disabled via PLAYBOUND_DISABLED_SLASH_COMMANDS`,
        );
    }

    const { Client, GatewayIntentBits, Partials } = require('discord.js');

    const { createHttpApp, listenHttpServer } = require('./src/server/webhook');
    const { registerShutdownHook, installSignalHandlers } = require('./lib/botLifecycle');
    const state = require('./src/bot/state');

    registerShutdownHook(() => {
        for (const entry of state.scheduledGames.values()) {
            if (entry?.timeoutHandle != null) {
                try {
                    clearTimeout(entry.timeoutHandle);
                } catch (_) {
                    /* ignore */
                }
            }
        }
    });
    const { createScheduleHelpers } = require('./src/bot/schedule');
    const { loadGameData } = require('./src/bot/gameData');
    const { createGameEndTriggers } = require('./src/bot/gameEndTriggers');
    const { registerInteractionCreate } = require('./src/events/interactionCreate');
    const { registerMessageCreate } = require('./src/events/messageCreate');
    const { registerReadyHandler } = require('./src/events/ready');
    const { registerGuildEvents } = require('./src/events/guildEvents');

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildMessageReactions,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildVoiceStates,
        ],
        partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember],
    });

    const { Sentry, sentryEnabled } = require('./lib/instrument');
    if (sentryEnabled && Sentry) {
        client.on('error', (err) => Sentry.captureException(err));
    }

    const { scheduleGame, resumeScheduledGames } = createScheduleHelpers(client, state);
    const triggers = createGameEndTriggers(client, state);

    registerReadyHandler(client, {
        state,
        triggers,
        loadGameData: () => loadGameData(state),
        resumeScheduledGames,
    });

    registerGuildEvents(client);

    registerInteractionCreate(client, {
        state,
        triggers,
        scheduleGame,
    });

    registerMessageCreate(client, { state, triggers });

    const httpApp = createHttpApp({
        client,
        state,
        scheduleGame,
        resumeScheduledGames,
        triggers,
    });
    const httpServer = listenHttpServer(httpApp);
    installSignalHandlers({ client, httpServer });

    await client.login(process.env.DISCORD_TOKEN);
}

main().catch(async (err) => {
    console.error('[BOT STARTUP] Fatal error:', err);
    try {
        const { Sentry, sentryEnabled } = require('./lib/instrument');
        if (sentryEnabled && Sentry) {
            Sentry.captureException(err);
            await Sentry.flush(2000);
        }
    } catch (_) {
        /* ignore */
    }
    process.exit(1);
});
