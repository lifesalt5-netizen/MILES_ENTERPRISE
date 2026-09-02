'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const single = require('../SCRIPTS/RunInstantlyGoogleOAuthZeroCostSender');
const src = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunInstantlyGoogleOAuthZeroCostMissingBatch.js'), 'utf8');

assert.strictEqual(single.ZERO_COST_PAID_TARGETS.length, 13);
assert.strictEqual(new Set(single.ZERO_COST_PAID_TARGETS).size, 13);
assert(single.ZERO_COST_PAID_TARGETS.every(email => !email.endsWith('@pathways2gc.com')));
assert(src.includes("instantly.request('/oauth/google/init'"));
assert(src.includes("instantly.request('/oauth/google/init', { method: 'POST', body: {} })"));
assert(!src.includes("instantly.request('/oauth/google/init', { method: 'POST' })"));
assert(src.includes('EXACT_ZERO_COST_OAUTH_AUTHORIZATION_REQUIRED'));
assert(src.includes('ZERO_COST_OAUTH_USER_CONSENT_REQUIRED'));
assert(src.includes('newGoogleWorkspaceLicenseAuthorized: false'));
assert(src.includes('aliasesCountAsIndependentSenders: false'));
assert(src.includes('protectedPrimaryDomainExcluded: true'));
assert(src.includes('googlePasswordsAcceptedOrStored: false'));
assert(src.includes('oauthRefreshTokensExposedToMiles: false'));
assert(src.includes('campaignMutation: false'));
assert(src.includes('prospectSend: false'));
assert(src.includes('dnsMutation: false'));
assert(!src.includes('imap_password'));
assert(!src.includes('smtp_password'));
assert(!src.includes('refresh_token'));
assert(!src.includes('createCampaign('));
assert(!src.includes('createLead('));

console.log('INSTANTLY_GOOGLE_OAUTH_ZERO_COST_MISSING_BATCH_TEST=PASS');
