'use strict';

const fs = require('fs');
const path = require('path');

const BaseCOOWorker = require('./BaseCOOWorker');

class NamecheapCOOWorker extends BaseCOOWorker {
  constructor(options = {}) {
    super({
      ...options,
      workerId: options.workerId || 'NAMECHEAP_COO_WORKER',
      workerName: options.workerName || 'Namecheap COO Worker',
      workerType: options.workerType || 'NAMECHEAP_COO',
      domain: options.domain || 'NAMECHEAP',
      description:
        options.description ||
        'Autonomous COO worker for Namecheap domain inventory, DNS operations, mailbox planning, domain health, and connector-based execution.'
    });

    this.service = 'NAMECHEAP_COO_WORKER';
    this.version = '1.0.0';

    this.namecheapConnectorId = options.namecheapConnectorId || 'namecheap';

    this.namecheapRuntimeDir =
      options.namecheapRuntimeDir ||
      path.join(this.runtimeDir, 'namecheap_coo');

    this.namecheapStatePath =
      options.namecheapStatePath ||
      path.join(this.namecheapRuntimeDir, 'namecheap_state.json');

    this.domainRegistryPath =
      options.domainRegistryPath ||
      path.join(this.namecheapRuntimeDir, 'domain_registry.json');

    this.dnsRecordRegistryPath =
      options.dnsRecordRegistryPath ||
      path.join(this.namecheapRuntimeDir, 'dns_record_registry.json');

    this.domainActionQueuePath =
      options.domainActionQueuePath ||
      path.join(this.namecheapRuntimeDir, 'domain_action_queue.json');

    this.namecheapExecutionLogPath =
      options.namecheapExecutionLogPath ||
      path.join(this.namecheapRuntimeDir, 'namecheap_execution_log.jsonl');

    this.namecheapReportPath =
      options.namecheapReportPath ||
      path.join(this.namecheapRuntimeDir, 'namecheap_report.json');

    this.approvalRequiredActions = Array.from(
      new Set([
        ...this.approvalRequiredActions,
        'PURCHASE_DOMAIN',
        'TRANSFER_DOMAIN',
        'DELETE_DNS_RECORD',
        'CHANGE_NAMESERVERS',
        'CHANGE_MX_RECORDS',
        'CHANGE_DKIM_RECORD',
        'CHANGE_SPF_RECORD',
        'CHANGE_DMARC_RECORD',
        'ENABLE_AUTO_RENEW',
        'DISABLE_AUTO_RENEW'
      ])
    );

    this.supportedActions = Array.from(
      new Set([
        ...this.supportedActions,
        'SYNC_DOMAINS',
        'SYNC_DNS_RECORDS',
        'QUEUE_DOMAIN_ACTION',
        'PROCESS_DOMAIN_ACTION_QUEUE',
        'ADD_DNS_RECORD',
        'UPDATE_DNS_RECORD',
        'DELETE_DNS_RECORD',
        'CHANGE_NAMESERVERS',
        'CHECK_DOMAIN_HEALTH',
        'GENERATE_NAMECHEAP_REPORT',
        'NAMECHEAP_HEALTH_CHECK'
      ])
    );

    this.namecheapState = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      domainsTracked: 0,
      dnsRecordsTracked: 0,
      domainActionsQueued: 0,
      domainActionsCompleted: 0,
      domainActionsFailed: 0,
      healthChecksCompleted: 0,
      lastSyncAt: null,
      lastDomainActionAt: null,
      lastHealthCheckAt: null,
      lastReportAt: null,
      lastError: null,
      generatedAt: new Date().toISOString()
    };

