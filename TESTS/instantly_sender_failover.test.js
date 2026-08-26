'use strict';

const assert = require('assert');
const { resolveSender } = require('../SERVICES/revenue/InstantlySenderFailoverService');

const inventory = [
  { email: 'oldsender@pathways2gc.com', status: 'disconnected' },
  { email: 'kevin@pathways2gc.com', status: 'active', connected: true },
  { email: 'other@example.com', status: 'active', connected: true }
];

const jamesIncident = resolveSender({
  requestedSender: 'oldsender@pathways2gc.com',
  inventory,
  approvedFallbacks: ['kevin@pathways2gc.com'],
  primaryFallback: 'kevin@pathways2gc.com',
  allowSameDomain: true
});
assert.strictEqual(jamesIncident.ok, true);
assert.strictEqual(jamesIncident.selected, 'kevin@pathways2gc.com');
assert.strictEqual(jamesIncident.failover, true);
assert.strictEqual(jamesIncident.reason, 'REQUESTED_SENDER_UNAVAILABLE_FALLBACK_SELECTED');

const healthyOriginal = resolveSender({ requestedSender: 'kevin@pathways2gc.com', inventory });
assert.strictEqual(healthyOriginal.ok, true);
assert.strictEqual(healthyOriginal.selected, 'kevin@pathways2gc.com');
assert.strictEqual(healthyOriginal.failover, false);

const blocked = resolveSender({
  requestedSender: 'oldsender@pathways2gc.com',
  inventory: [{ email: 'oldsender@pathways2gc.com', status: 'disconnected' }],
  approvedFallbacks: ['kevin@pathways2gc.com']
});
assert.strictEqual(blocked.ok, false);
assert.strictEqual(blocked.status, 'SEND_ACCOUNT_BLOCKED');

const excludedRetry = resolveSender({
  requestedSender: 'oldsender@pathways2gc.com',
  inventory,
  approvedFallbacks: ['kevin@pathways2gc.com'],
  excluded: ['kevin@pathways2gc.com']
});
assert.strictEqual(excludedRetry.ok, false);

console.log('INSTANTLY_SENDER_FAILOVER_REGRESSION=GREEN');
