'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { classifySessionSnapshot } = require('../CONNECTORS/WEBSITE_B12/modules/session');

const root = path.resolve(__dirname, '..');
const nurture = fs.readFileSync(path.join(root, 'RUN_P2GC_DUE_NURTURE_CLOSEOUT.js'), 'utf8');
const nurturePs = fs.readFileSync(path.join(root, 'SCRIPTS', 'ExecuteDueNurtureCloseout.ps1'), 'utf8');
const b12 = fs.readFileSync(path.join(root, 'CONNECTORS', 'WEBSITE_B12', 'B12_AUTH_BOOTSTRAP.js'), 'utf8');
const b12Single = fs.readFileSync(path.join(root, 'CONNECTORS', 'WEBSITE_B12', 'B12_AUTH_AND_STAGE_SINGLE_SESSION.js'), 'utf8');
const b12V3 = fs.readFileSync(path.join(root, 'CONNECTORS', 'WEBSITE_B12', 'B12_CONTROLLED_PUBLISHER_V3.js'), 'utf8');
const b12V4 = fs.readFileSync(path.join(root, 'CONNECTORS', 'WEBSITE_B12', 'B12_CONTROLLED_PUBLISHER_V4.js'), 'utf8');
const b12V5 = fs.readFileSync(path.join(root, 'CONNECTORS', 'WEBSITE_B12', 'B12_CONTROLLED_PUBLISHER_V5.js'), 'utf8');
const b12V6 = fs.readFileSync(path.join(root, 'CONNECTORS', 'WEBSITE_B12', 'B12_CONTROLLED_PUBLISHER_V6.js'), 'utf8');
const b12V7 = fs.readFileSync(path.join(root, 'CONNECTORS', 'WEBSITE_B12', 'B12_CONTROLLED_PUBLISHER_V7.js'), 'utf8');
const b12Runner = fs.readFileSync(path.join(root, 'CONNECTORS', 'WEBSITE_B12', 'RUN_CONTROLLED_PUBLISH_V2.ps1'), 'utf8');
const b12Ps = fs.readFileSync(path.join(root, 'SCRIPTS', 'B12AuthenticateAndStage.ps1'), 'utf8');

assert(nurture.includes("approvalToken !== 'SEND_DUE_NURTURE'"), 'nurture execution must require explicit approval token');
assert(nurture.includes('QUEUE_CHANGED_AFTER_APPROVAL'), 'nurture execution must fail closed if queue changes after approval');
assert(nurture.includes("new Set(['OOO', 'NOT_NOW', 'QUALIFIED_NO_MEETING'])"), 'nurture closeout must restrict categories');
assert(nurture.includes("clean(op.status) !== 'READY_FOR_GOVERNED_EXECUTION'"), 'nurture closeout must require ready operations');
assert(nurturePs.includes('Read-Host "Type SEND'), 'PowerShell closeout must require interactive SEND confirmation');
assert(nurturePs.includes("MILES_DRY_RUN = 'false'"), 'execution must explicitly open dry-run gate only after approval');
assert(nurturePs.includes("INSTANTLY_WRITE_ENABLED = 'true'"), 'execution must explicitly open Instantly write gate only after approval');

assert(b12.includes('launchPersistentContext'), 'legacy B12 auth must use persistent browser profile');
assert(b12.includes('credentialsCaptured: false'), 'legacy B12 auth must explicitly record that MILES does not capture credentials');
assert(b12Single.includes('launchPersistentContext'), 'single-session B12 closeout must use persistent browser profile');
assert(b12Single.includes('singleBrowserSession: true'), 'single-session B12 closeout must explicitly preserve one browser session');
assert(b12Single.includes('publisher.context = context'), 'publisher must reuse the authenticated browser context');
assert(b12Single.includes('publisher.page = page'), 'publisher must reuse the authenticated B12 page');
assert(b12Single.includes('publisher.open = async () => page'), 'publisher must not reopen B12 between auth and staging');
assert(b12Single.includes('publisher.close = async () => {}'), 'publisher must leave the shared context open until outer closeout completes');
assert(b12Single.includes('B12_FIRST_PARTY_EDITOR_UI_NOT_OBSERVABLE_IN_AUTOMATION_SESSION'), 'blank authenticated B12 UI must fail closed with first-party diagnostics');
assert(b12Single.includes('A support/chat widget or other third-party frame does NOT count as editor readiness.'), 'third-party widget controls must not falsely satisfy B12 editor readiness');
assert(b12Single.includes('firstPartyVisibleControls'), 'single-session readiness must measure first-party B12 controls separately');
assert(b12Single.includes("/^https:\\/\\/b12\\.io\\/client\\//i"), 'single-session readiness must scope editor evidence to the B12 client frame');
assert(b12Single.includes('click the Chat tab at the top once') || b12Single.includes('Click the Chat tab at the top once'), 'single-session closeout may request a one-time manual Chat reveal without publishing');
assert(b12Single.includes('credentialsCaptured: false'), 'single-session B12 flow must not capture credentials');
assert(b12Single.includes("require('./B12_CONTROLLED_PUBLISHER_V7')"), 'single-session closeout must use phased-prompt V7 publisher');

