'use strict';

const fs = require('fs');
const path = require('path');

class COOGoalEngine {
  constructor(options = {}) {
    this.service = 'COO_GOAL_ENGINE';
    this.version = '1.0.0';
    this.rootDir = options.rootDir || process.cwd();

    this.stateDir = path.join(this.rootDir, 'state');
    this.executiveDir = path.join(this.rootDir, 'executive_intelligence');
    this.logsDir = path.join(this.rootDir, 'logs');

    this.goalFile = path.join(this.stateDir, 'coo_goals.json');
    this.kpiFile = path.join(this.stateDir, 'coo_kpis.json');
    this.priorityFile = path.join(this.stateDir, 'coo_priorities.json');
    this.executiveFeedFile = path.join(this.executiveDir, 'coo_goal_engine_feed.json');
    this.logFile = path.join(this.logsDir, 'coo_goal_engine.log');

    this.running = false;

    this.state = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      startedAt: null,
      stoppedAt: null,
      lastEvaluationAt: null,
      evaluationCount: 0,
      lastError: null,
      generatedAt: new Date().toISOString()
    };

    this.ensureDirectories();
    this.ensureDefaultFiles();
  }

  ensureDirectories() {
    for (const dir of [this.stateDir, this.executiveDir, this.logsDir]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  ensureDefaultFiles() {
    if (!fs.existsSync(this.goalFile)) {
      this.writeJson(this.goalFile, {
        generatedAt: new Date().toISOString(),
        source: this.service,
        company: 'Pathways 2 Government Contracting',
        operatingGoal: 'Operate P2GC as Digital COO and drive revenue execution.',
        activeGoals: [
          {
            id: 'REVENUE_10000_30_DAYS',
            name: 'Generate $10,000 in sales in 30 days',
            owner: 'Miles',
            priority: 1,
            status: 'ACTIVE',
            category: 'revenue',
            successCriteria: [
              'Book qualified sales calls',
              'Move prospects to proposal',
              'Follow up on warm opportunities',
              'Support Kevin with only CEO-level approvals'
            ]
          },
          {
            id: 'FIVE_NEW_CLIENTS_MONTHLY',
            name: 'Acquire 5 new clients per month',
            owner: 'Miles',
            priority: 2,
            status: 'ACTIVE',
            category: 'sales',
            successCriteria: [
              'Maintain outreach execution',
              'Track replies',
              'Route positive responses',
              'Prepare call and proposal support'
            ]
          },
          {
            id: 'COO_AUTONOMY',
            name: 'Reduce Kevin as operational bottleneck',
            owner: 'Miles',
            priority: 3,
            status: 'ACTIVE',
            category: 'operations',
            successCriteria: [
              'Create and assign operational work',
              'Monitor worker completion',
              'Escalate CEO-only decisions',
              'Maintain operational state'
            ]
          }
        ],
        ceoOnlyDecisions: [
          'Change pricing',
          'Send final client proposal',
          'Sign agreements',
          'Hire contractors',
          'Delete production data',
          'Make legal or financial commitments'
        ]
      });
    }

    if (!fs.existsSync(this.kpiFile)) {
      this.writeJson(this.kpiFile, {
        generatedAt: new Date().toISOString(),
        source: this.service,
        kpis: {
          revenueTarget30Days: 10000,
          monthlyClientTarget: 5,
          salesCallsTargetWeekly: 10,
          proposalsTargetWeekly: 5,
          positiveRepliesTargetWeekly: 20,
          operationalEscalationTarget: 'CEO-only decisions only'
        }
      });
    }

    if (!fs.existsSync(this.priorityFile)) {
      this.writeJson(this.priorityFile, {
        generatedAt: new Date().toISOString(),
        source: this.service,
        priorities: [
          {
            rank: 1,
            area: 'sales',
            action: 'Increase qualified calls and proposal opportunities'
          },
          {
            rank: 2,
            area: 'outbound',
            action: 'Keep Instantly campaigns supplied, monitored, and corrected'
          },
          {
            rank: 3,
            area: 'website',
            action: 'Maintain conversion path for GovCon Win Probability Review'
          },
          {
            rank: 4,
            area: 'orion',
            action: 'Use ORION intelligence to support targeting and sales execution'
          },
          {
            rank: 5,
            area: 'operations',
            action: 'Coordinate workers, connectors, recovery, and executive reporting'
          }
        ]
      });
    }
  }

  async start() {
    if (this.running) {
      return {
        ok: true,
        service: this.service,
        status: 'ALREADY_RUNNING',
        state: this.getState()
      };
    }

    this.running = true;
    this.state.ok = true;
    this.state.status = 'RUNNING';
    this.state.startedAt = new Date().toISOString();
    this.state.stoppedAt = null;
    this.state.lastError = null;

    this.log('INFO', 'COO Goal Engine started.');

    return {
      ok: true,
      service: this.service,
      status: 'STARTED',
      state: this.getState()
    };
  }

  async stop() {
    this.running = false;
    this.state.status = 'STOPPED';
    this.state.stoppedAt = new Date().toISOString();

    this.log('INFO', 'COO Goal Engine stopped.');

    return {
      ok: true,
      service: this.service,
      status: 'STOPPED',
      state: this.getState()
    };
  }

  async healthCheck() {
    const files = {
      goals: fs.existsSync(this.goalFile),
      kpis: fs.existsSync(this.kpiFile),
      priorities: fs.existsSync(this.priorityFile)
    };

    const ok = files.goals && files.kpis && files.priorities;

    return {
      ok,
      service: this.service,
      version: this.version,
      status: ok ? 'HEALTHY' : 'DEGRADED',
      running: this.running,
      files,
      state: this.getState(),
      generatedAt: new Date().toISOString()
    };
  }

  async evaluateGoals(context = {}) {
    try {
      const goals = this.readJson(this.goalFile, {});
      const kpis = this.readJson(this.kpiFile, {});
      const priorities = this.readJson(this.priorityFile, { priorities: [] });

      const evaluation = {
        ok: true,
        service: this.service,
        status: 'GOALS_EVALUATED',
        generatedAt: new Date().toISOString(),
        operatingGoal: goals.operatingGoal || null,
        activeGoals: goals.activeGoals || [],
        kpis: kpis.kpis || {},
        priorities: priorities.priorities || [],
        ceoOnlyDecisions: goals.ceoOnlyDecisions || [],
        recommendedOperations: this.buildRecommendedOperations(goals, priorities, context),
        context
      };

      this.state.lastEvaluationAt = evaluation.generatedAt;
      this.state.evaluationCount += 1;
      this.state.status = this.running ? 'RUNNING' : this.state.status;
      this.state.lastError = null;

      this.writeJson(this.executiveFeedFile, evaluation);
      this.log('INFO', 'Goals evaluated and executive feed updated.');

      return evaluation;
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'EVALUATION_FAILED';
      this.state.lastError = error.message;

      this.log('ERROR', error.message);

      return {
        ok: false,
        service: this.service,
        status: 'EVALUATION_FAILED',
        error: error.message,
        generatedAt: new Date().toISOString()
      };
    }
  }

  buildRecommendedOperations(goals, priorities, context) {
    const activeGoals = Array.isArray(goals.activeGoals) ? goals.activeGoals : [];
    const priorityList = Array.isArray(priorities.priorities) ? priorities.priorities : [];

    const operations = [];

    for (const goal of activeGoals) {
      if (goal.status !== 'ACTIVE') continue;

      if (goal.category === 'revenue' || goal.category === 'sales') {
        operations.push({
          id: this.buildOperationId('sales', goal.id),
          type: 'COO_OPERATION',
          area: 'sales',
          priority: goal.priority || 1,
          goalId: goal.id,
          worker: 'sales_operations',
          action: 'Review active prospects, replies, booked calls, proposal opportunities, and required Kevin approvals.',
          approvalRequired: false,
          ceoEscalationOnly: true,
          createdAt: new Date().toISOString()
        });
      }

      if (goal.category === 'operations') {
        operations.push({
          id: this.buildOperationId('operations', goal.id),
          type: 'COO_OPERATION',
          area: 'operations',
          priority: goal.priority || 3,
          goalId: goal.id,
          worker: 'digital_coo',
          action: 'Review runtime health, worker status, connector status, recovery plan, and incomplete operations.',
          approvalRequired: false,
          ceoEscalationOnly: true,
          createdAt: new Date().toISOString()
        });
      }
    }

    for (const priority of priorityList) {
      operations.push({
        id: this.buildOperationId(priority.area || 'priority', String(priority.rank || '0')),
        type: 'COO_PRIORITY_OPERATION',
        area: priority.area || 'general',
        priority: priority.rank || 99,
        worker: this.mapAreaToWorker(priority.area),
        action: priority.action,
        approvalRequired: false,
        ceoEscalationOnly: true,
        createdAt: new Date().toISOString()
      });
    }

    if (context && context.runtimeHealth && context.runtimeHealth.ok === false) {
      operations.unshift({
        id: this.buildOperationId('recovery', 'runtime_health'),
        type: 'COO_RECOVERY_OPERATION',
        area: 'recovery',
        priority: 0,
        worker: 'digital_coo',
        action: 'Runtime health is degraded. Review health report, recovery plan, and restart or quarantine failed components if allowed.',
        approvalRequired: false,
        ceoEscalationOnly: true,
        createdAt: new Date().toISOString()
      });
    }

    return operations.sort((a, b) => Number(a.priority || 99) - Number(b.priority || 99));
  }

  mapAreaToWorker(area) {
    const normalized = String(area || '').toLowerCase();

    if (normalized === 'outbound') return 'instantly';
    if (normalized === 'website') return 'website';
    if (normalized === 'linkedin') return 'linkedin';
    if (normalized === 'orion') return 'orion';
    if (normalized === 'sales') return 'sales_operations';
    if (normalized === 'operations') return 'digital_coo';

    return 'digital_coo';
  }

  buildOperationId(prefix, seed) {
    const safePrefix = String(prefix || 'operation').replace(/[^a-zA-Z0-9_]/g, '_');
    const safeSeed = String(seed || 'goal').replace(/[^a-zA-Z0-9_]/g, '_');
    const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);

    return `${safePrefix}_${safeSeed}_${stamp}`;
  }

  getExecutiveSummary() {
    const goals = this.readJson(this.goalFile, {});
    const kpis = this.readJson(this.kpiFile, {});
    const priorities = this.readJson(this.priorityFile, { priorities: [] });

    return {
      ok: true,
      service: this.service,
      status: 'COO_GOAL_SUMMARY_READY',
      operatingGoal: goals.operatingGoal || null,
      activeGoalCount: Array.isArray(goals.activeGoals) ? goals.activeGoals.length : 0,
      kpis: kpis.kpis || {},
      priorities: priorities.priorities || [],
      state: this.getState(),
      generatedAt: new Date().toISOString()
    };
  }

  getState() {
    return {
      ...this.state,
      running: this.running,
      generatedAt: new Date().toISOString()
    };
  }

  readJson(filePath, fallback) {
    try {
      if (!fs.existsSync(filePath)) return fallback;
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      return fallback;
    }
  }

  writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  log(level, message) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message
    };

    fs.appendFileSync(this.logFile, `${JSON.stringify(entry)}\n`, 'utf8');
  }
}

module.exports = COOGoalEngine;