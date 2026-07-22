'use strict';

const fs = require('fs');
const path = require('path');

class ExecutiveConfigurationService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd();
    this.configDir = path.join(this.rootDir, 'CONFIG');
    this.cache = {
      goals: null,
      approvalRules: null,
      completionStandards: null,
      policy: null,
      status: null
    };
    this.errors = [];
    this.reload();
  }

  getGoals() {
    return this.clone(this.cache.goals);
  }

  getApprovalRules() {
    return this.clone(this.cache.approvalRules);
  }

  getCompletionStandards() {
    return this.clone(this.cache.completionStandards);
  }

  getExecutivePolicy() {
    return this.clone(this.cache.policy);
  }

  getStatus() {
    if (!this.cache.status) {
      this.cache.status = this.buildStatus();
    }

    return this.clone(this.cache.status);
  }

  reload() {
    this.errors = [];

    this.cache.goals = this.loadGoals();
    this.cache.approvalRules = this.loadApprovalRules();
    this.cache.completionStandards = this.loadCompletionStandards();
    this.cache.policy = this.buildPolicy();
    this.cache.status = this.buildStatus();

    return this.cache.status;
  }

  loadGoals() {
    const data = this.loadJsonFile('CEO_GOALS.json', this.getDefaultGoals());
    if (data.ok) {
      return this.normalizeGoals(data.value);
    }

    this.errors.push(data.error);
    return this.normalizeGoals(this.getDefaultGoals());
  }

  loadApprovalRules() {
    const data = this.loadJsonFile('CEO_APPROVAL_RULES.json', this.getDefaultApprovalRules());
    if (data.ok) {
      return this.normalizeApprovalRules(data.value);
    }

    this.errors.push(data.error);
    return this.normalizeApprovalRules(this.getDefaultApprovalRules());
  }

  loadCompletionStandards() {
    const data = this.loadJsonFile('MISSION_COMPLETION_STANDARDS.json', this.getDefaultCompletionStandards());
    if (data.ok) {
      return this.normalizeCompletionStandards(data.value);
    }

    this.errors.push(data.error);
    return this.normalizeCompletionStandards(this.getDefaultCompletionStandards());
  }

  loadJsonFile(fileName, fallback) {
    const filePath = path.join(this.configDir, fileName);

    if (!fs.existsSync(filePath)) {
      return {
        ok: false,
        error: `Configuration file missing: ${fileName}`
      };
    }

    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      return {
        ok: false,
        error: `Unable to read configuration file ${fileName}: ${error.message}`
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        error: `Invalid JSON in configuration file ${fileName}: ${error.message}`
      };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        error: `Configuration file ${fileName} must contain a JSON object.`
      };
    }

    if (!parsed.schemaVersion) {
      return {
        ok: false,
        error: `Configuration file ${fileName} is missing schemaVersion.`
      };
    }

    if (fileName === 'CEO_GOALS.json' && !parsed.company) {
      return {
        ok: false,
        error: `Configuration file ${fileName} is missing required field: company.`
      };
    }

    if (fileName === 'CEO_APPROVAL_RULES.json' && !parsed.defaultPolicy) {
      return {
        ok: false,
        error: `Configuration file ${fileName} is missing required field: defaultPolicy.`
      };
    }

    if (fileName === 'MISSION_COMPLETION_STANDARDS.json' && !parsed.standards) {
      return {
        ok: false,
        error: `Configuration file ${fileName} is missing required field: standards.`
      };
    }

    return {
      ok: true,
      value: parsed
    };
  }

  normalizeGoals(raw) {
    const safe = this.getDefaultGoals();
    const parsed = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

    safe.schemaVersion = parsed.schemaVersion || safe.schemaVersion;
    safe.company = parsed.company || 'Unknown Company';
    safe.operatingSystem = parsed.operatingSystem || safe.operatingSystem;
    safe.primaryGoal = this.normalizeGoal(parsed.primaryGoal);
    safe.secondaryGoals = Array.isArray(parsed.secondaryGoals)
      ? parsed.secondaryGoals.map((goal) => ({
          id: String(goal && goal.id || ''),
          name: String(goal && goal.name || ''),
          priorityWeight: Number(goal && goal.priorityWeight) || 0
        })).filter((goal) => goal.id || goal.name)
      : [];
    safe.executiveDecisionRules = Array.isArray(parsed.executiveDecisionRules)
      ? parsed.executiveDecisionRules.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
      : [];
    safe.dailyExecutiveQuestions = Array.isArray(parsed.dailyExecutiveQuestions)
      ? parsed.dailyExecutiveQuestions.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
      : [];

    return safe;
  }

  normalizeGoal(raw) {
    const parsed = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      name: String(parsed.name || 'Primary goal not defined'),
      targetAmountUsd: Number(parsed.targetAmountUsd) || 0,
      period: String(parsed.period || 'UNKNOWN'),
      priorityWeight: Number(parsed.priorityWeight) || 0,
      description: String(parsed.description || '')
    };
  }

  normalizeApprovalRules(raw) {
    const safe = this.getDefaultApprovalRules();
    const parsed = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

    safe.schemaVersion = parsed.schemaVersion || safe.schemaVersion;
    safe.defaultPolicy = String(parsed.defaultPolicy || safe.defaultPolicy);
    safe.autonomousActions = Array.isArray(parsed.autonomousActions)
      ? parsed.autonomousActions.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
      : [];
    safe.ceoApprovalRequired = Array.isArray(parsed.ceoApprovalRequired)
      ? parsed.ceoApprovalRequired.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
      : [];
    safe.protectedActionBehavior = this.normalizeProtectedActionBehavior(parsed.protectedActionBehavior);

    return safe;
  }

  normalizeProtectedActionBehavior(raw) {
    const parsed = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      prepareWork: Boolean(parsed.prepareWork),
      requestApproval: Boolean(parsed.requestApproval),
      executeBeforeApproval: Boolean(parsed.executeBeforeApproval),
      includeRiskExplanation: Boolean(parsed.includeRiskExplanation),
      includeRollbackPlan: Boolean(parsed.includeRollbackPlan)
    };
  }

  normalizeCompletionStandards(raw) {
    const safe = this.getDefaultCompletionStandards();
    const parsed = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

    safe.schemaVersion = parsed.schemaVersion || safe.schemaVersion;
    safe.standards = { GENERAL_MISSION: [] };

    if (parsed.standards && typeof parsed.standards === 'object' && !Array.isArray(parsed.standards)) {
      for (const [name, items] of Object.entries(parsed.standards)) {
        if (Array.isArray(items)) {
          safe.standards[name] = items.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
        }
      }
    }

    return safe;
  }

  buildPolicy() {
    return {
      company: this.cache.goals.company,
      primaryGoal: this.cache.goals.primaryGoal,
      secondaryGoals: this.cache.goals.secondaryGoals,
      executiveDecisionRules: this.cache.goals.executiveDecisionRules,
      dailyExecutiveQuestions: this.cache.goals.dailyExecutiveQuestions,
      autonomousActions: this.cache.approvalRules.autonomousActions,
      ceoApprovalRequired: this.cache.approvalRules.ceoApprovalRequired,
      protectedActionBehavior: this.cache.approvalRules.protectedActionBehavior,
      completionStandards: this.cache.completionStandards.standards
    };
  }

  buildStatus() {
    const healthy = this.errors.length === 0;
    return {
      ok: healthy,
      healthy,
      degraded: !healthy,
      status: healthy ? 'HEALTHY' : 'DEGRADED',
      configDir: this.configDir,
      loadedFiles: {
        goals: Boolean(this.cache.goals),
        approvalRules: Boolean(this.cache.approvalRules),
        completionStandards: Boolean(this.cache.completionStandards)
      },
      errors: this.errors.slice()
    };
  }

  clone(value) {
    if (value === null || value === undefined) {
      return value;
    }

    return JSON.parse(JSON.stringify(value));
  }

  getDefaultGoals() {
    return {
      schemaVersion: '1.0.0',
      company: 'Unknown Company',
      operatingSystem: 'MILES Enterprise',
      primaryGoal: {
        name: 'Primary goal not defined',
        targetAmountUsd: 0,
        period: 'UNKNOWN',
        priorityWeight: 0,
        description: ''
      },
      secondaryGoals: [],
      executiveDecisionRules: [],
      dailyExecutiveQuestions: []
    };
  }

  getDefaultApprovalRules() {
    return {
      schemaVersion: '1.0.0',
      defaultPolicy: 'AUTONOMOUS_WHEN_SAFE_AND_VERIFIABLE',
      autonomousActions: [],
      ceoApprovalRequired: [],
      protectedActionBehavior: {
        prepareWork: true,
        requestApproval: true,
        executeBeforeApproval: false,
        includeRiskExplanation: true,
        includeRollbackPlan: true
      }
    };
  }

  getDefaultCompletionStandards() {
    return {
      schemaVersion: '1.0.0',
      standards: {}
    };
  }
}

module.exports = ExecutiveConfigurationService;
