'use strict';

const { EmbedBuilder } = require('discord.js');
const mongoRouter = require('./mongoRouter');
const { getActiveMaintenanceWindow } = require('./maintenanceScheduling');
const { automatedServerPostsEnabled } = require('./automatedPosts');
const { logOpsEvent } = require('./opsEventLog');

const ENV_ENABLE = 'PLAYBOUND_MAINTENANCE_AUTO_BROADCAST';
const ENV_MAX_LEAD_MS = 'PLAYBOUND_MAINTENANCE_BROADCAST_MAX_LEAD_MS';
const ENV_FOOTER = 'PLAYBOUND_MAINTENANCE_BROADCAST_FOOTER';

function truthyEnv(v) {
    if (v == null) return false;
    const s = String(v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function isMaintenanceAutoBroadcastEnabled() {
    return truthyEnv(process.env[ENV_ENABLE]);
}

/**
 * @returns {number|null} ms — only send when (start - now) <= this; null = no cap (send as soon as bot is up and window is future)
 */
function getBroadcastMaxLeadMs() {
    const raw = process.env[ENV_MAX_LEAD_MS];
    if (raw == null || String(raw).trim() === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** @param {import('mongoose').MongoServerError} e */
function isDuplicateKeyError(e) {
    return e && e.code === 11000;
}

/**
 * @param {number} ms
 * @returns {string}
 */
function formatDurationHuman(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return 'less than a minute';
    const totalM = Math.ceil(n / 60000);
    const days = Math.floor(totalM / (60 * 24));
    const hours = Math.floor((totalM % (60 * 24)) / 60);
    const minutes = totalM % 60;
    const parts = [];
    if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`);
    if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
    if (minutes > 0 && days === 0) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
    if (parts.length === 0) return 'less than a minute';
    return parts.join(' and ');
}

/**
 * @param {number} nowMs
 * @param {{ startMs: number, endMs: number }} w
 * @returns {boolean}
 */
function shouldAttemptAdvanceBroadcast(nowMs, w) {
    if (!w) return false;
    const now = Number(nowMs);
    if (!Number.isFinite(now)) return false;
    if (now >= w.startMs) return false;
    const maxLead = getBroadcastMaxLeadMs();
    if (maxLead != null && w.startMs - now > maxLead) return false;
    return true;
}

/** @param {Record<string, unknown>} config */
function shouldPingEveryone(config) {
    if (config.announcePingEveryone === true) return true;
    if (config.announcePingEveryone === false) return false;
    return true;
}

/**
 * @param {{ startMs: number, endMs: number }} w
 * @returns {import('discord.js').EmbedBuilder}
 */
function buildMaintenanceBroadcastEmbed(w) {
    const durationMs = w.endMs - w.startMs;
    const startIso = new Date(w.startMs).toISOString();
    const endIso = new Date(w.endMs).toISOString();
    const durationHuman = formatDurationHuman(durationMs);

    let description = [
        'PlayBound **scheduled maintenance** is coming.',
        '',
        `**Starts:** \`${startIso}\` (UTC)`,
        `**Ends:** \`${endIso}\` (UTC)`,
        `**Approx. duration:** ${durationHuman}`,
        '',
        'During this window, **new games may not start** and some delayed schedules may be blocked. Sessions that would still be running when maintenance begins may be restricted. **Please plan accordingly.**',
        '',
        '_All times are UTC — convert to your local time if needed._',
    ]
        .filter((line) => line !== '')
        .join('\n\n');

    const extra = process.env[ENV_FOOTER];
    if (extra != null && String(extra).trim() !== '') {
        description += `\n\n${String(extra).trim()}`;
    }

    return new EmbedBuilder()
        .setColor('#E67E22')
        .setTitle('🔧 PlayBound maintenance notice')
        .setDescription(description)
        .setTimestamp(new Date());
}

/**
 * Posts a templated advance notice to each guild’s announcement channel (when automated posts are on).
 * Idempotent per (guild, window, phase) via MaintenanceBroadcastLog.
 *
 * @param {import('discord.js').Client} client
 * @returns {Promise<{ sent: number, failed: number, skipped?: boolean, reason?: string }>}
 */
async function runMaintenanceAdvanceBroadcast(client) {
    if (!isMaintenanceAutoBroadcastEnabled()) {
        return { sent: 0, failed: 0, skipped: true, reason: 'disabled' };
    }
    const w = getActiveMaintenanceWindow();
    if (!w) {
        return { sent: 0, failed: 0, skipped: true, reason: 'no_window' };
    }
    const now = Date.now();
    if (!shouldAttemptAdvanceBroadcast(now, w)) {
        return { sent: 0, failed: 0, skipped: true, reason: 'outside_lead_window_or_started' };
    }

    const embed = buildMaintenanceBroadcastEmbed(w);
    let sent = 0;
    let failed = 0;

    for (const bag of mongoRouter.listModelBags()) {
        await mongoRouter.runWithForcedModels(bag, async () => {
            const { SystemConfig, MaintenanceBroadcastLog } = bag;
            const configs = await SystemConfig.find({
                announceChannel: { $nin: [null, ''] },
            }).lean();

            for (const config of configs) {
                if (!automatedServerPostsEnabled(config)) continue;

                let doc;
                try {
                    doc = await MaintenanceBroadcastLog.create({
                        guildId: config.guildId,
                        windowStartMs: w.startMs,
                        windowEndMs: w.endMs,
                        phase: 'advance',
                        sentAt: new Date(),
                    });
                } catch (e) {
                    if (isDuplicateKeyError(e)) continue;
                    console.error('[maintenanceBroadcast] dedupe insert failed:', e?.message || e);
                    failed++;
                    continue;
                }

                try {
                    const chan = await client.channels.fetch(config.announceChannel).catch(() => null);
                    if (!chan || typeof chan.send !== 'function') {
                        await MaintenanceBroadcastLog.deleteOne({ _id: doc._id }).catch(() => {});
                        failed++;
                        continue;
                    }
                    const ping = shouldPingEveryone(config);
                    await chan.send({
                        content: ping ? '@everyone' : undefined,
                        embeds: [embed],
                        allowedMentions: ping ? { parse: ['everyone'] } : { parse: [] },
                    });
                    sent++;
                    logOpsEvent('maintenance_broadcast', {
                        phase: 'advance',
                        guildId: config.guildId,
                        windowStartMs: w.startMs,
                        windowEndMs: w.endMs,
                    });
                } catch (e) {
                    await MaintenanceBroadcastLog.deleteOne({ _id: doc._id }).catch(() => {});
                    console.error(`[maintenanceBroadcast] send guild=${config.guildId}:`, e?.message || e);
                    failed++;
                }
            }
        });
    }

    if (sent > 0 || failed > 0) {
        console.log(`[maintenanceBroadcast] advance: sent=${sent} failed=${failed}`);
    }
    return { sent, failed };
}

module.exports = {
    isMaintenanceAutoBroadcastEnabled,
    getBroadcastMaxLeadMs,
    formatDurationHuman,
    shouldAttemptAdvanceBroadcast,
    buildMaintenanceBroadcastEmbed,
    runMaintenanceAdvanceBroadcast,
};
