'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Service = require('../SERVICES/revenue/P2GCFederalGrowthReviewLifecycleService');

const contract = require('../CONFIG/P2GC_FEDERAL_GROWTH_REVIEW_PRODUCT_CONTRACT.json');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2gc-fgr-'));
const svc = new Service({ stateDir: dir, contract });

const review = svc.createReview({
  company: { name: 'TEST FEDERAL CO', uei: 'TESTUEI123456', domain: 'testfederal.example' },
  recipient: { email: 'owner@testfederal.example', name: 'Owner' }
});

assert.strictEqual(review.green, false);
assert.strictEqual(review.security.downloadable, false);
assert.strictEqual(review.security.noIndex, true);
assert.strictEqual(review.expirationHours, 72);
assert.strictEqual(svc.authorizeAccess(review.reviewId, { email: 'owner@testfederal.example' }).ok, true);
assert.strictEqual(svc.authorizeAccess(review.reviewId, { email: 'colleague@testfederal.example' }).reason, 'SAME_COMPANY_AUTHORIZATION_REQUIRED');
assert.strictEqual(svc.authorizeAccess(review.reviewId, { email: 'outside@example.net' }).reason, 'OUTSIDE_ORGANIZATION_ACCESS_DENIED');

assert.throws(() => svc.addFinding(review.reviewId, {
  title: 'Unverified material finding',
  finding: 'No source metadata.'
}), /MATERIAL_FINDING_SOURCE_REQUIRED/);

svc.addFinding(review.reviewId, {
  title: 'Vehicle position',
  finding: 'One current vehicle is confirmed.',
  whatItMeans: 'The company has an existing access path.',
  whyItMatters: 'Existing access should be evaluated before new vehicle investment.',
  businessImpact: 'Avoids unnecessary vehicle spend.',
  howP2GCAddressesIt: 'Validate utilization and buyer-path fit.',
  source: 'AUTHORITATIVE_TEST_SOURCE',
  freshness: 'CURRENT',
  confidence: 'HIGH',
  verificationState: 'CONFIRMED'
});

let state = svc.updateFitScore(review.reviewId, 80, ['ORION_VERIFIED_COMPANY_INTELLIGENCE']);
assert.strictEqual(state.scoring.fitScore, 80);
assert.strictEqual(state.scoring.intentScore, 0);
assert.strictEqual(state.scoring.salesPriority, 44);

state = svc.recordEngagement(review.reviewId, 'DELIVERY');
state = svc.recordEngagement(review.reviewId, 'AUTHENTICATED_REVIEW_ACCESS');
state = svc.recordEngagement(review.reviewId, 'VIDEO_START');
assert.strictEqual(state.stageState.PLAYBACK_TRACKING.status, 'COMPLETE');
assert.strictEqual(state.stageState.PLAYBACK_TRACKING.evidence.source, 'P2GC_PROSPECT_ENGAGEMENT');
state = svc.recordEngagement(review.reviewId, 'VIDEO_75');
assert.ok(state.scoring.intentScore > 0);
assert.strictEqual(state.scoring.fitScore, 80, 'engagement must not overwrite FIT score');
assert.ok(state.scoring.salesPriority > 44);

state = svc.recordEngagement(review.reviewId, 'QUESTION_SUBMITTED', { metadata: { question: 'What should we address first?' } });
assert.strictEqual(state.stageState.QUESTION_CAPTURE.status, 'COMPLETE');
assert.strictEqual(state.engagementSummary.questionCount, 1);

state = svc.recordEngagement(review.reviewId, 'SCHEDULING_OPENED');
assert.strictEqual(state.stageState.SCHEDULING.status, 'COMPLETE');
assert.strictEqual(state.engagementSummary.schedulingOpenedCount, 1);

assert.throws(() => svc.markSent(review.reviewId, {
  sentFrom: 'other@pathways2gc.com', secureLinkId: 'link-1'
}), /KEVIN_APPROVAL_REQUIRED_BEFORE_SEND/);

svc.approveRelease(review.reviewId, 'KEVIN');
assert.throws(() => svc.markSent(review.reviewId, {
  sentFrom: 'other@pathways2gc.com', secureLinkId: 'link-1'
}), /HIGH_VALUE_REVIEW_MUST_SEND_FROM_KEVIN_PATHWAYS2GC/);

svc.markSent(review.reviewId, {
  sentFrom: 'kevin@pathways2gc.com', secureLinkId: 'link-1'
});

for (const stage of contract.greenDefinition.requiredStages) {
  if (['KEVIN_APPROVAL', 'SECURE_SEND_FROM_KEVIN', 'PLAYBACK_TRACKING', 'QUESTION_CAPTURE', 'SCHEDULING'].includes(stage)) continue;
  svc.completeStage(review.reviewId, stage, {
    source: 'TEST', freshness: 'CURRENT', confidence: 'HIGH', verificationState: 'CONFIRMED'
  });
}

const gate = svc.getGreenGate(review.reviewId);
assert.strictEqual(gate.ok, true);
assert.strictEqual(gate.status, 'P2GC_PERSONALIZED_REVIEW_END_TO_END_GREEN');
assert.deepStrictEqual(gate.missingStages, []);

console.log('P2GC_FEDERAL_GROWTH_REVIEW_LIFECYCLE_TEST_GREEN');
