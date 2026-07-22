const test = require('node:test');
const assert = require('node:assert/strict');

const ExecutiveContextService = require('../SERVICES/executive/ExecutiveContextService');

function createService(providers = {}) {
  return new ExecutiveContextService({ providers });
}

test('builds a complete executive context object', () => {
  const service = createService({
    revenue: {
      getContext: () => ({ monthlyRevenue: 12000, revenueGoal: 15000, recurringRevenue: 9000, qualifiedPipeline: 50000, proposalsOutstanding: 6 })
    },
    sales: {
      getContext: () => ({ positiveReplies: 2, neutralReplies: 1, meetingsScheduled: 4, followUpsDue: 3 })
    },
    marketing: {
      getContext: () => ({ activeCampaigns: 3, unhealthyCampaigns: 1, deliverabilityStatus: 'healthy', inboxHealth: 'healthy', sendingCapacity: 'available' })
    },
    operations: {
      getContext: () => ({ queuedWork: 4, runningWork: 2, failedWork: 0, blockedWork: 1, approvalQueue: 2 })
    },
    executive: {
      getContext: () => ({ ceoApprovalsRequired: 1, criticalRisks: ['Revenue dip'], executiveAlerts: [{ severity: 'high', message: 'Proposal deadline tomorrow' }] })
    },
    orion: {
      getContext: () => ({ contractorRefreshStatus: 'healthy', buyerRefreshStatus: 'healthy', opportunityFreshness: 'current', ingestionHealth: 'healthy' })
    },
    infrastructure: {
      getContext: () => ({ connectorHealth: 'healthy', runtimeHealth: 'healthy', apiHealth: 'healthy' })
    }
  });

  const context = service.buildContext();

  assert.ok(context.generatedAt);
  assert.equal(context.companyHealth, 'DEGRADED');
  assert.equal(context.revenue.monthlyRevenue, 12000);
  assert.equal(context.sales.positiveReplies, 2);
  assert.equal(context.marketing.deliverabilityStatus, 'healthy');
  assert.equal(context.operations.approvalQueue, 2);
  assert.equal(context.executive.ceoApprovalsRequired, 1);
  assert.equal(context.orion.ingestionHealth, 'healthy');
  assert.equal(context.infrastructure.runtimeHealth, 'healthy');
});

test('handles missing providers without crashing', () => {
  const service = createService({
    revenue: null,
    marketing: {
      getContext: () => ({ deliverabilityStatus: 'healthy' })
    }
  });

  const context = service.buildContext();

  assert.equal(context.revenue.monthlyRevenue, 0);
  assert.equal(context.marketing.deliverabilityStatus, 'healthy');
  assert.equal(service.lastError.serviceName, 'Revenue');
});

test('generates a concise executive summary', () => {
  const service = createService({
    revenue: {
      getContext: () => ({ monthlyRevenue: 12000, revenueGoal: 15000 })
    },
    sales: {
      getContext: () => ({ positiveReplies: 2, meetingsScheduled: 3 })
    },
    marketing: {
      getContext: () => ({ deliverabilityStatus: 'healthy' })
    },
    executive: {
      getContext: () => ({ criticalRisks: [] })
    },
    infrastructure: {
      getContext: () => ({ runtimeHealth: 'healthy' })
    }
  });

  service.buildContext();
  const summary = service.getSummary();

  assert.match(summary, /Revenue below target/);
  assert.match(summary, /2 positive replies/);
  assert.match(summary, /3 meetings/);
  assert.match(summary, /Deliverability healthy/);
  assert.match(summary, /No critical risks reported/);
  assert.match(summary, /No critical infrastructure failures/);
});

test('returns only critical, high, and medium alerts', () => {
  const service = createService({
    executive: {
      getContext: () => ({ executiveAlerts: [{ severity: 'critical', message: 'Critical issue' }, { severity: 'high', message: 'High issue' }, { severity: 'low', message: 'Low issue' }, 'Simple alert' ] })
    },
    infrastructure: {
      getContext: () => ({ runtimeHealth: 'degraded' })
    }
  });

  const alerts = service.buildContext() && service.getExecutiveAlerts();

  assert.equal(alerts.length, 3);
  assert.deepEqual(alerts.map((entry) => entry.severity), ['critical', 'high', 'medium']);
});

test('reports health status from the assembled context', () => {
  const service = createService({
    operations: {
      getContext: () => ({ failedWork: 1 })
    },
    infrastructure: {
      getContext: () => ({ runtimeHealth: 'healthy' })
    }
  });

  const context = service.buildContext();
  assert.equal(context.companyHealth, 'CRITICAL');
});