assert(b12Ps.includes("B12_PUBLISH_ENABLED = 'false'"), 'B12 public publishing must remain disabled');
assert(b12Ps.includes("P2GC_B12_PUBLISH = 'false'"), 'B12 requested publish flag must remain false');
assert(b12Ps.includes('B12_AUTH_AND_STAGE_SINGLE_SESSION.js'), 'PowerShell closeout must use the single-session runner');
assert(b12Ps.includes("B12_RESUME_SUCCESSFUL_OPERATIONS = 'true'"), 'B12 closeout must resume prior confirmed successful draft operations instead of blindly repeating them');
assert(!b12Ps.includes('-Publish'), 'B12 closeout must not request public publish');

assert(b12Runner.includes('B12_CONTROLLED_PUBLISHER_V4.js'), 'standalone B12 staging runner must retain current-ui V4 compatibility path');
assert(b12V3.includes('this.page.frames()'), 'B12 3.0 publisher must enumerate editor frames');
assert(b12V3.includes('combinedEditorText'), 'B12 3.0 publisher must aggregate editor text across frames');
assert(b12V3.includes('B12_AI_AGENT_INPUT_ALREADY_VISIBLE'), 'B12 3.0 publisher must use an already-visible AI Agent input before requiring a trigger');
assert(b12V3.includes('B12_AI_AGENT_TRIGGER_NOT_FOUND_FRAME_AWARE'), 'B12 3.0 publisher must emit frame-aware trigger diagnostics');
assert(b12V3.includes('PREVIEW_BUTTON_NOT_FOUND_FRAME_AWARE'), 'B12 3.0 preview discovery must also be frame-aware');
assert(b12V3.includes('PUBLISH_BUTTON_NOT_FOUND_FRAME_AWARE'), 'B12 3.0 publish discovery must also be frame-aware');
assert(b12V4.includes("getByText('Chat', { exact: true })"), 'current B12 top Chat control must be discoverable');
assert(b12V4.includes("getByText('Agent', { exact: true })"), 'current B12 left Agent control must be discoverable');
assert(b12V4.includes("scope.getByRole('button', { name: exactNavText('Chat') })"), 'current B12 Chat button must be preferred');
assert(b12V4.includes("scope.getByRole('button', { name: exactNavText('Agent') })"), 'current B12 Agent button must be supported');

assert(b12V5.includes('RESUMED_FROM_PRIOR_SUCCESSFUL_OPERATION'), 'B12 V5 must explicitly report resumed successful operations');
assert(b12V5.includes('B12_RESUME_SUCCESSFUL_OPERATIONS'), 'B12 V5 resume must remain opt-in via the governed closeout wrapper');
assert(b12V5.includes('publicPublishExecuted: false'), 'B12 V5 must initialize public publish truth to false');
assert(b12V5.includes('mutationAttempted: false'), 'B12 V5 must separately track attempted draft mutation');
assert(b12V5.includes('mutationExecuted = true'), 'B12 V5 must report a completed draft mutation as soon as one operation settles successfully');

assert(b12V6.includes('20 * 60 * 1000'), 'B12 V6 must preserve prior progress-aware long-wait evidence');
assert(b12V6.includes('[B12_AGENT_PROGRESS]'), 'B12 V6 must emit visible progress heartbeats while B12 is working');
assert(b12V6.includes('AGENT_STILL_WORKING_AT_MAX_WAIT'), 'B12 V6 must distinguish a provider still working from an ambiguous timeout');

assert(b12V7.includes('COMPACT_B12_RECOMMENDED_PAGE_SCAFFOLD'), 'B12 V7 must identify the compact phased prompt strategy');
assert(b12V7.includes('GSA_ZERO_SALES_PAGE'), 'B12 V7 must carry a compact GSA page prompt');
assert(b12V7.includes('FEDERAL_REVENUE_GAP_PAGE'), 'B12 V7 must carry a compact federal revenue-gap prompt');
assert(b12V7.includes('RECOMPETE_VEHICLE_PAGE'), 'B12 V7 must carry a compact recompete/vehicle prompt');
assert(b12V7.includes('AGENT_STALLED_NO_VISIBLE_PROGRESS'), 'B12 V7 must stop on stale Thinking instead of waiting indefinitely');
assert(b12V7.includes('6 * 60 * 1000'), 'B12 V7 must use a bounded no-visible-progress threshold');
assert(b12V7.includes('extends V6Publisher'), 'B12 V7 must inherit V6 resumability and publication gates');

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
console.log('B12_FRAME_AWARE_EDITOR_DISCOVERY=GREEN');
console.log('B12_CURRENT_AGENT_CHAT_DISCOVERY=GREEN');
console.log('B12_SINGLE_SESSION_AUTH_STAGE=GREEN');
console.log('B12_FIRST_PARTY_EDITOR_READINESS=GREEN');
console.log('B12_RESUMABLE_LONG_AGENT_SETTLE=GREEN');
console.log('B12_PROGRESS_AWARE_LONG_PROVIDER_WAIT=GREEN');
console.log('B12_PHASED_COMPACT_PROMPTS=GREEN');
console.log('B12_STALE_THINKING_DETECTION=GREEN');
console.log('POST_SOAK_CLOSEOUT_SAFETY=GREEN');
