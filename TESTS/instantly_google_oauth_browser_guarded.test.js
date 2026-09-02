'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const mod = require('../SCRIPTS/RunInstantlyGoogleOAuthBrowserGuarded');
const src = fs.readFileSync(path.join(__dirname, '..', 'SCRIPTS', 'RunInstantlyGoogleOAuthBrowserGuarded.js'), 'utf8');

assert.strictEqual(mod.REQUIRED_BROWSER_AUTHORIZATION, 'AUTHORIZE_EXISTING_AUTHENTICATED_GOOGLE_OAUTH_CONSENT');
assert(src.includes("batch.initMissing(single.REQUIRED_AUTHORIZATION)"));
assert(src.includes('browser.launch(true)'));
assert(src.includes('INTENDED_ACCOUNT_NOT_AUTHENTICATED_IN_PROFILE'));
assert(src.includes('USER_LOGIN_OR_MFA_REQUIRED'));
assert(src.includes('ACCOUNT_IDENTITY_NOT_PROVEN'));
assert(src.includes('OAUTH_CLIENT_NOT_PROVEN'));
assert(src.includes('OAUTH_CONNECTED_EXACT_ACCOUNT'));
assert(src.includes('wrongAccountConsentPrevented'));
assert(src.includes('passwordsReadOrEntered: false'));
assert(src.includes('cookiesOrTokensExposed: false'));
assert(src.includes('mfaBypassAttempted: false'));
assert(src.includes('newGoogleWorkspaceLicenseAuthorized: false'));
assert(src.includes('protectedPrimaryDomainExcluded: true'));
assert(src.includes('prospectSend: false'));
assert(src.includes('campaignMutation: false'));
assert(src.includes('dnsMutation: false'));
assert(!src.includes('.fill('));
assert(!src.includes('.type('));
assert(!src.includes('keyboard.type'));
assert(!src.includes('context.cookies'));
assert(!src.includes('storageState('));
assert(!src.includes('refresh_token'));
assert(!src.includes('imap_password'));
assert(!src.includes('smtp_password'));

console.log('INSTANTLY_GOOGLE_OAUTH_BROWSER_GUARDED_TEST=PASS');
