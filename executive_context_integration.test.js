const test = require('node:test');
const assert = require('node:assert/strict');

const ExecutiveDecisionEngine = require('./SERVICES/Executive/ExecutiveDecisionEngine');
const ExecutiveConfigurationService = require('./SERVICES/executive/ExecutiveConfigurationService');
const ExecutiveContextService = require('./SERVICES/executive/ExecutiveContextService');

function createEngine(contextOverrides = {}) {
  const configurationService = new ExecutiveConfigurationService({ rootDir: process.cwd() });
  const contextService = new ExecutiveContextService({
    rootDir: process.cwd(),
    providers: contextOverrides.providers || {}
  });

  return new ExecutiveDecisionEngine({ configurationService, contextService });
}

test('revenue context changes sales and proposal scores', () => {
  const engine = createEngine({
    providers: {
      revenue: { getContext: () => ({ monthlyRevenue: 12000, revenueGoal: 15000 }) },
      sales: { getContext: () => ({ positiveReplies: 2 }) }
    }
  });

  const result = engine.scoreMission({ title: 'Follow up on qualified proposal', objective: 'Close a deal', expectedRevenue: 80, urgency: 70, customerImpact: 60, strategicValue: 60, risk: 20, executionConfidence: 80 });

  assert.ok(result.score > 0);
  assert.ok(result.contextAdjustment >= 12);
  assert.match(result.reason, /Revenue is below monthly goal/);
});

test('proposal urgency increases the score further', () => {
  const engine = createEngine({
    providers: {
      revenue: { getContext: () => ({ monthlyRevenue: 15000, revenueGoal: 15000 }) },
      sales: { getContext: () => ({ positiveReplies: 1 }) },
      executive: { getContext: () => ({ ceoApprovalsRequired: 1 }) }
    }
  });

  const result = engine.scoreMission({ title: 'Submit proposal deadline tomorrow', objective: 'Submit final proposal', expectedRevenue: 90, urgency: 75, customerImpact: 70, strategicValue: 65, risk: 20, executionConfidence: 80 });

  assert.ok(result.contextAdjustment >= 18);
  assert.match(result.reason, /CEO review required/);
});

test('marketing health changes scores for campaign work', () => {
  const engine = createEngine({
    providers: {
      marketing: { getContext: () => ({ deliverabilityStatus: 'unhealthy', unhealthyCampaigns: 2 }) }
    }
  });

  const result = engine.scoreMission({ title: 'Repair campaign mailbox health', objective: 'Restore marketing outreach', expectedRevenue: 40, urgency: 50, customerImpact: 50, strategicValue: 55, risk: 20, executionConfidence: 70 });

  assert.ok(result.contextAdjustment >= 10);
  assert.match(result.reason, /Deliverability is unhealthy/);
});

test('infrastructure failures change scores', () => {
  const engine = createEngine({
    providers: {
      infrastructure: { getContext: () => ({ runtimeHealth: 'degraded' }) }
    }
  });

  const result = engine.scoreMission({ title: 'Recover connector runtime', objective: 'Restore infrastructure health', expectedRevenue: 50, urgency: 40, customerImpact: 50, strategicValue: 40, risk: 20, executionConfidence: 60 });

  assert.ok(result.contextAdjustment >= 12);
  assert.match(result.reason, /Infrastructure health is degraded/);
});

test('no context still works', () => {
  const engine = createEngine({ providers: {} });
  const result = engine.scoreMission({ title: 'Routine maintenance', objective: 'Keep systems stable', expectedRevenue: 10, urgency: 20, customerImpact: 15, strategicValue: 10, risk: 10, executionConfidence: 60 });

  assert.equal(result.contextAdjustment, 0);
  assert.equal(result.score >= 0, true);
});
