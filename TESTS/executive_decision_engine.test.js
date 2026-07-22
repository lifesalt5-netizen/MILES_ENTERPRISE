const test = require('node:test');
const assert = require('node:assert/strict');

const ExecutiveDecisionEngine = require('../SERVICES/executive/ExecutiveDecisionEngine');
const ExecutiveConfigurationService = require('../SERVICES/executive/ExecutiveConfigurationService');

function createEngine(rootDir = process.cwd()) {
  const configurationService = new ExecutiveConfigurationService({ rootDir });
  return new ExecutiveDecisionEngine({ configurationService });
}

test('scores missions using weighted executive factors', () => {
  const engine = createEngine();
  const mission = {
    title: 'Close qualified deal',
    expectedRevenue: 200,
    urgency: 90,
    customerImpact: 80,
    strategicValue: 70,
    risk: 20,
    executionConfidence: 85
  };

  const result = engine.scoreMission(mission);
  assert.equal(result.title, 'Close qualified deal');
  assert.ok(result.score > 0);
  assert.ok(result.score <= 100);
});

test('ranks missions highest score first', () => {
  const engine = createEngine();
  const ranked = engine.rankMissions([
    { title: 'Low value', expectedRevenue: 10, urgency: 10, customerImpact: 10, strategicValue: 10, risk: 90, executionConfidence: 10 },
    { title: 'High value', expectedRevenue: 200, urgency: 90, customerImpact: 80, strategicValue: 70, risk: 20, executionConfidence: 85 }
  ]);

  assert.equal(ranked[0].title, 'High value');
  assert.equal(ranked[1].title, 'Low value');
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 2);
});

test('handles equal scores deterministically', () => {
  const engine = createEngine();
  const ranked = engine.rankMissions([
    { title: 'Alpha', expectedRevenue: 100, urgency: 50, customerImpact: 50, strategicValue: 50, risk: 50, executionConfidence: 50 },
    { title: 'Beta', expectedRevenue: 100, urgency: 50, customerImpact: 50, strategicValue: 50, risk: 50, executionConfidence: 50 }
  ]);

  assert.equal(ranked[0].score, ranked[1].score);
  assert.ok(['Alpha', 'Beta'].includes(ranked[0].title));
  assert.ok(['Alpha', 'Beta'].includes(ranked[1].title));
});

test('handles missing values safely', () => {
  const engine = createEngine();
  const result = engine.scoreMission({ title: 'Missing fields' });
  assert.equal(result.title, 'Missing fields');
  assert.equal(result.score, 0);
});

test('detects CEO-required missions from configuration policy', () => {
  const engine = createEngine();
  const result = engine.scoreMission({ title: 'Submit final proposal', objective: 'Close deal', provider: 'Sales' });
  assert.equal(result.requiresCEO, true);
});

test('builds an executive agenda', () => {
  const engine = createEngine();
  const agenda = engine.buildExecutiveAgenda({
    missions: [
      { title: 'Close qualified deal', expectedRevenue: 200, urgency: 90, customerImpact: 80, strategicValue: 70, risk: 20, executionConfidence: 85 },
      { title: 'Refresh outbound capacity', expectedRevenue: 50, urgency: 40, customerImpact: 30, strategicValue: 40, risk: 30, executionConfidence: 60 }
    ],
    limit: 1
  });

  assert.ok(agenda.generatedAt);
  assert.ok(agenda.topPriority);
  assert.equal(agenda.topPriority.rank, 1);
  assert.ok(Array.isArray(agenda.agenda));
  assert.ok(Array.isArray(agenda.deferred));
});

test('produces human-readable explanations', () => {
  const engine = createEngine();
  const explanation = engine.explainDecision({ title: 'Close qualified deal', expectedRevenue: 200, urgency: 90, customerImpact: 80, strategicValue: 70, risk: 20, executionConfidence: 85 });
  assert.ok(explanation.includes('score'));
  assert.ok(explanation.includes('because'));
});
