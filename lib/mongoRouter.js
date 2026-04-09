'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const mongoose = require('mongoose');

const asyncLocalStorage = new AsyncLocalStorage();

let modelsProd;
let modelsTest;
let connProd;
let connTest;
/** @type {Set<string>} */
let testGuildIds = new Set();
let dualMode = false;
/** True after initMongo() — prevents lazy default-connection from blocking bot startup. */
let botMongoInitDone = false;

function parseTestGuildIds() {
    const raw = process.env.PLAYBOUND_TEST_GUILD_IDS || '';
    return new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean));
}

function isTestGuild(guildId) {
    if (guildId == null || guildId === '') return false;
    return testGuildIds.has(String(guildId));
}

/**
 * @returns {boolean}
 */
function isDualMode() {
    return dualMode;
}

/**
 * Guild id from AsyncLocalStorage (interaction / message handlers).
 * @returns {string|null}
 */
function getCurrentGuildId() {
    const s = asyncLocalStorage.getStore();
    return s?.guildId != null ? String(s.guildId) : null;
}

/**
 * @param {string|null|undefined} guildId
 * @returns {object}
 */
function getModelsForGuild(guildId) {
    ensureLazyScriptConnection();
    if (!modelsProd) {
        throw new Error('[mongoRouter] MongoDB not initialized. Use initMongo() before handling traffic.');
    }
    const s = asyncLocalStorage.getStore();
    if (s?.forcedModels) return s.forcedModels;
    const gid = guildId != null && guildId !== '' ? String(guildId) : getCurrentGuildId();
    return isTestGuild(gid) ? modelsTest : modelsProd;
}

function getModelsProd() {
    ensureLazyScriptConnection();
    return modelsProd;
}

function getModelsTest() {
    ensureLazyScriptConnection();
    return modelsTest;
}

/**
 * Catalog (words / phrases / quotes) reads: prod by default so one in-memory pool matches live content.
 */
function getCatalogModels() {
    ensureLazyScriptConnection();
    if (process.env.PLAYBOUND_CATALOG_DB === 'test') return modelsTest;
    return modelsProd;
}

/**
 * @returns {object[]}
 */
function listModelBags() {
    ensureLazyScriptConnection();
    const bags = dualMode ? [modelsProd, modelsTest] : [modelsProd];
    return bags.filter(Boolean);
}

/**
 * Seed scripts / tests: mongoose.connect() without initMongo — bind models to default connection once.
 */
function ensureLazyScriptConnection() {
    if (modelsProd) return;
    if (botMongoInitDone) {
        throw new Error('[mongoRouter] Bot Mongo initialized but getModelsForGuild found no models.');
    }
    if (mongoose.connection.readyState === 1) {
        const { registerModels } = require('../models');
        modelsProd = registerModels(mongoose.connection);
        modelsTest = modelsProd;
        connProd = mongoose.connection;
        connTest = mongoose.connection;
        dualMode = false;
        console.warn(
            '[mongoRouter] Using default mongoose connection (seed script, test harness, or legacy single-DB).',
        );
    }
}

/**
 * @template T
 * @param {string|null|undefined} guildId
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
async function runWithGuild(guildId, fn) {
    const parent = asyncLocalStorage.getStore() || {};
    return asyncLocalStorage.run({ ...parent, guildId: guildId != null ? String(guildId) : null }, fn);
}

/**
 * @template T
 * @param {object} models
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<T>}
 */
async function runWithForcedModels(models, fn) {
    const parent = asyncLocalStorage.getStore() || {};
    return asyncLocalStorage.run({ ...parent, forcedModels: models }, fn);
}

async function initMongo() {
    if (botMongoInitDone) {
        return;
    }

    const uri = process.env.MONGO_URI;
    if (!uri) {
        throw new Error('MONGO_URI is required');
    }

    testGuildIds = parseTestGuildIds();
    dualMode = testGuildIds.size > 0;

    const dbProd = process.env.MONGO_DB_PROD || 'PlayBoundProd';
    const dbTest = process.env.MONGO_DB_TEST || 'PlayBoundTest';

    const { registerModels } = require('../models');

    connProd = mongoose.createConnection(uri, { dbName: dbProd });
    modelsProd = registerModels(connProd);

    if (dualMode) {
        connTest = mongoose.createConnection(uri, { dbName: dbTest });
        modelsTest = registerModels(connTest);
    } else {
        connTest = connProd;
        modelsTest = modelsProd;
    }

    await connProd.asPromise();
    if (dualMode) {
        await connTest.asPromise();
    }

    console.log(
        `[MongoDB] Connected${
            dualMode
                ? ` — dual DB (prod=${dbProd}, test=${dbTest}, ${testGuildIds.size} test guild id(s))`
                : ` — ${dbProd}`
        }`,
    );

    botMongoInitDone = true;
}

/**
 * Stripe / billing: same Discord user may exist in both DBs — keep premium flags in sync.
 * @param {import('mongodb').UpdateFilter<any>} update
 */
async function updateUserByDiscordIdEverywhere(userId, update) {
    ensureLazyScriptConnection();
    const filter = { userId: String(userId) };
    let total = 0;
    for (const models of listModelBags()) {
        const r = await models.User.updateMany(filter, update);
        total += r.modifiedCount || 0;
    }
    return total;
}

/**
 * Stripe revoke: strip premium cosmetics from all user rows (prod + test) for this Discord id.
 */
async function forEachUserDocumentByDiscordId(userId, fn) {
    ensureLazyScriptConnection();
    for (const models of listModelBags()) {
        const users = await models.User.find({ userId: String(userId) });
        for (const u of users) {
            await fn(u);
        }
    }
}

module.exports = {
    initMongo,
    isDualMode,
    isTestGuild,
    getCurrentGuildId,
    getModelsForGuild,
    getModelsProd,
    getModelsTest,
    getCatalogModels,
    listModelBags,
    runWithGuild,
    runWithForcedModels,
    updateUserByDiscordIdEverywhere,
    forEachUserDocumentByDiscordId,
    ensureLazyScriptConnection,
};
