'use strict';

const assert = require('assert');
const fs = require('fs');
const ReplyIntelligenceService = require('../SERVICES/revenue/ReplyIntelligenceService');
const sendWindow = require('../SCRIPTS/AuditInstantlySendWindowHistory');

const v13Source = fs.readFileSync('CONNECTORS/WEBSITE_B12/B12_CONTROLLED_PUBLISHER_V13.js', 'utf8');
const ionosSource = fs.readFileSync('SERVICES/revenue/IonosInboxCleanupService.js', 'utf8');
const lifecycleSource = fs.readFileSync('SERVICES/revenue/InstantlyLifecycleReconciler.js', 'utf8');

assert(v13Source.includes('currentInteractionDelta'), 'V13 must isolate current B12 interaction');
assert(v13Source.includes('text.lastIndexOf(markerPrompt)'), 'V13 must anchor provider evidence after the exact current prompt');
assert(v13Source.includes('historicalChatCannotTriggerContinuationOrConfirmation: true'), 'historical B12 chat must not contaminate current operation');
assert(v13Source.includes('AGENT_CONFIRMATION_REQUIRED_CURRENT_INTERACTION'), 'confirmation must be current-interaction scoped');
assert(v13Source.includes('AGENT_CONTINUATION_REQUIRED_CURRENT_INTERACTION'), 'continuation must be current-interaction scoped');

const fixedNow = new Date('2026-08-25T20:00:00Z');
const reply = new ReplyIntelligenceService({ now: () => fixedNow });
const ooo = reply.classify({ subject: 'Out of office', text: 'I will return July 27.', from: 'person@example.com' });
assert.equal(ooo.category, 'OOO');
assert(ooo.followUpAt.startsWith('2026-08-26'), 'stale OOO return date must follow up promptly, not roll into 2027');

assert.equal(sendWindow.isCampaignSentEmail({ ue_type: 1, campaign_id: 'c1' }), true, 'ue_type 1 is campaign-scheduled send');
assert.equal(sendWindow.isCampaignSentEmail({ ue_type: 3, campaign_id: 'c1' }), false, 'ue_type 3 manual/reply send must not create campaign schedule violation');
assert.equal(sendWindow.isCampaignSentEmail({ campaign_id: 'legacy' }), true, 'campaign id is only legacy fallback when ue_type is absent');

assert(ionosSource.includes("return 'MILES-GSA-EBUY'"), 'eBuy notices need dedicated preserved folder');
assert(ionosSource.includes("return 'MILES-FORWARDED'"), 'forwarded MILES noise needs dedicated preserved folder');
assert(ionosSource.includes("return 'MILES-JUNK'"), 'obvious vendor junk needs dedicated preserved folder');
assert(ionosSource.includes('remainingRoutableNoise'), 'IONOS cleanup must verify remaining routable clutter after move');
assert(!/EXPUNGE|\\Deleted/i.test(ionosSource), 'IONOS cleanup must not delete/expunge mail');

assert(lifecycleSource.includes("'P2GC Replies - Positive'"), 'positive reply lifecycle list must be governed');
assert(lifecycleSource.includes("'P2GC Replies - OOO'"), 'OOO reply lifecycle list must be governed');
assert(lifecycleSource.includes("'/leads/move'"), 'replied leads must move out of source campaigns into lifecycle lists');
assert(lifecycleSource.includes('copy_leads: false'), 'reply lifecycle move must remove lead from original campaign');
assert(lifecycleSource.includes('reset_interest_status: false'), 'reply lifecycle move must preserve classified interest state');
assert(lifecycleSource.includes('CANONICAL_CRM_LIFECYCLE'), 'canonical CRM must receive reply lifecycle segment');
assert(!/method:\s*['"]DELETE['"]/i.test(lifecycleSource), 'lifecycle reconciliation must not delete leads or emails');

console.log('GROUPED_REMEDIATION_V2_REGRESSIONS=GREEN');
