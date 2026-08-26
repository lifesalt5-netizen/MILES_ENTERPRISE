'use strict';

const assert = require('assert');
const fs = require('fs');
const V13 = require('../CONNECTORS/WEBSITE_B12/B12_CONTROLLED_PUBLISHER_V13');
const ReplyIntelligenceService = require('../SERVICES/revenue/ReplyIntelligenceService');
const IonosCleanup = require('../SERVICES/revenue/IonosInboxCleanupService');
const sendWindow = require('../SCRIPTS/AuditInstantlySendWindowHistory');
const InstantlyLifecycle = require('../SERVICES/revenue/InstantlyLifecycleReconciler');

const { currentInteractionDelta, hasContinuationRequest, hasConfirmationRequest } = V13.helpersV13;
const prompt = "On the existing 'GSA Zero-Sales Diagnostic' page only, add the conversion copy.";
const historical = "Would you like me to continue adding old Federal content?\nPlease click the button below\nOld action";
const body = `${historical}\n${prompt}\nThinking`;
const delta = currentInteractionDelta(body, historical, prompt);
assert.equal(delta.trim(), 'Thinking', 'V13 must isolate current B12 interaction after current prompt');
assert.equal(hasContinuationRequest(delta), false, 'historical continuation must not contaminate current B12 operation');
assert.equal(hasConfirmationRequest(delta), false, 'historical confirmation must not contaminate current B12 operation');

const fixedNow = new Date('2026-08-25T20:00:00Z');
const reply = new ReplyIntelligenceService({ now: () => fixedNow });
const ooo = reply.classify({ subject: 'Out of office', text: 'I will return July 27.', from: 'person@example.com' });
assert.equal(ooo.category, 'OOO');
assert(ooo.followUpAt.startsWith('2026-08-26'), 'stale OOO return date must follow up promptly, not roll into 2027');

assert.equal(sendWindow.isCampaignSentEmail({ ue_type: 1, campaign_id: 'c1' }), true, 'ue_type 1 is campaign-scheduled send');
assert.equal(sendWindow.isCampaignSentEmail({ ue_type: 3, campaign_id: 'c1' }), false, 'ue_type 3 manual/reply send must not create campaign schedule violation');
assert.equal(sendWindow.isCampaignSentEmail({ campaign_id: 'legacy' }), true, 'campaign id is only legacy fallback when ue_type is absent');

assert.equal(IonosCleanup.helpers.ebuyNotice({ from: 'ebuy_admin@gsa.gov', subject: 'GSA eBuy Requests and Quotes/Bids' }), true);
assert.equal(IonosCleanup.helpers.folderFor({ category: 'UNKNOWN' }, { from: 'ebuy_admin@gsa.gov', subject: 'GSA eBuy Requests and Quotes/Bids' }), 'MILES-GSA-EBUY');
assert.equal(IonosCleanup.helpers.folderFor({ category: 'UNKNOWN' }, { from: 'K C <lifesalt5@gmail.com>', subject: '[MILES UNKNOWN] Fwd: Your IONOS Invoice' }), 'MILES-FORWARDED');
assert.equal(IonosCleanup.helpers.folderFor({ category: 'UNKNOWN' }, { from: 'vendor@example.com', subject: 'Business Funding Application Q913TWE' }), 'MILES-JUNK');

assert.equal(InstantlyLifecycle.helpers.lifecycleListName('POSITIVE_ACTION_REQUIRED'), 'P2GC Replies - Positive');
assert.equal(InstantlyLifecycle.helpers.lifecycleListName('OOO_FOLLOWUP'), 'P2GC Replies - OOO');
const lifecycleSource = fs.readFileSync('SERVICES/revenue/InstantlyLifecycleReconciler.js', 'utf8');
assert(lifecycleSource.includes("'/leads/move'"), 'replied leads must move out of source campaigns into lifecycle lists');
assert(lifecycleSource.includes('copy_leads: false'), 'reply lifecycle move must remove lead from original campaign');
assert(lifecycleSource.includes('reset_interest_status: false'), 'reply lifecycle move must preserve classified interest state');
assert(lifecycleSource.includes('CANONICAL_CRM_LIFECYCLE'), 'canonical CRM must receive reply lifecycle segment');
assert(!/method:\s*['"]DELETE['"]/i.test(lifecycleSource), 'lifecycle reconciliation must not delete leads or emails');

console.log('GROUPED_REMEDIATION_V2_REGRESSIONS=GREEN');
