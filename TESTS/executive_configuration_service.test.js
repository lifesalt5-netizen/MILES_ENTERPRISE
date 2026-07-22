const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ExecutiveConfigurationService = require('../SERVICES/executive/ExecutiveConfigurationService');

function createTempRoot(files = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miles-exec-config-'));
  const configDir = path.join(rootDir, 'CONFIG');
  fs.mkdirSync(configDir, { recursive: true });

  const defaults = {
    'CEO_GOALS.json': {
      schemaVersion: '1.0.0',
      company: 'Pathways 2 Government Contracting',
      primaryGoal: {
        name: 'Generate sustainable weekly revenue',
        targetAmountUsd: 10000,
        period: 'WEEKLY',
        priorityWeight: 100,
        description: 'Prioritize revenue work.'
      },
      secondaryGoals: [
        { id: 'CLOSE_EXISTING_REVENUE', name: 'Close qualified deals', priorityWeight: 95 }
      ],
      executiveDecisionRules: ['Revenue-first decisioning'],
      dailyExecutiveQuestions: ['What matters most today?']
    },
    'CEO_APPROVAL_RULES.json': {
      schemaVersion: '1.0.0',
      defaultPolicy: 'AUTONOMOUS_WHEN_SAFE_AND_VERIFIABLE',
      autonomousActions: ['Read business data'],
      ceoApprovalRequired: ['Spend money'],
      protectedActionBehavior: {
        prepareWork: true,
        requestApproval: true,
        executeBeforeApproval: false,
        includeRiskExplanation: true,
        includeRollbackPlan: true
      }
    },
    'MISSION_COMPLETION_STANDARDS.json': {
      schemaVersion: '1.0.0',
      standards: {
        GENERAL_MISSION: ['Objective is explicit', 'Output is verified']
      }
    }
  };

  for (const [fileName, data] of Object.entries({ ...defaults, ...files })) {
    if (typeof data === 'string') {
      fs.writeFileSync(path.join(configDir, fileName), data, 'utf8');
    } else {
      fs.writeFileSync(path.join(configDir, fileName), JSON.stringify(data, null, 2), 'utf8');
    }
  }

  return rootDir;
}

test('loads all configuration files successfully', () => {
  const rootDir = createTempRoot();
  const service = new ExecutiveConfigurationService({ rootDir });

  const status = service.getStatus();
  assert.equal(status.status, 'HEALTHY');
  assert.equal(status.healthy, true);
  assert.equal(status.degraded, false);
  assert.deepEqual(service.getGoals().company, 'Pathways 2 Government Contracting');
  assert.equal(service.getApprovalRules().defaultPolicy, 'AUTONOMOUS_WHEN_SAFE_AND_VERIFIABLE');
  assert.deepEqual(service.getCompletionStandards().standards.GENERAL_MISSION, ['Objective is explicit', 'Output is verified']);
});

test('uses safe defaults for invalid JSON', () => {
  const rootDir = createTempRoot({
    'CEO_GOALS.json': '{"schemaVersion": "1.0.0",'
  });
  const service = new ExecutiveConfigurationService({ rootDir });

  const goals = service.getGoals();
  assert.equal(goals.company, 'Unknown Company');
  assert.ok(Array.isArray(goals.secondaryGoals));
  assert.equal(goals.secondaryGoals.length, 0);

  const status = service.getStatus();
  assert.equal(status.status, 'DEGRADED');
  assert.match(status.errors.join('\n'), /CEO_GOALS\.json/);
});

test('uses safe defaults for missing files', () => {
  const rootDir = createTempRoot({
    'CEO_GOALS.json': null,
    'CEO_APPROVAL_RULES.json': null,
    'MISSION_COMPLETION_STANDARDS.json': null
  });
  const service = new ExecutiveConfigurationService({ rootDir });

  const goals = service.getGoals();
  assert.equal(goals.company, 'Unknown Company');
  assert.equal(service.getApprovalRules().defaultPolicy, 'AUTONOMOUS_WHEN_SAFE_AND_VERIFIABLE');
  assert.equal(service.getCompletionStandards().standards.GENERAL_MISSION.length, 0);
});

test('reload updates cached values', () => {
  const rootDir = createTempRoot();
  const service = new ExecutiveConfigurationService({ rootDir });

  const filePath = path.join(rootDir, 'CONFIG', 'CEO_GOALS.json');
  const original = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  original.company = 'Updated Company';
  fs.writeFileSync(filePath, JSON.stringify(original, null, 2), 'utf8');

  service.reload();

  assert.equal(service.getGoals().company, 'Updated Company');
});

test('getExecutivePolicy returns a normalized object', () => {
  const rootDir = createTempRoot();
  const service = new ExecutiveConfigurationService({ rootDir });

  const policy = service.getExecutivePolicy();

  assert.equal(policy.company, 'Pathways 2 Government Contracting');
  assert.equal(policy.primaryGoal.name, 'Generate sustainable weekly revenue');
  assert.ok(Array.isArray(policy.secondaryGoals));
  assert.ok(Array.isArray(policy.executiveDecisionRules));
  assert.ok(Array.isArray(policy.dailyExecutiveQuestions));
  assert.ok(Array.isArray(policy.autonomousActions));
  assert.ok(Array.isArray(policy.ceoApprovalRequired));
  assert.ok(policy.protectedActionBehavior);
  assert.ok(policy.completionStandards);
});

test('returned objects do not mutate the internal cache', () => {
  const rootDir = createTempRoot();
  const service = new ExecutiveConfigurationService({ rootDir });

  const goals = service.getGoals();
  goals.primaryGoal.name = 'Changed by caller';
  goals.secondaryGoals.push({ id: 'ADDED', name: 'Added item', priorityWeight: 1 });

  const freshGoals = service.getGoals();
  assert.equal(freshGoals.primaryGoal.name, 'Generate sustainable weekly revenue');
  assert.equal(freshGoals.secondaryGoals.length, 1);
});
