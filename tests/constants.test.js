const test = require('node:test');
const assert = require('node:assert/strict');

const constants = require('../src/bot/constants');

test('constants expose current version values', () => {
  assert.equal(constants.CURRENT_TERMS_VERSION, '1.0');
  assert.equal(constants.CURRENT_PRIVACY_VERSION, '1.0');
});
