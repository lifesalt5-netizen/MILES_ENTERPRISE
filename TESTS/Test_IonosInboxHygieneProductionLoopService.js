'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const IonosInboxHygieneProductionLoopService = require('../SERVICES/revenue/IonosInboxHygieneProductionLoopService');
const { safeFolderFor } = IonosInboxHygieneProductionLoopService;
const cleanupHelpers = require('../SERVICES/revenue/IonosInboxCleanupService').helpers;
const governedModule = require('../CONNECTORS/IONOS/imap_governed');
const { CATEGORIES } = require('../SERVICES/revenue/ReplyIntelligenceService');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'SERVICES', 'revenue', 'IonosInboxHygieneProductionLoopService.js'), 'utf8');
const autonomous = fs.readFileSync(path.join(root, 'StartAutonomousCOO.js'), 'utf8');
const governed = fs.readFileSync(path.join(root, 'CONNECTORS', 'IONOS', 'imap_governed.js'), 'utf8');

assert(source.includes("MILES_IONOS_HYGIENE_ENABLED, true"));
assert(source.includes("MILES_IONOS_HYGIENE_EXECUTE, true"));
assert(source.includes("setInterval(() => this.runOnce().catch(() => {}), this.intervalMs)"));
assert(source.includes('remainingHighConfidenceRoutableNoise'));
assert(source.includes('uncertainMailRemainsInbox: true'));
assert(source.includes('usesUidMoveOnly: true'));
assert(source.includes('deletesMessages: false'));
assert(source.includes("scopedAuthorization: 'IONOS_HYGIENE_UID_MOVE_ONLY'"));
assert(source.includes('moveUidsForHygiene'));
assert(source.includes('knownColdOutreachMarker'));
assert(source.includes('globalWriteGatesNotRequired: true'));
assert(source.includes('rehearsalModeBlocksScopedMoves: true'));
assert(source.includes('autonomousExecuteFalseBlocksScopedMoves: true'));
assert(!/EXPUNGE|\\Deleted/i.test(source));
assert(governed.includes('UID MOVE'));
assert(governed.includes('hygieneMutationAllowed'));
assert(governed.includes('IONOS_HYGIENE_UID_MOVE_ONLY'));
assert(governed.includes("MILES_REHEARSAL_MODE"));
assert(governed.includes("MILES_AUTONOMOUS_EXECUTE"));
assert(!/EXPUNGE/i.test(governed));
assert(autonomous.includes('IonosInboxHygieneProductionLoopService'));
assert(autonomous.includes('ionosInboxHygiene.start()'));
assert(autonomous.includes('ionosInboxHygiene.stop()'));
assert(autonomous.includes('ionosInboxHygiene.runOnce()'));

const envKeys = [
  'MILES_REHEARSAL_MODE',
  'MILES_AUTONOMOUS_EXECUTE',
  'MILES_IONOS_HYGIENE_ENABLED',
  'MILES_IONOS_HYGIENE_EXECUTE'
];
const priorEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
try {
  process.env.MILES_REHEARSAL_MODE = 'false';
  process.env.MILES_AUTONOMOUS_EXECUTE = 'true';
  process.env.MILES_IONOS_HYGIENE_ENABLED = 'true';
  process.env.MILES_IONOS_HYGIENE_EXECUTE = 'true';
  assert.strictEqual(governedModule.hygieneMutationAllowed(), true, 'production hygiene scope should authorize UID moves');

  process.env.MILES_REHEARSAL_MODE = 'true';
  assert.strictEqual(governedModule.hygieneMutationAllowed(), false, 'rehearsal must block scoped moves');

  process.env.MILES_REHEARSAL_MODE = 'false';
  process.env.MILES_AUTONOMOUS_EXECUTE = 'false';
  assert.strictEqual(governedModule.hygieneMutationAllowed(), false, 'autonomous execute=false must block scoped moves');

  process.env.MILES_AUTONOMOUS_EXECUTE = 'true';
  process.env.MILES_IONOS_HYGIENE_EXECUTE = 'false';
  assert.strictEqual(governedModule.hygieneMutationAllowed(), false, 'IONOS hygiene execute=false must block scoped moves');
} finally {
  for (const key of envKeys) {
    if (priorEnv[key] === undefined) delete process.env[key];
    else process.env[key] = priorEnv[key];
  }
}

const clients = new Set(['client@example.com']);
assert.strictEqual(safeFolderFor(
  { category: CATEGORIES.BOUNCE_TECHNICAL, humanReply: false },
  { from: 'Mail Delivery Subsystem <mailer-daemon@example.com>', subject: 'Mail delivery failed: returning message to sender' },
  clients
), 'MILES-BOUNCE');
assert.strictEqual(cleanupHelpers.folderFor(
  { category: CATEGORIES.BOUNCE_TECHNICAL, humanReply: false },
  { from: 'Mail Delivery Subsystem <mailer-daemon@example.com>', subject: 'Mail delivery failed: returning message to sender' },
  clients
), 'MILES-BOUNCE', 'canonical routing must preserve the dedicated bounce lifecycle folder');
assert.strictEqual(safeFolderFor(
  { category: CATEGORIES.AUTO_REPLY, humanReply: false },
  { from: 'employee@example.com', subject: 'Automatic reply: out of office' },
  clients
), 'MILES-AUTO');
assert.strictEqual(safeFolderFor(
  { category: CATEGORIES.UNSUBSCRIBE, humanReply: true },
  { from: 'prospect@example.com', subject: 'Please remove me from your list' },
  clients
), 'MILES-CLOSED');
assert.strictEqual(safeFolderFor(
  { category: CATEGORIES.UNKNOWN, humanReply: true },
  { from: 'Vendor <vendor@example.net>', subject: 'Kevin - do you need more leads? | 3A11CND Q913TWE', inReplyTo: '<thread@example.com>' },
  clients
), 'MILES-JUNK', 'known campaign marker must outrank generic reply-thread evidence');
assert.strictEqual(safeFolderFor(
  { category: CATEGORIES.UNKNOWN, humanReply: true },
  { from: 'Unknown Human <human@example.net>', subject: 'Question about your services' },
  clients
), null, 'uncertain human mail must fail closed by remaining in Inbox');
assert.strictEqual(safeFolderFor(
  { category: CATEGORIES.MEETING_INTENT, humanReply: true },
  { from: 'Client <client@example.com>', subject: 'Can we meet tomorrow?' },
  clients
), null, 'active client mail must remain in Inbox');

const fake = new IonosInboxHygieneProductionLoopService({
  enabled: true,
  execute: false,
  intervalMs: 1000,
  connector: { mailboxConfigs: () => [] }
});
fake.runOnce = async () => ({ ok: true, status: 'PLAN_ONLY' });
const started = fake.start();
assert.strictEqual(started.status, 'STARTED');
assert.strictEqual(started.executionEnabled, false);
fake.stop();
assert.strictEqual(fake.timer, null);

console.log('IONOS_INBOX_HYGIENE_PRODUCTION_LOOP=PASS');
