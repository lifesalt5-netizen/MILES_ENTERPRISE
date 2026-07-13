'use strict';

const fs = require('fs');
const path = require('path');

class COOBusinessStateEngine {
  constructor(options = {}) {
    this.service = 'COO_BUSINESS_STATE_ENGINE';
    this.version = '1.0.0';
    this.rootDir = options.rootDir || process.cwd();

    this.stateDir = path.join(this.rootDir, 'state');
    this.logsDir = path.join(this.rootDir, 'logs');
    this.executiveDir = path.join(this.rootDir, 'executive_intelligence');
    this.learningDir = path.join(this.rootDir, 'learning');
    this.recoveryDir = path.join(this.rootDir, 'recovery');

    this.businessStateFile = path.join(this.stateDir, 'coo_business_state.json');
    this.approvalQueueFile = path.join(this.stateDir, 'coo_ceo_approval_queue.json');
    this.alertsFile = path.join(this.stateDir, 'coo_executive_alerts.json');
    this.executiveFeedFile = path.join(this.executiveDir, 'coo_business_state_feed.json');
    this.learningFeedFile = path.join(this.learningDir, 'coo_business_state_learning_feed.json');
    this.recoveryFile = path.join(this.recoveryDir, 'coo_business_state_recovery.json');
    this.logFile = path.join(this.logsDir, 'coo_business_state_engine.log');

    this.running = false;

    this.state = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      startedAt: null,
      stoppedAt: null,
      refreshCount: 0,
      lastRefreshAt: null,
      lastError: null,
      generatedAt: new Date().toISOString()
    };

