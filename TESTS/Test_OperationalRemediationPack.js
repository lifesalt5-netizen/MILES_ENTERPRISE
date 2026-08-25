'use strict';

const fs = require('fs');
const assert = require('assert');

function read(file) { return fs.readFileSync(file, 'utf8'); }

const v12 = read('CONNECTORS/WEBSITE_B12/B12_CONTROLLED_PUBLISHER_V12.js');
const auth = read('CONNECTORS/WEBSITE_B12/B12_AUTH_AND_STAGE_SINGLE_SESSION.js');
const ionos = read('CONNECTORS/IONOS/imap_governed.js');
const ionosCleanup = read('SERVICES/revenue/IonosInboxCleanupService.js');
const instantly = read('SERVICES/revenue/InstantlyLifecycleReconciler.js');
const runner = read('RUN_OPERATIONAL_REMEDIATION_ALL.js');
const ps = read('SCRIPTS/RunOperationalRemediationAll.ps1');

assert(auth.includes("B12_CONTROLLED_PUBLISHER_V12"), 'single-session B12 runner must use V12');
assert(v12.includes('AGENT_CONTINUATION_REQUIRED'), 'V12 must detect continuation requests');
assert(v12.includes('AGENT_CONFIRMATION_REQUIRED'), 'V12 must detect confirmation requests');
assert(v12.includes('marketingCopyCannotTriggerWorkingState: true'), 'V12 must guard against marketing copy being treated as provider work');
assert(!v12.includes('making changes|generating|updating your site'), 'V12 must not use the old broad generating regex');
assert(v12.includes("P2GC_B12_PUBLISH"), 'B12 publisher must retain explicit publish gate');

assert(ionos.includes('UID MOVE'), 'IONOS cleanup must use UID MOVE');
assert(!/EXPUNGE/i.test(ionos), 'IONOS cleanup must not expunge');
assert(!/\\Deleted/i.test(ionos), 'IONOS cleanup must not mark messages deleted');
assert(ionosCleanup.includes('preservesActionableHumanRepliesInInbox: true'), 'actionable replies must remain in IONOS inbox');

assert(instantly.includes('/leads/update-interest-status'), 'Instantly lifecycle must reconcile CRM interest status');
assert(instantly.includes('/mark-as-read'), 'Instantly lifecycle must clear non-actionable unread threads');
assert(instantly.includes('reminder_ts'), 'OOO/not-now lifecycle must create reminders');
assert(instantly.includes('GlobalSuppressionService'), 'hard suppressions must enter global suppression');
assert(!/method:\s*['"]DELETE['"]/i.test(instantly), 'Instantly lifecycle must not delete emails or leads');

assert(runner.includes('FULL_RELATED_SYSTEM_SWEEP_BEFORE_CLOSEOUT'), 'combined runner must encode grouped remediation rule');
assert(ps.includes("$env:P2GC_B12_PUBLISH = 'false'"), 'combined remediation must keep B12 public publish disabled');
assert(ps.includes('RunPostSoakMasterAudit.ps1'), 'combined remediation must end with master sweep');

console.log('OPERATIONAL_REMEDIATION_PACK_STATIC_SAFETY=GREEN');