    this.ensureNamecheapStorage();
    this.loadNamecheapState();
  }

  ensureNamecheapStorage() {
    if (!fs.existsSync(this.namecheapRuntimeDir)) {
      fs.mkdirSync(this.namecheapRuntimeDir, { recursive: true });
    }

    if (!fs.existsSync(this.namecheapStatePath)) {
      fs.writeFileSync(this.namecheapStatePath, JSON.stringify(this.namecheapState, null, 2), 'utf8');
    }

    if (!fs.existsSync(this.domainRegistryPath)) {
      fs.writeFileSync(this.domainRegistryPath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.dnsRecordRegistryPath)) {
      fs.writeFileSync(this.dnsRecordRegistryPath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.domainActionQueuePath)) {
      fs.writeFileSync(this.domainActionQueuePath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.namecheapExecutionLogPath)) {
      fs.writeFileSync(this.namecheapExecutionLogPath, '', 'utf8');
    }

    if (!fs.existsSync(this.namecheapReportPath)) {
      fs.writeFileSync(this.namecheapReportPath, JSON.stringify({}, null, 2), 'utf8');
    }
  }

  loadNamecheapState() {
    try {
      if (!fs.existsSync(this.namecheapStatePath)) {
        return;
      }

      const raw = fs.readFileSync(this.namecheapStatePath, 'utf8');

      if (!raw.trim()) {
        return;
      }

      const loaded = JSON.parse(raw);

      this.namecheapState = {
        ...this.namecheapState,
        ...loaded,
        service: this.service,
        version: this.version
      };
    } catch (error) {
      this.namecheapState.ok = false;
      this.namecheapState.status = 'NAMECHEAP_STATE_LOAD_FAILED';
      this.namecheapState.lastError = error.message;
      this.persistNamecheapState();
    }
  }

  persistNamecheapState() {
    this.namecheapState.generatedAt = new Date().toISOString();
    fs.writeFileSync(this.namecheapStatePath, JSON.stringify(this.namecheapState, null, 2), 'utf8');
  }

  readJsonArray(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf8');
      }

      const raw = fs.readFileSync(filePath, 'utf8');

      if (!raw.trim()) {
        return [];
      }

      const parsed = JSON.parse(raw);

      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      this.namecheapState.ok = false;
      this.namecheapState.status = 'JSON_ARRAY_READ_FAILED';
      this.namecheapState.lastError = error.message;
      this.persistNamecheapState();

      return [];
    }
  }

  writeJsonArray(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(Array.isArray(value) ? value : [], null, 2), 'utf8');
  }

  appendNamecheapLog(payload) {
    this.appendJsonLine(this.namecheapExecutionLogPath, {
      ...payload,
      workerId: this.workerId,
      domain: this.domain
    });
  }

  async run(input = {}, context = {}) {
    const task = this.normalizeTask(input);

    switch (task.action) {
      case 'SYNC_DOMAINS':
        return await this.syncDomains(task.payload || {}, context);

      case 'SYNC_DNS_RECORDS':
        return await this.syncDnsRecords(task.payload || {}, context);

      case 'QUEUE_DOMAIN_ACTION':
        return this.queueDomainAction(task.payload || {});

      case 'PROCESS_DOMAIN_ACTION_QUEUE':
        return await this.processDomainActionQueue(task.payload || {}, context);

      case 'ADD_DNS_RECORD':
      case 'UPDATE_DNS_RECORD':
      case 'DELETE_DNS_RECORD':
      case 'CHANGE_NAMESERVERS':
        return await this.domainAction(task.action, task.payload || {}, context);

      case 'CHECK_DOMAIN_HEALTH':
        return await this.checkDomainHealth(task.payload || {}, context);

      case 'GENERATE_NAMECHEAP_REPORT':
        return await this.generateNamecheapReport();

      case 'NAMECHEAP_HEALTH_CHECK':
        return await this.namecheapHealthCheck();

      default:
        return await super.run(input, context);
    }
  }

  async executeDomainWork(work = {}, context = {}) {
    const action = String(work.action || 'DOMAIN_TASK').toUpperCase();

    switch (action) {
      case 'SYNC_DOMAINS':
        return await this.syncDomains(work.payload || {}, context);

      case 'SYNC_DNS_RECORDS':
        return await this.syncDnsRecords(work.payload || {}, context);

      case 'QUEUE_DOMAIN_ACTION':
        return this.queueDomainAction(work.payload || {});

      case 'PROCESS_DOMAIN_ACTION_QUEUE':
        return await this.processDomainActionQueue(work.payload || {}, context);

      case 'ADD_DNS_RECORD':
      case 'UPDATE_DNS_RECORD':
      case 'DELETE_DNS_RECORD':
      case 'CHANGE_NAMESERVERS':
        return await this.domainAction(action, work.payload || {}, context);

      case 'CHECK_DOMAIN_HEALTH':
        return await this.checkDomainHealth(work.payload || {}, context);

      case 'GENERATE_NAMECHEAP_REPORT':
        return await this.generateNamecheapReport();

      case 'NAMECHEAP_HEALTH_CHECK':
        return await this.namecheapHealthCheck();

      default:
        return {
          ok: false,
          service: this.service,
          workerId: this.workerId,
          status: 'UNSUPPORTED_NAMECHEAP_ACTION',
          action,
          work
        };
    }
  }

  async syncDomains(payload = {}) {
    const startedAt = new Date().toISOString();

    try {
      let domains = [];

      if (Array.isArray(payload.domains)) {
        domains = payload.domains;
      } else {
        const connectorResult = await this.callConnector(
          payload.connectorId || this.namecheapConnectorId,
          payload.connectorAction || 'listDomains',
          payload,
          {
            action: 'SYNC_DOMAINS'
          }
        );

        if (
          connectorResult &&
          connectorResult.ok &&
          connectorResult.result &&
          Array.isArray(connectorResult.result.domains)
        ) {
          domains = connectorResult.result.domains;
        }
      }

      const normalized = domains.map((domain, index) => this.normalizeDomain(domain, index));

      this.writeJsonArray(this.domainRegistryPath, normalized);

      this.namecheapState.domainsTracked = normalized.length;
      this.namecheapState.status = 'DOMAINS_SYNCED';
      this.namecheapState.lastSyncAt = new Date().toISOString();
      this.namecheapState.lastError = null;
      this.persistNamecheapState();

      const result = {
        ok: true,
        service: this.service,
        workerId: this.workerId,
        status: 'DOMAINS_SYNCED',
        domains: normalized
      };

      this.appendNamecheapLog({
        status: 'DOMAINS_SYNCED',
        startedAt,
        result
      });

      return result;
    } catch (error) {
      this.namecheapState.ok = false;
      this.namecheapState.status = 'DOMAINS_SYNC_FAILED';
      this.namecheapState.lastError = error.message;
      this.persistNamecheapState();

      return {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'DOMAINS_SYNC_FAILED',
        error: error.message
      };
    }
  }

  normalizeDomain(domain = {}, index = 0) {
    return {
      domainId: domain.domainId || domain.id || domain.name || domain.domain || `domain_${index + 1}`,
      domainName: domain.domainName || domain.name || domain.domain || null,
      expiresAt: domain.expiresAt || domain.expirationDate || domain.expires || null,
      autoRenew: Boolean(domain.autoRenew || domain.auto_renew),
      locked: Boolean(domain.locked || domain.isLocked),
      nameservers: Array.isArray(domain.nameservers) ? domain.nameservers : [],
      status: domain.status || 'UNKNOWN',
      metadata: domain,
      syncedAt: new Date().toISOString()
    };
  }

  async syncDnsRecords(payload = {}) {
    const startedAt = new Date().toISOString();

    try {
      let records = [];

      if (Array.isArray(payload.records)) {
        records = payload.records;
      } else {
        const connectorResult = await this.callConnector(
          payload.connectorId || this.namecheapConnectorId,
          payload.connectorAction || 'listDnsRecords',
          payload,
          {
            action: 'SYNC_DNS_RECORDS'
          }
        );

        if (
          connectorResult &&
          connectorResult.ok &&
          connectorResult.result &&
          Array.isArray(connectorResult.result.records)
        ) {
          records = connectorResult.result.records;
        }
      }

      const normalized = records.map((record, index) => this.normalizeDnsRecord(record, index));

      this.writeJsonArray(this.dnsRecordRegistryPath, normalized);

      this.namecheapState.dnsRecordsTracked = normalized.length;
      this.namecheapState.status = 'DNS_RECORDS_SYNCED';
      this.namecheapState.lastSyncAt = new Date().toISOString();
      this.namecheapState.lastError = null;
      this.persistNamecheapState();

      const result = {
        ok: true,
        service: this.service,
        workerId: this.workerId,
        status: 'DNS_RECORDS_SYNCED',
        records: normalized
      };

      this.appendNamecheapLog({
        status: 'DNS_RECORDS_SYNCED',
        startedAt,
        result
      });

      return result;
    } catch (error) {
      this.namecheapState.ok = false;
      this.namecheapState.status = 'DNS_RECORDS_SYNC_FAILED';
      this.namecheapState.lastError = error.message;
      this.persistNamecheapState();

      return {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'DNS_RECORDS_SYNC_FAILED',
        error: error.message
      };
    }
  }

  normalizeDnsRecord(record = {}, index = 0) {
    return {
      recordId: record.recordId || record.id || `dns_record_${index + 1}`,
      domainName: record.domainName || record.domain || null,
      type: String(record.type || record.recordType || '').toUpperCase(),
      host: record.host || record.name || record.hostname || null,
      value: record.value || record.address || record.content || null,
      ttl: Number(record.ttl || 0),
      priority: record.priority || record.mxPref || null,
      metadata: record,
      syncedAt: new Date().toISOString()
    };
  }

  queueDomainAction(item = {}) {
    const queue = this.readJsonArray(this.domainActionQueuePath);

    const action = String(item.action || item.operation || 'ADD_DNS_RECORD').toUpperCase();

    const normalized = {
      domainActionId:
        item.domainActionId ||
        item.id ||
        `NAMECHEAP_ACTION_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      action,
      domainName: item.domainName || item.domain || null,
      record: item.record || null,
      payload: item.payload || item,
      priority: Number(item.priority || 3),
      confidence:
        typeof item.confidence === 'number'
          ? item.confidence
          : 0.9,
      requiresApproval:
        typeof item.requiresApproval === 'boolean'
          ? item.requiresApproval
          : this.actionRequiresApproval(action),
      status: 'QUEUED',
      queuedAt: new Date().toISOString(),
      metadata: item.metadata || {}
    };

    queue.push(normalized);
    this.writeJsonArray(this.domainActionQueuePath, queue);

    this.namecheapState.domainActionsQueued = queue.length;
    this.namecheapState.status = 'DOMAIN_ACTION_QUEUED';
    this.namecheapState.lastDomainActionAt = new Date().toISOString();
    this.namecheapState.lastError = null;
    this.persistNamecheapState();

    return {
      ok: true,
      service: this.service,
      workerId: this.workerId,
      status: 'DOMAIN_ACTION_QUEUED',
      domainAction: normalized,
      queueLength: queue.length
    };
  }

  async processDomainActionQueue(payload = {}, context = {}) {
    const limit = Number(payload.limit || 1);
    const queue = this.readJsonArray(this.domainActionQueuePath);

    const selected = queue.slice(0, limit);
    const remaining = queue.slice(limit);

    this.writeJsonArray(this.domainActionQueuePath, remaining);

    const results = [];

    for (const item of selected) {
      const result = await this.domainAction(item.action, item, context);
      results.push(result);
    }

    this.namecheapState.domainActionsQueued = remaining.length;
    this.persistNamecheapState();

    return {
      ok: results.every((result) => result.ok),
      service: this.service,
      workerId: this.workerId,
      status: 'DOMAIN_ACTION_QUEUE_PROCESSED',
      processed: results.length,
      remaining: remaining.length,
      results
    };
  }

  async domainAction(action, payload = {}, context = {}) {
    const startedAt = new Date().toISOString();
    const normalizedAction = String(action || '').toUpperCase();

    try {
      const requiresApproval =
        typeof payload.requiresApproval === 'boolean'
          ? payload.requiresApproval
          : this.actionRequiresApproval(normalizedAction);

      if (requiresApproval) {
        const decision = await this.requestDecision({
          operationId:
            payload.domainActionId ||
            payload.operationId ||
            `${normalizedAction}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          operationType: normalizedAction,
          priority: Number(payload.priority || 2),
          confidence:
            typeof payload.confidence === 'number'
              ? payload.confidence
              : 0.85,
          requiresApproval: true,
          payload
        });

        if (!decision || !decision.ok) {
          return {
            ok: false,
            service: this.service,
            workerId: this.workerId,
            status: `${normalizedAction}_REQUIRES_APPROVAL`,
            decision
          };
        }
      }

      const connectorAction = this.resolveNamecheapConnectorAction(normalizedAction);

      const connectorResult = await this.callConnector(
        payload.connectorId || this.namecheapConnectorId,
        connectorAction,
        payload,
        {
          action: normalizedAction,
          context
        }
      );

      const ok = Boolean(connectorResult && connectorResult.ok);

      if (ok) {
        this.namecheapState.domainActionsCompleted += 1;
        this.namecheapState.status = `${normalizedAction}_COMPLETED`;
        this.namecheapState.lastError = null;
      } else {
        this.namecheapState.domainActionsFailed += 1;
        this.namecheapState.status = `${normalizedAction}_FAILED`;
        this.namecheapState.lastError =
          connectorResult && connectorResult.error
            ? connectorResult.error
            : `${normalizedAction} failed.`;
      }

      this.namecheapState.lastDomainActionAt = new Date().toISOString();
      this.persistNamecheapState();

      const result = {
        ok,
        service: this.service,
        workerId: this.workerId,
        status: ok ? `${normalizedAction}_COMPLETED` : `${normalizedAction}_FAILED`,
        action: normalizedAction,
        payload,
        connectorResult
      };

      this.appendNamecheapLog({
        ...result,
        startedAt,
        completedAt: new Date().toISOString()
      });

      await this.recordExecutiveEvent({
        eventType: 'NAMECHEAP_DOMAIN_ACTION',
        action: normalizedAction,
        status: result.status,
        result
      });

      return result;
    } catch (error) {
      this.namecheapState.domainActionsFailed += 1;
      this.namecheapState.status = `${normalizedAction}_FAILED`;
      this.namecheapState.lastError = error.message;
      this.persistNamecheapState();

      const failure = {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: `${normalizedAction}_FAILED`,
        action: normalizedAction,
        error: error.message
      };

      this.appendNamecheapLog({
        ...failure,
        startedAt,
        failedAt: new Date().toISOString()
      });

      return failure;
    }
  }

  resolveNamecheapConnectorAction(action) {
    const map = {
      ADD_DNS_RECORD: 'addDnsRecord',
      UPDATE_DNS_RECORD: 'updateDnsRecord',
      DELETE_DNS_RECORD: 'deleteDnsRecord',
      CHANGE_NAMESERVERS: 'changeNameservers',
      CHECK_DOMAIN_HEALTH: 'checkDomainHealth',
      ENABLE_AUTO_RENEW: 'enableAutoRenew',
      DISABLE_AUTO_RENEW: 'disableAutoRenew'
    };

    return map[action] || 'executeDomainAction';
  }

  async checkDomainHealth(payload = {}, context = {}) {
    const startedAt = new Date().toISOString();

    try {
      const connectorResult = await this.callConnector(
        payload.connectorId || this.namecheapConnectorId,
        payload.connectorAction || 'checkDomainHealth',
        payload,
        {
          action: 'CHECK_DOMAIN_HEALTH',
          context
        }
      );

      const ok = Boolean(connectorResult && connectorResult.ok);

      this.namecheapState.healthChecksCompleted += 1;
      this.namecheapState.status = ok ? 'DOMAIN_HEALTH_CHECK_COMPLETED' : 'DOMAIN_HEALTH_CHECK_FAILED';
      this.namecheapState.lastHealthCheckAt = new Date().toISOString();
      this.namecheapState.lastError =
        ok
          ? null
          : connectorResult && connectorResult.error
            ? connectorResult.error
            : 'Domain health check failed.';
      this.persistNamecheapState();

      const result = {
        ok,
        service: this.service,
        workerId: this.workerId,
        status: this.namecheapState.status,
        connectorResult,
        checkedAt: new Date().toISOString()
      };

      this.appendNamecheapLog({
        ...result,
        startedAt
      });

      await this.recordExecutiveEvent({
        eventType: 'NAMECHEAP_DOMAIN_HEALTH',
        result
      });

      return result;
    } catch (error) {
      this.namecheapState.healthChecksCompleted += 1;
      this.namecheapState.status = 'DOMAIN_HEALTH_CHECK_FAILED';
      this.namecheapState.lastError = error.message;
      this.persistNamecheapState();

      return {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'DOMAIN_HEALTH_CHECK_FAILED',
        error: error.message
      };
    }
  }

  async namecheapHealthCheck() {
    let connectorHealth = {
      ok: false,
      status: 'NAMECHEAP_CONNECTOR_NOT_CHECKED'
    };

    if (this.connectorRuntimeManager && typeof this.connectorRuntimeManager.execute === 'function') {
      connectorHealth = await this.callConnector(
        this.namecheapConnectorId,
        'healthCheck',
        {},
        {
          action: 'NAMECHEAP_HEALTH_CHECK'
        }
      );
    }

    const domains = this.readJsonArray(this.domainRegistryPath);
    const records = this.readJsonArray(this.dnsRecordRegistryPath);
    const queue = this.readJsonArray(this.domainActionQueuePath);

    const ok =
      fs.existsSync(this.namecheapRuntimeDir) &&
      fs.existsSync(this.namecheapStatePath) &&
      fs.existsSync(this.domainRegistryPath) &&
      fs.existsSync(this.dnsRecordRegistryPath) &&
      fs.existsSync(this.domainActionQueuePath) &&
      fs.existsSync(this.namecheapExecutionLogPath);

    this.namecheapState.lastHealthCheckAt = new Date().toISOString();
    this.persistNamecheapState();

    return {
      ok,
      service: this.service,
      workerId: this.workerId,
      status: ok ? 'NAMECHEAP_HEALTHY' : 'NAMECHEAP_DEGRADED',
      domainsTracked: domains.length,
      dnsRecordsTracked: records.length,
      domainActionsQueued: queue.length,
      connectorHealth,
      namecheapState: this.namecheapState,
      generatedAt: new Date().toISOString()
    };
  }

  async generateNamecheapReport() {
    const domains = this.readJsonArray(this.domainRegistryPath);
    const records = this.readJsonArray(this.dnsRecordRegistryPath);
    const queue = this.readJsonArray(this.domainActionQueuePath);

    const report = {
      ok: true,
      service: this.service,
      workerId: this.workerId,
      status: 'NAMECHEAP_REPORT_READY',
      generatedAt: new Date().toISOString(),
      namecheapState: this.namecheapState,
      domainsTracked: domains.length,
      dnsRecordsTracked: records.length,
      domainActionsQueued: queue.length,
      approvalRequiredActions: this.approvalRequiredActions,
      supportedActions: this.supportedActions,
      paths: {
        namecheapRuntimeDir: this.namecheapRuntimeDir,
        namecheapStatePath: this.namecheapStatePath,
        domainRegistryPath: this.domainRegistryPath,
        dnsRecordRegistryPath: this.dnsRecordRegistryPath,
        domainActionQueuePath: this.domainActionQueuePath,
        namecheapExecutionLogPath: this.namecheapExecutionLogPath
      },
      workerState: this.getState()
    };

    fs.writeFileSync(this.namecheapReportPath, JSON.stringify(report, null, 2), 'utf8');

    this.namecheapState.lastReportAt = new Date().toISOString();
    this.namecheapState.status = 'NAMECHEAP_REPORT_READY';
    this.persistNamecheapState();

    await this.recordExecutiveEvent({
      eventType: 'NAMECHEAP_REPORT',
      report
    });

    return report;
  }

  async healthCheck() {
    const baseHealth = await super.healthCheck();
    const namecheapHealth = await this.namecheapHealthCheck();

    const reportExists = fs.existsSync(this.namecheapReportPath);

    const ok = baseHealth.ok && namecheapHealth.ok && reportExists;

    return {
      ok,
      service: this.service,
      version: this.version,
      workerId: this.workerId,
      workerName: this.workerName,
      workerType: this.workerType,
      domain: this.domain,
      status: ok ? 'HEALTHY' : 'DEGRADED',
      baseHealth,
      namecheapHealth,
      storage: {
        reportExists
      },
      state: this.getState(),
      namecheapState: this.namecheapState
    };
  }

  getMetadata() {
    return {
      ...super.getMetadata(),
      service: this.service,
      version: this.version,
      namecheapConnectorId: this.namecheapConnectorId,
      supportedActions: this.supportedActions
    };
  }
}

module.exports = NamecheapCOOWorker;