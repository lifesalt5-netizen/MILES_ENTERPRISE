'use strict';

const assert = require('assert');
const RevenueWeightedCampaignScorecardService = require('../SERVICES/revenue/RevenueWeightedCampaignScorecardService');

const service = new RevenueWeightedCampaignScorecardService({
  rules: {
    minimum_delivered_sample: 100,
    stage_order: [
      'Target','Contacted','Engaged','Qualified','Meeting Set','Meeting Held',
      'Proposal','Negotiation','Won','Lost','Client'
    ]
  }
});

const campaigns = [
  {
    campaignId: 'A',
    campaignName: 'Campaign A',
    family: 'GSA',
    statusLabel: 'ACTIVE',
    sent: 1000,
    bounced: 20,
    replies: 40
  },
  {
    campaignId: 'B',
    campaignName: 'Campaign B',
    family: 'SAM',
    statusLabel: 'ACTIVE',
    sent: 1000,
    bounced: 0,
    replies: 100
  }
];

const crmRecords = [
  { id: '1', campaignId: 'A', stage: 'Qualified', email: 'a1@example.com' },
  { id: '2', campaignId: 'A', stage: 'Meeting Set', email: 'a2@example.com' },
  { id: '3', campaignId: 'A', stage: 'Meeting Held', email: 'a3@example.com' },
  { id: '4', campaignId: 'A', stage: 'Proposal', email: 'a4@example.com' },
  { id: '5', campaignId: 'A', stage: 'Won', email: 'a5@example.com', verifiedRevenueUsd: 5000 },
  { id: '6', campaignId: 'B', stage: 'Qualified', email: 'b1@example.com' },
  { id: '7', campaignId: 'B', stage: 'Qualified', email: 'b2@example.com' },
  { id: '8', campaignId: 'B', stage: 'Meeting Set', email: 'b3@example.com' }
];

const scorecard = service.buildScorecard(campaigns, crmRecords);
assert.equal(scorecard.campaigns.length, 2);
assert.equal(scorecard.campaigns[0].campaignId, 'A');
assert.equal(scorecard.campaigns[0].decisionClass, 'PROVEN_REVENUE');
assert.equal(scorecard.campaigns[0].verifiedRevenueUsd, 5000);
assert.equal(scorecard.campaigns[0].wonCount, 1);
assert.equal(scorecard.campaigns[0].proposalCount, 2);
assert.equal(scorecard.campaigns[0].meetingHeldCount, 3);
assert.equal(scorecard.campaigns[0].meetingBookedCount, 4);
assert.equal(scorecard.campaigns[0].qualifiedReplyCount, 5);
assert.ok(scorecard.campaigns[0].revenuePer1000Delivered > 5000);
assert.equal(scorecard.campaigns[1].decisionClass, 'QUALIFIED_TRACTION');
assert.equal(scorecard.totals.verifiedRevenueUsd, 5000);

const unverifiedRevenue = service.buildScorecard([
  { campaignId: 'C', campaignName: 'Campaign C', sent: 500, bounced: 0, replies: 10 }
], [
  { id: '9', campaignId: 'C', stage: 'Won', email: 'c@example.com', revenue: 9000 }
]);
assert.equal(unverifiedRevenue.campaigns[0].verifiedRevenueUsd, 0);
assert.equal(unverifiedRevenue.campaigns[0].decisionClass, 'WON_REVENUE_UNVERIFIED');
assert.ok(unverifiedRevenue.campaigns[0].evidenceGaps.includes('WON_OR_CLIENT_RECORD_WITHOUT_VERIFIED_REVENUE'));

const verifiedFlagRevenue = service.buildScorecard([
  { campaignId: 'D', campaignName: 'Campaign D', sent: 500, bounced: 0, replies: 10 }
], [
  { id: '10', campaignId: 'D', stage: 'Client', email: 'd@example.com', revenueVerified: true, dealValue: 2500 }
]);
assert.equal(verifiedFlagRevenue.campaigns[0].verifiedRevenueUsd, 2500);
assert.equal(verifiedFlagRevenue.campaigns[0].decisionClass, 'PROVEN_REVENUE');

console.log('RevenueWeightedCampaignScorecardService tests passed');
