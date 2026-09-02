'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mod = require('../SCRIPTS/RunInstantlyGoogleOAuthZeroCostSender');
const src = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunInstantlyGoogleOAuthZeroCostSender.js'), 'utf8');

assert.strictEqual(mod.ZERO_COST_PAID_TARGETS.length, 13);
assert.strictEqual(new Set(mod.ZERO_COST_PAID_TARGETS).size, 13);
assert(mod.ZERO_COST_PAID_TARGETS.every(email => !email.endsWith('@pathways2gc.com')));
assert.deepStrictEqual(
  mod.ZERO_COST_PAID_TARGETS.filter(email => email.endsWith('@pathwaysgovcon.com')).sort(),
  ['cora@pathwaysgovcon.com','evan@pathwaysgovcon.com','maya@pathwaysgovcon.com','silvia@pathwaysgovcon.com','victoria@pathwaysgovcon.com'].sort()
);
assert.deepStrictEqual(
  mod.ZERO_COST_PAID_TARGETS.filter(email => email.endsWith('@pathwaysgsa.com')).sort(),
  ['chris@pathwaysgsa.com','evan@pathwaysgsa.com','jake@pathwaysgsa.com','kevin@pathwaysgsa.com','ryan@pathwaysgsa.com'].sort()
);
assert.deepStrictEqual(
  mod.ZERO_COST_PAID_TARGETS.filter(email => email.endsWith('@pathwaysgov.com')).sort(),
  ['aden@pathwaysgov.com','alexis@pathwaysgov.com','jeff@pathwaysgov.com'].sort()
);
assert.strictEqual(mod.PROTECTED_PRIMARY_DOMAIN, 'pathways2gc.com');
assert.strictEqual(mod.REQUIRED_AUTHORIZATION, 'AUTHORIZE_ZERO_COST_PAID_SENDER_GOOGLE_OAUTH');
assert(src.includes("instantly.request('/oauth/google/init'"));
assert(src.includes("instantly.request('/oauth/google/init', { method: 'POST', body: {} })"));
assert(!src.includes("instantly.request('/oauth/google/init', { method: 'POST' })"));
assert(src.includes('/oauth/session/status/'));
assert(src.includes('newGoogleWorkspaceLicenseAuthorized: false'));
assert(src.includes('aliasesCountAsIndependentSenders: false'));
assert(src.includes('OAUTH_CONNECTED_WRONG_ACCOUNT'));
assert(!src.includes('imap_password'));
assert(!src.includes('smtp_password'));

console.log('INSTANTLY_GOOGLE_OAUTH_ZERO_COST_SENDER_TEST=PASS');
