const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ExecutiveMemoryService = require('../SERVICES/executive/ExecutiveMemoryService');

function createTempService() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-exec-memory-'));
  return new ExecutiveMemoryService({ rootDir });
}

test('persists mission results and learning summaries', () => {
  const service = createTempService();

  service.recordMissionResult({ missionId: 'm1', title: 'Proposal follow-up', status: 'COMPLETED', executionTimeMs: 1200, revenueProduced: 3500, revenueProtected: 2000, category: 'PROPOSAL' });
  service.recordMissionResult({ missionId: 'm2', title: 'Proposal follow-up', status: 'FAILED', executionTimeMs: 1800, revenueProduced: 0, revenueProtected: 0, category: 'PROPOSAL' });
  service.recordDecision({ missionId: 'm1', title: 'Proposal follow-up', score: 88, adjustment: 12, explanation: 'Proposal work generated strong value.', requiresCEO: true, overridden: false });
  service.recordOutcome({ type: 'MEETING', detail: 'Meeting booked', value: 1 });
  service.recordOutcome({ type: 'PROPOSAL', detail: 'Proposal won', value: 1 });
  service.recordOutcome({ type: 'DELIVERABILITY', detail: 'Inbox issue', value: 1 });
  service.recordOutcome({ type: 'INFRASTRUCTURE', detail: 'Connector down', value: 1 });

  const history = service.getMissionHistory();
  const learning = service.getLearningSummary();
  const recommendations = service.getRecommendations();

  assert.equal(history.length, 2);
  assert.equal(learning.completedMissions, 1);
  assert.equal(learning.failedMissions, 1);
  assert.ok(learning.repeatedFailures.some((item) => item.name === 'Proposal follow-up'));
  assert.ok(learning.repeatedSuccesses.some((item) => item.name === 'PROPOSAL'));
  assert.ok(recommendations.includes('Proposal work generates highest ROI.'));
  assert.ok(recommendations.includes('Marketing repairs reduce failures.'));
});

test('reloads persisted memory after restart', () => {
  const service = createTempService();
  service.recordMissionResult({ missionId: 'm3', title: 'Follow-up', status: 'COMPLETED', executionTimeMs: 900, revenueProduced: 1000, revenueProtected: 500, category: 'SALES' });

  const reloaded = new ExecutiveMemoryService({ rootDir: service.rootDir });
  const learning = reloaded.getLearningSummary();

  assert.equal(learning.completedMissions, 1);
  assert.equal(reloaded.getMissionHistory().length, 1);
});

test('repairs corrupt memory and preserves a backup', () => {
  const service = createTempService();
  fs.writeFileSync(service.filePath, '{ bad json', 'utf8');

  const repaired = new ExecutiveMemoryService({ rootDir: service.rootDir });
  const learning = repaired.getLearningSummary();
  assert.equal(learning.completedMissions, 0);
  assert.equal(fs.existsSync(service.backupPath), true);
});

test('returns health status based on failure rate', () => {
  const service = createTempService();
  service.recordMissionResult({ missionId: 'm4', title: 'Failing mission', status: 'FAILED', executionTimeMs: 500, revenueProduced: 0, revenueProtected: 0, category: 'GENERAL' });
  assert.equal(service.getHealth(), 'WARN');
});
