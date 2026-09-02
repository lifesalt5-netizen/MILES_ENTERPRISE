'use strict';
const assert = require('assert');
const Service = require('../SERVICES/UsaspendingAwardHistoryStagingService');

const original = process.env.USASPENDING_DOWNLOAD_MAX_WAIT_MS;
try {
  delete process.env.USASPENDING_DOWNLOAD_MAX_WAIT_MS;
  const defaults = new Service({ root: process.cwd(), fetch: async () => { throw new Error('unused'); } });
  assert.strictEqual(defaults.maxWaitMs, 10800000, 'default wait must tolerate large official USAspending exports');
  process.env.USASPENDING_DOWNLOAD_MAX_WAIT_MS = '14400000';
  const envOverride = new Service({ root: process.cwd(), fetch: async () => { throw new Error('unused'); } });
  assert.strictEqual(envOverride.maxWaitMs, 14400000, 'environment override must be honored');
  const optionOverride = new Service({ root: process.cwd(), maxWaitMs: 12345, fetch: async () => { throw new Error('unused'); } });
  assert.strictEqual(optionOverride.maxWaitMs, 12345, 'explicit option must remain highest priority');
  assert.strictEqual(optionOverride.safety(true).operationalWritesAllowed, false);
  assert.strictEqual(optionOverride.safety(true).emailsSent, false);
  console.log('USASPENDING_LARGE_EXPORT_WAIT_TEST=GREEN');
} finally {
  if (original === undefined) delete process.env.USASPENDING_DOWNLOAD_MAX_WAIT_MS;
  else process.env.USASPENDING_DOWNLOAD_MAX_WAIT_MS = original;
}
