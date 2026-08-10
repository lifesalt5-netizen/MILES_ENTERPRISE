'use strict';

const assert = require('assert');
const connector = require('../CONNECTORS/INSTANTLY/connector');
const client = require('../CONNECTORS/INSTANTLY/instantly');

assert(connector.capabilities.includes('INSTANTLY_READ_REPLIES'));
assert(connector.capabilities.includes('INSTANTLY_LIST_EMAILS'));
assert.strictEqual(typeof client.listEmails, 'function');
assert.strictEqual(typeof client.listReceivedEmails, 'function');
assert.strictEqual(typeof client.getEmail, 'function');

console.log('INSTANTLY_READ_REPLIES_CAPABILITY_TEST=PASS');
