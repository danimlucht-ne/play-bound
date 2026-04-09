const mongoose = require('mongoose');

const TEST_DB_NAME = process.env.TEST_MONGO_DB || `playbound_integration_${process.pid}`;
const TEST_URI = process.env.TEST_MONGO_URI || '';
const RUN_DB_TESTS = process.env.PLAYBOUND_ALLOW_DB_TESTS === '1' && !!TEST_URI;

function assertSafeTestTarget() {
    if (!RUN_DB_TESTS) {
        throw new Error('Real DB tests require PLAYBOUND_ALLOW_DB_TESTS=1 and TEST_MONGO_URI.');
    }

    const looksLocal = /localhost|127\.0\.0\.1|mongodb:\/\/mongo/i.test(TEST_URI);
    const looksNamedForTests = /test|staging|sandbox|integration/i.test(`${TEST_URI} ${TEST_DB_NAME}`);
    if (!looksLocal && !looksNamedForTests) {
        throw new Error(
            `Refusing to run DB integration tests against a URI that does not look isolated. ` +
            `Use a dedicated test/staging database via TEST_MONGO_URI/TEST_MONGO_DB.`,
        );
    }
}

async function connectTestDb() {
    assertSafeTestTarget();
    if (mongoose.connection.readyState === 1) return;
    await mongoose.connect(TEST_URI, { dbName: TEST_DB_NAME });
}

async function clearTestDb() {
    if (mongoose.connection.readyState !== 1) return;
    const collections = Object.values(mongoose.connection.collections);
    for (const collection of collections) {
        await collection.deleteMany({});
    }
}

async function disconnectTestDb() {
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
}

module.exports = {
    RUN_DB_TESTS,
    TEST_DB_NAME,
    connectTestDb,
    clearTestDb,
    disconnectTestDb,
};
