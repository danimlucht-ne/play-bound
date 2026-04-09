'use strict';

const { isMasterGameDisableActive, getPerCommandDisableCount } = require('./commandGate');
const { getActiveMaintenanceWindow } = require('./maintenanceScheduling');

const DEFAULT_ACTIVITY_NAME = '/help · Credits & Arena | PlayBound';
const DEFAULT_TYPE = 3; // WATCHING

/**
 * @returns {{ name: string, type: number } | null} null = use default PlayBound line
 */
function getOpsPresenceActivity() {
    const w = getActiveMaintenanceWindow();
    const now = Date.now();

    if (isMasterGameDisableActive()) {
        return { name: 'Maintenance — game slash commands paused', type: DEFAULT_TYPE };
    }
    if (getPerCommandDisableCount() > 0) {
        return { name: 'Limited slash commands — see server news', type: DEFAULT_TYPE };
    }
    if (w && now >= w.startMs && now < w.endMs) {
        return { name: 'Maintenance window — thanks for your patience', type: DEFAULT_TYPE };
    }
    return null;
}

/**
 * @param {import('discord.js').Client} client
 */
function applyOpsPresence(client) {
    if (!client?.user) return;
    const act = getOpsPresenceActivity();
    if (act) {
        client.user.setActivity(act.name, { type: act.type });
    } else {
        client.user.setActivity(DEFAULT_ACTIVITY_NAME, { type: DEFAULT_TYPE });
    }
}

module.exports = { applyOpsPresence, getOpsPresenceActivity, DEFAULT_ACTIVITY_NAME, DEFAULT_TYPE };