    this.ensureDirectories();
    this.ensureDefaultFiles();
  }

  ensureDirectories() {
    for (const dir of [
      this.stateDir,
      this.logsDir,
      this.executiveDir,
      this.learningDir,
      this.recoveryDir
    ]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  ensureDefaultFiles() {
    if (!fs.existsSync(this.businessStateFile)) {
      this.writeJson(this.businessStateFile, this.buildDefaultBusinessState());
    }

    if (!fs.existsSync(this.approvalQueueFile)) {
      this.writeJson(this.approvalQueueFile, {
        generatedAt: new Date().toISOString(),
        source: this.service,
        approvals: []
      });
    }

    if (!fs.existsSync(this.alertsFile)) {
      this.writeJson(this.alertsFile, {
        generatedAt: new Date().toISOString(),
        source: this.service,
        alerts: []
      });
    }
  }

  buildDefaultBusinessState() {
    return {
      generatedAt: new Date().toISOString(),
      source: this.service,
      company: 'Pathways 2 Government Contracting',
      operatingMode: 'DIGITAL_COO_GUARDED_AUTONOMY',
      businessGoal: {
        revenueTarget30Days: 10000,
        monthlyClientTarget: 5,
        primaryObjective: 'Miles operates P2GC below CEO level and drives revenue execution.'
      },
      authorityModel: {
        milesMayExecute: [
          'Create operational work',
          'Assign work to workers',
          'Monitor runtime health',
          'Monitor campaign operations',
          'Track business state',
          'Generate executive alerts',
          'Prepare CEO approval items',
          'Maintain dashboards and logs',
          'Retry failed operations',
          'Escalate blockers'
        ],
        ceoApprovalRequired: [
          'Change pricing',
          'Send final client proposal',
          'Sign agreements',
          'Hire contractors',
          'Delete production data',
          'Make legal commitments',
          'Make financial commitments'
        ]
      },
      domains: {
        sales: {
          status: 'ACTIVE',
          priority: 1,
          owner: 'Miles',
          objective: 'Increase qualified calls, proposals, and closed revenue.',
          openItems: []
        },
        outbound: {
          status: 'ACTIVE',
          priority: 2,
          owner: 'Miles',
          objective: 'Keep Instantly campaigns supplied, monitored, and corrected.',
          openItems: []
        },
        website: {
          status: 'ACTIVE',
          priority: 3,
          owner: 'Miles',
          objective: 'Maintain conversion path for GovCon Win Probability Review.',
          openItems: []
        },
        linkedin: {
          status: 'ACTIVE',
          priority: 4,
          owner: 'Miles',
          objective: 'Support visibility and relationship development.',
          openItems: []
        },
        orion: {
          status: 'ACTIVE',
          priority: 5,
          owner: 'Miles',
          objective: 'Use intelligence to support targeting and sales execution.',
          openItems: []
        },
        clientDelivery: {
          status: 'ACTIVE',
          priority: 6,
          owner: 'Miles',
          objective: 'Track deliverables, deadlines, and client follow-through.',
          openItems: []
        },
        runtime: {
          status: 'ACTIVE',
          priority: 7,
          owner: 'Miles',
          objective: 'Maintain healthy Digital COO operations.',
          openItems: []
        }
      },
      kpis: {
        revenueBooked30Days: 0,
        monthlyClientsClosed: 0,
        weeklySalesCalls: 0,
        weeklyProposals: 0,
        weeklyPositiveReplies: 0,
        openCEOApprovals: 0,
        openExecutiveAlerts: 0
      }
    };
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

    await this.refreshBusinessState();

    this.log('INFO', 'COO Business State Engine started.');

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

    this.saveRuntimeState();
    this.log('INFO', 'COO Business State Engine stopped.');

    return {
      ok: true,
      service: this.service,
      status: 'STOPPED',
      state: this.getState()
    };
  }

  async refreshBusinessState(input = {}) {
    try {
      const current = this.readJson(this.businessStateFile, this.buildDefaultBusinessState());
      const approvals = this.readJson(this.approvalQueueFile, { approvals: [] });
      const alerts = this.readJson(this.alertsFile, { alerts: [] });

      const updated = {
        ...current,
        generatedAt: new Date().toISOString(),
        source: this.service,
        lastInput: input,
        kpis: {
          ...(current.kpis || {}),
          openCEOApprovals: Array.isArray(approvals.approvals)
            ? approvals.approvals.filter((item) => item.status !== 'CLOSED').length
            : 0,
          openExecutiveAlerts: Array.isArray(alerts.alerts)
            ? alerts.alerts.filter((item) => item.status !== 'CLOSED').length
            : 0
        },
        operationalReadiness: this.calculateOperationalReadiness(current, approvals, alerts)
      };

      this.writeJson(this.businessStateFile, updated);
      this.writeExecutiveFeed(updated);
      this.writeLearningFeed(updated);
      this.writeRecoveryFeed(updated);

      this.state.ok = true;
      this.state.status = this.running ? 'RUNNING' : 'READY';
      this.state.refreshCount += 1;
      this.state.lastRefreshAt = updated.generatedAt;
      this.state.lastError = null;

      this.saveRuntimeState();
      this.log('INFO', 'Business state refreshed.');

      return {
        ok: true,
        service: this.service,
        status: 'BUSINESS_STATE_REFRESHED',
        businessState: updated,
        state: this.getState()
      };
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'REFRESH_FAILED';
      this.state.lastError = error.message;

      this.writeJson(this.recoveryFile, {
        generatedAt: new Date().toISOString(),
        source: this.service,
        status: 'RECOVERY_REQUIRED',
        reason: error.message,
        action: 'Review business state JSON files and restore valid state.'
      });

      this.saveRuntimeState();
      this.log('ERROR', error.message);

      return {
        ok: false,
        service: this.service,
        status: 'REFRESH_FAILED',
        error: error.message,
        state: this.getState()
      };
    }
  }

  calculateOperationalReadiness(current, approvals, alerts) {
    const domains = current.domains || {};
    const domainValues = Object.values(domains);

    const activeDomains = domainValues.filter((domain) => domain.status === 'ACTIVE').length;
    const blockedDomains = domainValues.filter((domain) => domain.status === 'BLOCKED').length;
    const openApprovals = Array.isArray(approvals.approvals)
      ? approvals.approvals.filter((item) => item.status !== 'CLOSED').length
      : 0;
    const openAlerts = Array.isArray(alerts.alerts)
      ? alerts.alerts.filter((item) => item.status !== 'CLOSED').length
      : 0;

    let status = 'READY';

    if (blockedDomains > 0) {
      status = 'DEGRADED';
    }

    if (blockedDomains >= 3) {
      status = 'BLOCKED';
    }

    return {
      status,
      activeDomains,
      blockedDomains,
      openCEOApprovals: openApprovals,
      openExecutiveAlerts: openAlerts,
      canOperate: status !== 'BLOCKED',
      generatedAt: new Date().toISOString()
    };
  }

  getBusinessState() {
    return this.readJson(this.businessStateFile, this.buildDefaultBusinessState());
  }

  addOpenItem(domainName, item = {}) {
    const businessState = this.getBusinessState();
    const domain = businessState.domains && businessState.domains[domainName];

    if (!domain) {
      return {
        ok: false,
        service: this.service,
        status: 'DOMAIN_NOT_FOUND',
        domain: domainName
      };
    }

    const openItem = {
      id: item.id || this.buildId(domainName),
      status: item.status || 'OPEN',
      priority: item.priority || domain.priority || 99,
      title: item.title || 'Untitled operational item',
      description: item.description || '',
      owner: item.owner || 'Miles',
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: item.metadata || {}
    };

    domain.openItems = Array.isArray(domain.openItems) ? domain.openItems : [];
    domain.openItems.push(openItem);

    businessState.generatedAt = new Date().toISOString();
    this.writeJson(this.businessStateFile, businessState);

    return {
      ok: true,
      service: this.service,
      status: 'OPEN_ITEM_ADDED',
      domain: domainName,
      item: openItem
    };
  }

  addCEOApproval(item = {}) {
    const queue = this.readJson(this.approvalQueueFile, { approvals: [] });

    const approval = {
      id: item.id || this.buildId('approval'),
      status: item.status || 'OPEN',
      priority: item.priority || 1,
      title: item.title || 'CEO approval required',
      description: item.description || '',
      reason: item.reason || '',
      requestedBy: item.requestedBy || 'Miles',
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: item.metadata || {}
    };

    queue.approvals = Array.isArray(queue.approvals) ? queue.approvals : [];
    queue.approvals.push(approval);
    queue.generatedAt = new Date().toISOString();

    this.writeJson(this.approvalQueueFile, queue);

    return {
      ok: true,
      service: this.service,
      status: 'CEO_APPROVAL_ADDED',
      approval
    };
  }

  addExecutiveAlert(item = {}) {
    const alertState = this.readJson(this.alertsFile, { alerts: [] });

    const alert = {
      id: item.id || this.buildId('alert'),
      status: item.status || 'OPEN',
      severity: item.severity || 'medium',
      title: item.title || 'Executive alert',
      description: item.description || '',
      createdBy: item.createdBy || 'Miles',
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: item.metadata || {}
    };

    alertState.alerts = Array.isArray(alertState.alerts) ? alertState.alerts : [];
    alertState.alerts.push(alert);
    alertState.generatedAt = new Date().toISOString();

    this.writeJson(this.alertsFile, alertState);

    return {
      ok: true,
      service: this.service,
      status: 'EXECUTIVE_ALERT_ADDED',
      alert
    };
  }

  getRecommendedOperations() {
    const businessState = this.getBusinessState();
    const operations = [];

    for (const [domainName, domain] of Object.entries(businessState.domains || {})) {
      if (domain.status !== 'ACTIVE') continue;

      operations.push({
        id: this.buildId(`business_${domainName}`),
        type: 'COO_BUSINESS_STATE_OPERATION',
        area: domainName,
        priority: domain.priority || 99,
        worker: this.mapDomainToWorker(domainName),
        action: domain.objective || `Review ${domainName} operations.`,
        approvalRequired: false,
        ceoEscalationOnly: true,
        createdAt: new Date().toISOString(),
        metadata: {
          source: this.service,
          domainStatus: domain.status
        }
      });

      const openItems = Array.isArray(domain.openItems) ? domain.openItems : [];
      for (const item of openItems.filter((openItem) => openItem.status !== 'CLOSED')) {
        operations.push({
          id: item.id || this.buildId(`business_${domainName}_item`),
          type: 'COO_BUSINESS_OPEN_ITEM',
          area: domainName,
          priority: item.priority || domain.priority || 99,
          worker: this.mapDomainToWorker(domainName),
          action: item.description || item.title || `Resolve open ${domainName} item.`,
          approvalRequired: false,
          ceoEscalationOnly: true,
          createdAt: new Date().toISOString(),
          metadata: {
            source: this.service,
            openItem: item
          }
        });
      }
    }

    const approvals = this.readJson(this.approvalQueueFile, { approvals: [] });
    for (const approval of (approvals.approvals || []).filter((item) => item.status !== 'CLOSED')) {
      operations.push({
        id: approval.id || this.buildId('approval_operation'),
        type: 'CEO_APPROVAL_OPERATION',
        area: 'ceo_approval',
        priority: approval.priority || 1,
        worker: 'digital_coo',
        action: `Prepare CEO approval package: ${approval.title}`,
        approvalRequired: true,
        ceoEscalationOnly: true,
        createdAt: new Date().toISOString(),
        metadata: {
          source: this.service,
          approval
        }
      });
    }

    return operations.sort((a, b) => Number(a.priority || 99) - Number(b.priority || 99));
  }

  mapDomainToWorker(domainName) {
    const normalized = String(domainName || '').toLowerCase();

    if (normalized === 'outbound') return 'instantly';
    if (normalized === 'website') return 'website';
    if (normalized === 'linkedin') return 'linkedin';
    if (normalized === 'orion') return 'orion';
    if (normalized === 'sales') return 'sales_operations';
    if (normalized === 'clientdelivery') return 'client_operations';
    if (normalized === 'runtime') return 'digital_coo';

    return 'digital_coo';
  }

  writeExecutiveFeed(businessState) {
    this.writeJson(this.executiveFeedFile, {
      generatedAt: new Date().toISOString(),
      source: this.service,
      status: 'BUSINESS_STATE_READY',
      businessGoal: businessState.businessGoal,
      operationalReadiness: businessState.operationalReadiness,
      kpis: businessState.kpis,
      authorityModel: businessState.authorityModel
    });
  }

  writeLearningFeed(businessState) {
    this.writeJson(this.learningFeedFile, {
      generatedAt: new Date().toISOString(),
      source: this.service,
      lessonType: 'BUSINESS_STATE',
      signal: businessState.operationalReadiness,
      lesson: 'Miles should use business state as the operational source of truth before creating COO work.'
    });
  }

  writeRecoveryFeed(businessState) {
    this.writeJson(this.recoveryFile, {
      generatedAt: new Date().toISOString(),
      source: this.service,
      status:
        businessState.operationalReadiness &&
        businessState.operationalReadiness.status === 'BLOCKED'
          ? 'RECOVERY_REQUIRED'
          : 'NO_RECOVERY_REQUIRED',
      readiness: businessState.operationalReadiness
    });
  }

  async healthCheck() {
    const businessStateExists = fs.existsSync(this.businessStateFile);
    const approvalQueueExists = fs.existsSync(this.approvalQueueFile);
    const alertsExists = fs.existsSync(this.alertsFile);

    const ok = businessStateExists && approvalQueueExists && alertsExists && this.state.ok;

    return {
      ok,
      service: this.service,
      version: this.version,
      status: ok ? 'HEALTHY' : 'DEGRADED',
      running: this.running,
      files: {
        businessState: businessStateExists,
        approvalQueue: approvalQueueExists,
        alerts: alertsExists
      },
      state: this.getState(),
      generatedAt: new Date().toISOString()
    };
  }

  getExecutiveSummary() {
    const businessState = this.getBusinessState();

    return {
      ok: true,
      service: this.service,
      status: 'COO_BUSINESS_STATE_SUMMARY_READY',
      businessGoal: businessState.businessGoal || null,
      operationalReadiness: businessState.operationalReadiness || null,
      kpis: businessState.kpis || {},
      recommendedOperationCount: this.getRecommendedOperations().length,
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

  saveRuntimeState() {
    const runtimeStateFile = path.join(this.stateDir, 'coo_business_state_engine_runtime.json');
    this.writeJson(runtimeStateFile, this.getState());
  }

  buildId(prefix) {
    const safePrefix = String(prefix || 'item').replace(/[^a-zA-Z0-9_]/g, '_');
    const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const random = Math.random().toString(36).slice(2, 8);

    return `${safePrefix}_${stamp}_${random}`;
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

module.exports = COOBusinessStateEngine;