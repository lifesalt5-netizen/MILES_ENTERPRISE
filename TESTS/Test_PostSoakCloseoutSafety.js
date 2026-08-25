'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { classifySessionSnapshot } = require('../CONNECTORS/WEBSITE_B12/modules/session');

const root = path.resolve(__dirname, '..');
const nurture = fs.readFileSync(path.join(root, 'RUN_P2GC_DUE_NURTURE_CLOSEOUT.js'), 'utf8');
const nurturePs = fs.readFileSync(path.join(root, 'SCRIPTS', 'ExecuteDueNurtureCloseout.ps1'), 'utf8');
const b12 = fs.readFileSync(path.join(root, 'CONNECTORS', 'WEBSITE_B12', 'B12_AUTH_BOOTSTRAP.js'), 'utf8');
const b12Ps = fs.readFileSync(path.join(root, 'SCRIPTS', 'B12AuthenticateAndStage.ps1'), 'utf8');

assert(nurture.includes("approvalToken !== 'SEND_DUE_NURTURE'"), 'nurture execution must require explicit approval token');
assert(nurture.includes('QUEUE_CHANGED_AFTER_APPROVAL'), 'nurture execution must fail closed if queue changes after approval');
assert(nurture.includes("new Set(['OOO', 'NOT_NOW', 'QUALIFIED_NO_MEETING'])"), 'nurture closeout must restrict categories');
assert(nurture.includes("clean(op.status) !== 'READY_FOR_GOVERNED_EXECUTION'"), 'nurture closeout must require ready operations');
assert(nurturePs.includes('Read-Host "Type SEND'), 'PowerShell closeout must require interactive SEND confirmation');
assert(nurturePs.includes("MILES_DRY_RUN = 'false'"), 'execution must explicitly open dry-run gate only after approval');
assert(nurturePs.includes("INSTANTLY_WRITE_ENABLED = 'true'"), 'execution must explicitly open Instantly write gate only after approval');

assert(b12.includes('launchPersistentContext'), 'B12 auth must use persistent browser profile');
assert(b12.includes('credentialsCaptured: false'), 'B12 auth must explicitly record that MILES does not capture credentials');
assert(b12.includes('Press ENTER after you are logged into B12'), 'B12 auth must require user-performed login');
assert(b12Ps.includes("B12_PUBLISH_ENABLED = 'false'"), 'B12 public publishing must remain disabled');
assert(b12Ps.includes('-File $publisher -Apply'), 'B12 closeout should stage changes');
assert(!b12Ps.includes('-File $publisher -Apply -Publish'), 'B12 closeout must not request public publish');

const authenticatedEditor = classifySessionSnapshot({
  url: 'https://b12.io/client/k3pMXaMy/site_builder/',
  title: 'B12 Editor',
  body: 'Website editor. Contact email settings are available here.',
  hasPasswordInput: true
});
assert.equal(authenticatedEditor.loggedIn, true, 'authenticated B12 site_builder/editor must win over generic email/password DOM words');
assert.equal(authenticatedEditor.loggedOut, false, 'authenticated B12 editor must not be classified logged out');

const loginPage = classifySessionSnapshot({
  url: 'https://b12.io/login/',
  title: 'Log in to B12',
  body: 'Welcome back. Email Password Log in',
  hasPasswordInput: true
});
assert.equal(loginPage.loggedIn, false, 'B12 login page must not be classified authenticated');
assert.equal(loginPage.loggedOut, true, 'B12 login page must remain logged out');

console.log('B12_AUTH_EDITOR_SESSION_DETECTION=GREEN');
console.log('POST_SOAK_CLOSEOUT_SAFETY=GREEN');
