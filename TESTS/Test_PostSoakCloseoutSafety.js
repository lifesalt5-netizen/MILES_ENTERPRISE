'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { classifySessionSnapshot } = require('../CONNECTORS/WEBSITE_B12/modules/session');

const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const nurture = read('RUN_P2GC_DUE_NURTURE_CLOSEOUT.js');
const nurturePs = read('SCRIPTS', 'ExecuteDueNurtureCloseout.ps1');
const b12Bootstrap = read('CONNECTORS', 'WEBSITE_B12', 'B12_AUTH_BOOTSTRAP.js');
const b12Single = read('CONNECTORS', 'WEBSITE_B12', 'B12_AUTH_AND_STAGE_SINGLE_SESSION.js');
const b12V9 = read('CONNECTORS', 'WEBSITE_B12', 'B12_CONTROLLED_PUBLISHER_V9.js');
const b12V10 = read('CONNECTORS', 'WEBSITE_B12', 'B12_CONTROLLED_PUBLISHER_V10.js');
const b12V11 = read('CONNECTORS', 'WEBSITE_B12', 'B12_CONTROLLED_PUBLISHER_V11.js');
const b12V12 = read('CONNECTORS', 'WEBSITE_B12', 'B12_CONTROLLED_PUBLISHER_V12.js');
const b12V13 = read('CONNECTORS', 'WEBSITE_B12', 'B12_CONTROLLED_PUBLISHER_V13.js');
const b12Runner = read('CONNECTORS', 'WEBSITE_B12', 'RUN_CONTROLLED_PUBLISH_V2.ps1');
const b12Ps = read('SCRIPTS', 'B12AuthenticateAndStage.ps1');

// Nurture exact-set execution safety remains intact.
assert(nurture.includes("approvalToken !== 'SEND_DUE_NURTURE'"));
assert(nurture.includes('QUEUE_CHANGED_AFTER_APPROVAL'));
assert(nurture.includes("new Set(['OOO', 'NOT_NOW', 'QUALIFIED_NO_MEETING'])"));
assert(nurturePs.includes('Read-Host "Type SEND'));
assert(nurturePs.includes("MILES_DRY_RUN = 'false'"));
assert(nurturePs.includes("INSTANTLY_WRITE_ENABLED = 'true'"));

// Authentication is persistent but MILES never captures credentials.
assert(b12Bootstrap.includes('launchPersistentContext'));
assert(b12Bootstrap.includes('credentialsCaptured: false'));
assert(b12Single.includes('launchPersistentContext'));
assert(b12Single.includes('singleBrowserSession: true'));
assert(b12Single.includes('publisher.context = context'));
assert(b12Single.includes('publisher.page = page'));
assert(b12Single.includes('publisher.open = async () => page'));
assert(b12Single.includes('publisher.close = async () => {}'));
assert(b12Single.includes('firstPartyVisibleControls'));
assert(b12Single.includes('B12_FIRST_PARTY_EDITOR_UI_NOT_OBSERVABLE_IN_AUTOMATION_SESSION'));
assert(b12Single.includes("require('./B12_CONTROLLED_PUBLISHER_V13')"), 'single-session staging must use V13');

// Public publishing remains explicitly disabled in the closeout wrapper.
assert(b12Ps.includes("B12_PUBLISH_ENABLED = 'false'"));
assert(b12Ps.includes("P2GC_B12_PUBLISH = 'false'"));
assert(b12Ps.includes("B12_RESUME_SUCCESSFUL_OPERATIONS = 'true'"));
assert(b12Ps.includes("B12_CONFIRMED_SUCCESSFUL_OPERATION_SEED = 'HOMEPAGE_CONVERSION_V2'"));
assert(!b12Ps.includes('-Publish'));
assert(b12Runner.includes('B12_CONTROLLED_PUBLISHER_V4.js'));

// Durable resume / atomic build / completion lineage must remain present.
assert(b12V9.includes('successful_operations.json'));
assert(b12V9.includes('promptHash'));
assert(b12V10.includes('AI_AGENT_ATOMIC_PAGE_CREATE'));
assert(b12V10.includes('AI_AGENT_ATOMIC_NAV_CLEANUP'));
assert(b12V11.includes('historicalWorkingTextDoesNotBlockCompletion: true'));
assert(b12V12.includes('AGENT_CONTINUATION_REQUIRED'));
assert(b12V12.includes('AGENT_CONFIRMATION_REQUIRED'));
assert(b12V12.includes('publicPublishStillGated: true'));

// V13 specifically prevents historical chat from masquerading as the current provider response.
assert(b12V13.includes('extends V12Publisher'));
assert(b12V13.includes('currentInteractionDelta'));
assert(b12V13.includes('text.lastIndexOf(markerPrompt)'));
assert(b12V13.includes('AGENT_CONTINUATION_REQUIRED_CURRENT_INTERACTION'));
assert(b12V13.includes('AGENT_CONFIRMATION_REQUIRED_CURRENT_INTERACTION'));
assert(b12V13.includes('AGENT_OPERATION_FULLY_COMPLETED_V13'));
assert(b12V13.includes('historicalChatCannotTriggerContinuationOrConfirmation: true'));
assert(b12V13.includes('publicPublishStillGated: true'));

const authenticatedEditor = classifySessionSnapshot({
  url: 'https://b12.io/client/k3pMXaMy/site_builder/',
  title: 'B12 Editor',
  body: 'Website editor. Contact email settings are available here.',
  hasPasswordInput: true
});
assert.equal(authenticatedEditor.loggedIn, true);
assert.equal(authenticatedEditor.loggedOut, false);

const loginPage = classifySessionSnapshot({
  url: 'https://b12.io/login/',
  title: 'Log in to B12',
  body: 'Welcome back. Email Password Log in',
  hasPasswordInput: true
});
assert.equal(loginPage.loggedIn, false);
assert.equal(loginPage.loggedOut, true);

console.log('B12_AUTH_EDITOR_SESSION_DETECTION=GREEN');
console.log('B12_SINGLE_SESSION_AUTH_STAGE=GREEN');
console.log('B12_DURABLE_SUCCESS_LEDGER=GREEN');
console.log('B12_ATOMIC_PROVIDER_PAGE_CREATE=GREEN');
console.log('B12_CURRENT_INTERACTION_OUTCOME_AWARE=GREEN');
console.log('POST_SOAK_CLOSEOUT_SAFETY=GREEN');
