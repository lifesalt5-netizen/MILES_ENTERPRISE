'use strict';

const fs = require('fs');
const assert = require('assert');

function read(file) { return fs.readFileSync(file, 'utf8'); }

const v13 = read('CONNECTORS/WEBSITE_B12/B12_CONTROLLED_PUBLISHER_V13.js');
const auth = read('CONNECTORS/WEBSITE_B12/B12_AUTH_AND_STAGE_SINGLE_SESSION.js');
const ionos = read('CONNECTORS/IONOS/imap_governed.js');
const ionosCleanup = read('SERVICES/revenue/IonosInboxCleanupService.js');
const ionosAllFolder = read('SERVICES/revenue/IonosAllFolderReconciliationService.js');
const ionosRemoteRunner = read('SCRIPTS/RunIonosInboxCleanup.js');
const instantly = read('SERVICES/revenue/InstantlyLifecycleReconciler.js');
const reply = read('SERVICES/revenue/ReplyIntelligenceService.js');
const sendWindow = read('SCRIPTS/AuditInstantlySendWindowHistory.js');
const runner = read('RUN_OPERATIONAL_REMEDIATION_ALL.js');
const ps = read('SCRIPTS/RunOperationalRemediationAll.ps1');

assert(auth.includes("B12_CONTROLLED_PUBLISHER_V13"), 'single-session B12 runner must use V13');
assert(v13.includes('currentInteractionDelta'), 'V13 must isolate current provider interaction');
assert(v13.includes('historicalChatCannotTriggerContinuationOrConfirmation: true'), 'V13 must block historical chat false positives');
assert(v13.includes('AGENT_CONTINUATION_REQUIRED_CURRENT_INTERACTION'), 'V13 continuation detection must be current-interaction scoped');
assert(v13.includes('AGENT_CONFIRMATION_REQUIRED_CURRENT_INTERACTION'), 'V13 confirmation detection must be current-interaction scoped');
assert(v13.includes('publicPublishStillGated: true'), 'V13 must preserve public publish gate');

assert(ionos.includes('UID MOVE'), 'IONOS cleanup must use UID MOVE');
assert(!/EXPUNGE/i.test(ionos), 'IONOS cleanup must not expunge');
assert(!/\\Deleted/i.test(ionos), 'IONOS cleanup must not mark messages deleted');
assert(ionosCleanup.includes('MILES-GSA-EBUY'), 'eBuy notices must leave working inbox for dedicated folder');
assert(ionosCleanup.includes('MILES-FORWARDED'), 'forwarded MILES noise must leave working inbox for preserved folder');
assert(ionosCleanup.includes('MILES-JUNK'), 'obvious vendor junk must leave working inbox for preserved folder');
assert(ionosCleanup.includes('remainingRoutableNoise'), 'IONOS cleanup must verify user-visible inbox result after moves');
assert(ionosCleanup.includes('inboxReservedForActiveClientsAndRealSentThreadReplies: true'), 'IONOS inbox must be reserved for active clients and real sent-thread replies');
assert(ionosCleanup.includes('strongAutomationHeadersOverrideReplyThreadHeuristic: true'), 'bulk/automation headers must outrank generic reply-thread heuristics');
assert(ionosCleanup.includes('genericPositiveLanguageDoesNotKeepInbox: true'), 'generic positive wording must not be sufficient to keep IONOS inbox mail');
assert(ionosAllFolder.includes('executableMisroutesAfter'), 'all-folder IONOS reconciliation must post-verify executable misroutes');
assert(ionosAllFolder.includes('usesUidMoveOnly: true'), 'all-folder IONOS reconciliation must use UID MOVE only');
assert(ionosRemoteRunner.includes('IonosAllFolderReconciliationService'), 'governed IONOS remote lane must use all-folder reconciliation');
assert(ionosRemoteRunner.includes("process.argv.includes('--execute')"), 'governed IONOS remote lane must preserve plan/execute separation');

assert(instantly.includes('/leads/update-interest-status'), 'Instantly lifecycle must reconcile CRM interest status');
assert(instantly.includes('/mark-as-read'), 'Instantly lifecycle must clear non-actionable unread threads');
assert(instantly.includes('reminder_ts'), 'OOO/not-now lifecycle must create reminders');
assert(instantly.includes('GlobalSuppressionService'), 'hard suppressions must enter global suppression');
assert(instantly.includes("'/leads/move'"), 'replied leads must move into response lifecycle lists');
assert(instantly.includes('copy_leads: false'), 'replied leads must leave original campaign after lifecycle routing');
assert(instantly.includes('CANONICAL_CRM_LIFECYCLE'), 'canonical CRM must receive lifecycle segment');
assert(!/method:\s*['"]DELETE['"]/i.test(instantly), 'Instantly lifecycle must not delete emails or leads');

assert(reply.includes('Historical OOO mail must never be rolled into the next calendar year'), 'stale OOO dates must not create next-year reminders');
assert(sendWindow.includes('ueType === 1'), 'send-window audit must judge only ue_type=1 campaign sends when type is present');
assert(sendWindow.includes('manualOrReplySentIgnored'), 'manual/reply sends must be reported but excluded from campaign schedule violations');

assert(runner.includes('FULL_RELATED_SYSTEM_SWEEP_BEFORE_CLOSEOUT'), 'combined runner must encode grouped remediation rule');
assert(ps.includes("$env:P2GC_B12_PUBLISH = 'false'"), 'combined remediation must keep B12 public publish disabled');
assert(ps.includes('RunPostSoakMasterAudit.ps1'), 'combined remediation must end with master sweep');

// Execute the behavioral executive-inbox regression as part of the CI gate,
// not merely syntax-check it. This catches false-positive Inbox retention before merge.
require('./ionos_inbox_cleanup_control.test.js');

console.log('OPERATIONAL_REMEDIATION_PACK_STATIC_SAFETY=GREEN');
