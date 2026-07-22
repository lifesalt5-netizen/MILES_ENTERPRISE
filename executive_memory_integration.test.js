const test = require('node:test');
const assert = require('node:assert/strict');

const ExecutiveDecisionEngine = require('./SERVICES/Executive/ExecutiveDecisionEngine');
const ExecutiveConfigurationService = require('./SERVICES/executive/ExecutiveConfigurationService');
const ExecutiveContextService = require('./SERVICES/executive/ExecutiveContextService');
const ExecutiveMemoryService = require('./SERVICES/executive/ExecutiveMemoryService');

function createEngine(memoryService) {
  const configurationService = new ExecutiveConfigurationService({ rootDir: process.cwd() });
  const contextService = new ExecutiveContextService({ rootDir: process.cwd(), providers: {} });
  return new ExecutiveDecisionEngine({ configurationService, contextService, memoryService });
}

test('successful history raises score', () => {
  const memoryService = new ExecutiveMemoryService({ rootDir: process.cwd() });
  memoryService.recordMissionResult({ missionId: 'm1', title: 'Proposal follow-up', status: 'COMPLETED', category: 'PROPOSAL', revenueProduced: 1500, revenueProtected: 500 });
  memoryService.recordMissionResult({ missionId: 'm2', title: 'Proposal follow-up', status: 'COMPLETED', category: 'PROPOSAL', revenueProduced: 2000, revenueProtected: 600 });

  const engine = createEngine(memoryService);
  const result = engine.scoreMission({ title: 'Proposal follow-up', objective: 'Close a deal', expectedRevenue: 80, urgency: 70, customerImpact: 60, strategicValue: 50, risk: 20, executionConfidence: 80, metadata: { category: 'PROPOSAL' } });

  assert.ok(result.memoryAdjustment > 0);
  assert.ok(result.score > 0);
  assert.match(result.reason, /Memory added/);
});

test('failure history lowers score', () => {
  const memoryService = new ExecutiveMemoryService({ rootDir: process.cwd() });
  memoryService.recordMissionResult({ missionId: 'm3', title: 'Infrastructure repair', status: 'FAILED', category: 'INFRASTRUCTURE', executionTimeMs: 4000 });
  memoryService.recordMissionResult({ missionId: 'm4', title: 'Infrastructure repair', status: 'FAILED', category: 'INFRASTRUCTURE', executionTimeMs: 5000 });

  const engine = createEngine(memoryService);
  const result = engine.scoreMission({ title: 'Infrastructure repair', objective: 'Restore connectivity', expectedRevenue: 50, urgency: 50, customerImpact: 55, strategicValue: 40, risk: 20, executionConfidence: 60, metadata: { category: 'INFRASTRUCTURE' } });

  assert.ok(result.memoryAdjustment < 0);
  assert.match(result.reason, /Memory added/);
});

test('CEO override history affects routing', () => {
  const memoryService = new ExecutiveMemoryService({ rootDir: process.cwd() });
  memoryService.recordDecision({ missionId: 'm5', title: 'Proposal follow-up', score: 90, adjustment: 10, explanation: 'Proposal work generated more value.', requiresCEO: true, overridden: true });

  const engine = createEngine(memoryService);
  const result = engine.scoreMission({ title: 'Proposal follow-up', objective: 'Submit final proposal', expectedRevenue: 70, urgency: 80, customerImpact: 70, strategicValue: 60, risk: 20, executionConfidence: 75 });

  assert.ok(result.memoryAdjustment > 0);
  assert.ok(result.requiresCEO);
});

test('no memory still works', () => {
  const engine = createEngine(null);
  const result = engine.scoreMission({ title: 'Routine maintenance', objective: 'Keep systems stable', expectedRevenue: 10, urgency: 20, customerImpact: 15, strategicValue: 10, risk: 10, executionConfidence: 60 });

  assert.equal(result.memoryAdjustment, 0);
  assert.equal(result.score >= 0, true);
});

test('corrupt memory is handled safely', () => {
  const memoryService = new ExecutiveMemoryService({ rootDir: process.cwd() });
  memoryService.filePath = `${process.cwd()}/DATA/executive_memory/corrupt.json`;
  memoryService.storageDir = `${process.cwd()}/DATA/executive_memory`;
  require('fs').writeFileSync(memoryService.filePath, '{ bad json', 'utf8');

  const engine = createEngine(memoryService);
  const result = engine.scoreMission({ title: 'Routine maintenance', objective: 'Keep systems stable', expectedRevenue: 10, urgency: 20, customerImpact: 15, strategicValue: 10, risk: 10, executionConfidence: 60 });

  assert.equal(result.memoryAdjustment, 0);
  assert.equal(result.score >= 0, true);
});
