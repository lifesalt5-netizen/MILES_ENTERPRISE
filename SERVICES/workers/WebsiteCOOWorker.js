'use strict';

const fs = require('fs');
const path = require('path');

const BaseCOOWorker = require('./BaseCOOWorker');

class WebsiteCOOWorker extends BaseCOOWorker {
  constructor(options = {}) {
    super({
      ...options,
      workerId: options.workerId || 'WEBSITE_COO_WORKER',
      workerName: options.workerName || 'Website COO Worker',
      workerType: options.workerType || 'WEBSITE_COO',
      domain: options.domain || 'WEBSITE',
      description:
        options.description ||
        'Autonomous COO worker for website operations, change queues, page updates, reporting, and website execution routing.'
    });

    this.service = 'WEBSITE_COO_WORKER';
    this.version = '1.0.0';

    this.websiteConnectorId = options.websiteConnectorId || 'website';

    this.websiteRuntimeDir =
      options.websiteRuntimeDir ||
      path.join(this.runtimeDir, 'website_coo');

    this.websiteStatePath =
      options.websiteStatePath ||
      path.join(this.websiteRuntimeDir, 'website_state.json');

    this.websiteChangeQueuePath =
      options.websiteChangeQueuePath ||
      path.join(this.websiteRuntimeDir, 'website_change_queue.json');

    this.websitePageRegistryPath =
      options.websitePageRegistryPath ||
      path.join(this.websiteRuntimeDir, 'website_page_registry.json');

    this.websiteReportPath =
      options.websiteReportPath ||
      path.join(this.websiteRuntimeDir, 'website_report.json');

    this.websiteExecutionLogPath =
      options.websiteExecutionLogPath ||
      path.join(this.websiteRuntimeDir, 'website_execution_log.jsonl');

    this.approvalRequiredActions = Array.from(
      new Set([
        ...this.approvalRequiredActions,
        'PUBLISH_SITE',
        'DELETE_PAGE',
        'CHANGE_PRICING',
        'CHANGE_LEGAL_COPY',
        'CHANGE_PUBLIC_CTA'
      ])
    );

    this.supportedActions = Array.from(
      new Set([
        ...this.supportedActions,
        'DISCOVER_PAGES',
        'QUEUE_WEBSITE_CHANGE',
        'PROCESS_WEBSITE_CHANGES',
        'APPLY_WEBSITE_CHANGE',
        'PUBLISH_SITE',
        'GENERATE_WEBSITE_REPORT',
        'WEBSITE_HEALTH_CHECK'
      ])
    );

    this.websiteState = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      pagesDiscovered: 0,
      changesQueued: 0,
      changesApplied: 0,
      changesFailed: 0,
      publishAttempts: 0,
      publishCompleted: 0,
      publishFailed: 0,
      lastDiscoveryAt: null,
      lastChangeAt: null,
      lastPublishAt: null,
      lastReportAt: null,
      lastError: null,
      generatedAt: new Date().toISOString()
    };

    this.ensureWebsiteStorage();
    this.loadWebsiteState();
  }

  ensureWebsiteStorage() {
    if (!fs.existsSync(this.websiteRuntimeDir)) {
      fs.mkdirSync(this.websiteRuntimeDir, { recursive: true });
    }

    if (!fs.existsSync(this.websiteStatePath)) {
      fs.writeFileSync(this.websiteStatePath, JSON.stringify(this.websiteState, null, 2), 'utf8');
    }

    if (!fs.existsSync(this.websiteChangeQueuePath)) {
      fs.writeFileSync(this.websiteChangeQueuePath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.websitePageRegistryPath)) {
      fs.writeFileSync(this.websitePageRegistryPath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.websiteReportPath)) {
      fs.writeFileSync(this.websiteReportPath, JSON.stringify({}, null, 2), 'utf8');
    }

    if (!fs.existsSync(this.websiteExecutionLogPath)) {
      fs.writeFileSync(this.websiteExecutionLogPath, '', 'utf8');
    }
  }

  loadWebsiteState() {
    try {
      if (!fs.existsSync(this.websiteStatePath)) {
        return;
      }

      const raw = fs.readFileSync(this.websiteStatePath, 'utf8');

      if (!raw.trim()) {
        return;
      }

      const loaded = JSON.parse(raw);

      this.websiteState = {
        ...this.websiteState,
        ...loaded,
        service: this.service,
        version: this.version
      };
    } catch (error) {
      this.websiteState.ok = false;
      this.websiteState.status = 'WEBSITE_STATE_LOAD_FAILED';
      this.websiteState.lastError = error.message;
      this.persistWebsiteState();
    }
  }

  persistWebsiteState() {
    this.websiteState.generatedAt = new Date().toISOString();
    fs.writeFileSync(this.websiteStatePath, JSON.stringify(this.websiteState, null, 2), 'utf8');
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
      this.websiteState.ok = false;
      this.websiteState.status = 'JSON_ARRAY_READ_FAILED';
      this.websiteState.lastError = error.message;
      this.persistWebsiteState();

      return [];
    }
  }

  writeJsonArray(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(Array.isArray(value) ? value : [], null, 2), 'utf8');
  }

  appendWebsiteLog(payload) {
    this.appendJsonLine(this.websiteExecutionLogPath, {
      ...payload,
      workerId: this.workerId,
      domain: this.domain
    });
  }

  async run(input = {}, context = {}) {
    const task = this.normalizeTask(input);

    switch (task.action) {
      case 'DISCOVER_PAGES':
        return await this.discoverPages(task.payload || {}, context);

      case 'QUEUE_WEBSITE_CHANGE':
        return this.queueWebsiteChange(task.payload || {});

      case 'PROCESS_WEBSITE_CHANGES':
        return await this.processWebsiteChanges(task.payload || {}, context);

      case 'APPLY_WEBSITE_CHANGE':
        return await this.applyWebsiteChange(task.payload || {}, context);

      case 'PUBLISH_SITE':
        return await this.publishSite(task.payload || {}, context);

      case 'GENERATE_WEBSITE_REPORT':
        return await this.generateWebsiteReport();

      case 'WEBSITE_HEALTH_CHECK':
        return await this.websiteHealthCheck();

      default:
        return await super.run(input, context);
    }
  }

  async executeDomainWork(work = {}, context = {}) {
    const action = String(work.action || 'DOMAIN_TASK').toUpperCase();

    switch (action) {
      case 'DISCOVER_PAGES':
        return await this.discoverPages(work.payload || {}, context);

      case 'QUEUE_WEBSITE_CHANGE':
        return this.queueWebsiteChange(work.payload || {});

      case 'PROCESS_WEBSITE_CHANGES':
        return await this.processWebsiteChanges(work.payload || {}, context);

      case 'APPLY_WEBSITE_CHANGE':
        return await this.applyWebsiteChange(work.payload || {}, context);

      case 'PUBLISH_SITE':
        return await this.publishSite(work.payload || {}, context);

      case 'GENERATE_WEBSITE_REPORT':
        return await this.generateWebsiteReport();

      case 'WEBSITE_HEALTH_CHECK':
        return await this.websiteHealthCheck();

      default:
        return {
          ok: false,
          service: this.service,
          workerId: this.workerId,
          status: 'UNSUPPORTED_WEBSITE_ACTION',
          action,
          work
        };
    }
  }

  async discoverPages(payload = {}) {
    const startedAt = new Date().toISOString();

    try {
      let connectorResult = null;

      if (payload.useConnector !== false) {
        connectorResult = await this.callConnector(
          payload.connectorId || this.websiteConnectorId,
          payload.connectorAction || 'discoverPages',
          payload,
          {
            action: 'DISCOVER_PAGES'
          }
        );
      }

      let pages = [];

      if (
        connectorResult &&
        connectorResult.ok &&
        connectorResult.result &&
        Array.isArray(connectorResult.result.pages)
      ) {
        pages = connectorResult.result.pages;
      } else if (Array.isArray(payload.pages)) {
        pages = payload.pages;
      }

      const normalizedPages = pages.map((page, index) => this.normalizePage(page, index));

      this.writeJsonArray(this.websitePageRegistryPath, normalizedPages);

      this.websiteState.pagesDiscovered = normalizedPages.length;
      this.websiteState.status = 'PAGES_DISCOVERED';
      this.websiteState.lastDiscoveryAt = new Date().toISOString();
      this.websiteState.lastError = null;
      this.persistWebsiteState();

      const result = {
        ok: true,
        service: this.service,
        workerId: this.workerId,
        status: 'PAGES_DISCOVERED',
        pages: normalizedPages,
        connectorResult
      };

      this.appendWebsiteLog({
        status: 'PAGES_DISCOVERED',
        startedAt,
        result
      });

      await this.emitLearningEvent({
        eventType: 'WORKER_EXECUTION',
        target: this.workerId,
        ok: true,
        status: 'WEBSITE_PAGES_DISCOVERED',
        raw: result
      });

      return result;
    } catch (error) {
      this.websiteState.ok = false;
      this.websiteState.status = 'PAGE_DISCOVERY_FAILED';
      this.websiteState.lastError = error.message;
      this.persistWebsiteState();

      const failure = {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'PAGE_DISCOVERY_FAILED',
        error: error.message
      };

      this.appendWebsiteLog({
        status: 'PAGE_DISCOVERY_FAILED',
        startedAt,
        error: error.message
      });

      await this.emitLearningEvent({
        eventType: 'WORKER_EXECUTION',
        target: this.workerId,
        ok: false,
        status: 'WEBSITE_PAGE_DISCOVERY_FAILED',
        error: error.message,
        raw: payload
      });

      return failure;
    }
  }

  normalizePage(page = {}, index = 0) {
    const title =
      page.title ||
      page.name ||
      page.pageTitle ||
      `Page ${index + 1}`;

    const url =
      page.url ||
      page.href ||
      page.path ||
      null;

    return {
      pageId:
        page.pageId ||
        page.id ||
        String(title).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') ||
        `page_${index + 1}`,
      title,
      url,
      path: page.path || url || null,
      status: page.status || 'ACTIVE',
      metadata: page.metadata || page,
      discoveredAt: page.discoveredAt || new Date().toISOString()
    };
  }

  queueWebsiteChange(change = {}) {
    const queue = this.readJsonArray(this.websiteChangeQueuePath);

    const action = String(change.action || change.changeType || 'UPDATE_CONTENT').toUpperCase();

    const normalized = {
      changeId:
        change.changeId ||
        change.id ||
        `WEB_CHANGE_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      pageId: change.pageId || change.page || null,
      pageUrl: change.pageUrl || change.url || null,
      action,
      selector: change.selector || null,
      field: change.field || null,
      before: change.before || null,
      after: change.after || change.value || change.content || null,
      payload: change.payload || {},
      priority: Number(change.priority || 3),
      confidence:
        typeof change.confidence === 'number'
          ? change.confidence
          : 0.9,
      requiresApproval:
        typeof change.requiresApproval === 'boolean'
          ? change.requiresApproval
          : this.actionRequiresApproval(action),
      status: 'QUEUED',
      queuedAt: new Date().toISOString(),
      metadata: change.metadata || {}
    };

    queue.push(normalized);
    this.writeJsonArray(this.websiteChangeQueuePath, queue);

    this.websiteState.changesQueued = queue.length;
    this.websiteState.status = 'WEBSITE_CHANGE_QUEUED';
    this.websiteState.lastChangeAt = new Date().toISOString();
    this.websiteState.lastError = null;
    this.persistWebsiteState();

    const result = {
      ok: true,
      service: this.service,
      workerId: this.workerId,
      status: 'WEBSITE_CHANGE_QUEUED',
      change: normalized,
      queueLength: queue.length
    };

    this.appendWebsiteLog(result);

    return result;
  }

  async processWebsiteChanges(payload = {}, context = {}) {
    const limit = Number(payload.limit || 1);
    const queue = this.readJsonArray(this.websiteChangeQueuePath);

    const selected = queue.slice(0, limit);
    const remaining = queue.slice(limit);

    this.writeJsonArray(this.websiteChangeQueuePath, remaining);

    const results = [];

    for (const change of selected) {
      const result = await this.applyWebsiteChange(change, context);
      results.push(result);
    }

    const ok = results.every((result) => result.ok);

    const result = {
      ok,
      service: this.service,
      workerId: this.workerId,
      status: ok ? 'WEBSITE_CHANGES_PROCESSED' : 'WEBSITE_CHANGES_PROCESSED_WITH_ERRORS',
      processed: results.length,
      remaining: remaining.length,
      results
    };

    this.websiteState.status = result.status;
    this.websiteState.changesQueued = remaining.length;
    this.websiteState.lastChangeAt = new Date().toISOString();
    this.persistWebsiteState();

    this.appendWebsiteLog(result);

    return result;
  }

  async applyWebsiteChange(change = {}, context = {}) {
    const startedAt = new Date().toISOString();

    try {
      const normalized = {
        ...change,
        action: String(change.action || 'UPDATE_CONTENT').toUpperCase()
      };

      if (normalized.requiresApproval || this.actionRequiresApproval(normalized.action)) {
        const decision = await this.requestDecision({
          operationId: normalized.changeId,
          operationType: normalized.action,
          priority: normalized.priority || 3,
          confidence: normalized.confidence || 0.9,
          requiresApproval: true,
          payload: normalized
        });

        if (!decision || !decision.ok) {
          const rejected = {
            ok: false,
            service: this.service,
            workerId: this.workerId,
            status: 'WEBSITE_CHANGE_REQUIRES_APPROVAL',
            change: normalized,
            decision
          };

          this.websiteState.changesFailed += 1;
          this.websiteState.status = 'WEBSITE_CHANGE_REQUIRES_APPROVAL';
          this.websiteState.lastError = 'Website change requires approval.';
          this.persistWebsiteState();

          this.appendWebsiteLog({
            ...rejected,
            startedAt
          });

          return rejected;
        }
      }

      const connectorAction = this.resolveConnectorAction(normalized.action);

      const connectorResult = await this.callConnector(
        normalized.connectorId || this.websiteConnectorId,
        connectorAction,
        normalized,
        {
          action: normalized.action,
          changeId: normalized.changeId,
          context
        }
      );

      const ok = Boolean(connectorResult && connectorResult.ok);

      if (ok) {
        this.websiteState.changesApplied += 1;
        this.websiteState.status = 'WEBSITE_CHANGE_APPLIED';
        this.websiteState.lastError = null;
      } else {
        this.websiteState.changesFailed += 1;
        this.websiteState.status = 'WEBSITE_CHANGE_FAILED';
        this.websiteState.lastError =
          connectorResult && connectorResult.error
            ? connectorResult.error
            : 'Website connector change failed.';
      }

      this.websiteState.lastChangeAt = new Date().toISOString();
      this.persistWebsiteState();

      const result = {
        ok,
        service: this.service,
        workerId: this.workerId,
        status: ok ? 'WEBSITE_CHANGE_APPLIED' : 'WEBSITE_CHANGE_FAILED',
        change: normalized,
        connectorResult
      };

      this.appendWebsiteLog({
        ...result,
        startedAt,
        completedAt: new Date().toISOString()
      });

      await this.emitLearningEvent({
        eventType: 'WORKER_EXECUTION',
        target: this.workerId,
        ok,
        status: result.status,
        error: ok ? null : this.websiteState.lastError,
        raw: result
      });

      await this.recordExecutiveEvent({
        eventType: 'WEBSITE_CHANGE',
        status: result.status,
        change: normalized
      });

      return result;
    } catch (error) {
      this.websiteState.changesFailed += 1;
      this.websiteState.status = 'WEBSITE_CHANGE_FAILED';
      this.websiteState.lastError = error.message;
      this.persistWebsiteState();

      const failure = {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'WEBSITE_CHANGE_FAILED',
        change,
        error: error.message
      };

      this.appendWebsiteLog({
        ...failure,
        startedAt,
        failedAt: new Date().toISOString()
      });

      await this.emitLearningEvent({
        eventType: 'WORKER_EXECUTION',
        target: this.workerId,
        ok: false,
        status: 'WEBSITE_CHANGE_FAILED',
        error: error.message,
        raw: change
      });

      return failure;
    }
  }

  resolveConnectorAction(action) {
    const normalized = String(action || '').toUpperCase();

    const actionMap = {
      UPDATE_CONTENT: 'updateContent',
      UPDATE_COPY: 'updateContent',
      UPDATE_FIELD: 'updateField',
      UPDATE_CTA: 'updateCTA',
      CHANGE_PUBLIC_CTA: 'updateCTA',
      CHANGE_PRICING: 'updatePricing',
      CHANGE_LEGAL_COPY: 'updateLegalCopy',
      CREATE_PAGE: 'createPage',
      DELETE_PAGE: 'deletePage',
      PUBLISH_SITE: 'publishSite'
    };

    return actionMap[normalized] || 'executeWebsiteChange';
  }

  async publishSite(payload = {}, context = {}) {
    const startedAt = new Date().toISOString();

    this.websiteState.publishAttempts += 1;
    this.websiteState.lastPublishAt = new Date().toISOString();

    try {
      const requiresApproval =
        typeof payload.requiresApproval === 'boolean'
          ? payload.requiresApproval
          : true;

      if (requiresApproval) {
        const decision = await this.requestDecision({
          operationId:
            payload.operationId ||
            `PUBLISH_SITE_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          operationType: 'PUBLISH_SITE',
          priority: Number(payload.priority || 2),
          confidence:
            typeof payload.confidence === 'number'
              ? payload.confidence
              : 0.85,
          requiresApproval: true,
          payload
        });

        if (!decision || !decision.ok) {
          this.websiteState.publishFailed += 1;
          this.websiteState.status = 'PUBLISH_REQUIRES_APPROVAL';
          this.websiteState.lastError = 'Publish requires approval.';
          this.persistWebsiteState();

          return {
            ok: false,
            service: this.service,
            workerId: this.workerId,
            status: 'PUBLISH_REQUIRES_APPROVAL',
            decision
          };
        }
      }

      const connectorResult = await this.callConnector(
        payload.connectorId || this.websiteConnectorId,
        payload.connectorAction || 'publishSite',
        payload,
        {
          action: 'PUBLISH_SITE',
          context
        }
      );

      const ok = Boolean(connectorResult && connectorResult.ok);

      if (ok) {
        this.websiteState.publishCompleted += 1;
        this.websiteState.status = 'SITE_PUBLISHED';
        this.websiteState.lastError = null;
      } else {
        this.websiteState.publishFailed += 1;
        this.websiteState.status = 'SITE_PUBLISH_FAILED';
        this.websiteState.lastError =
          connectorResult && connectorResult.error
            ? connectorResult.error
            : 'Website publish failed.';
      }

      this.websiteState.lastPublishAt = new Date().toISOString();
      this.persistWebsiteState();

      const result = {
        ok,
        service: this.service,
        workerId: this.workerId,
        status: ok ? 'SITE_PUBLISHED' : 'SITE_PUBLISH_FAILED',
        connectorResult
      };

      this.appendWebsiteLog({
        ...result,
        startedAt,
        completedAt: new Date().toISOString()
      });

      await this.emitLearningEvent({
        eventType: 'WORKER_EXECUTION',
        target: this.workerId,
        ok,
        status: result.status,
        error: ok ? null : this.websiteState.lastError,
        raw: result
      });

      await this.recordExecutiveEvent({
        eventType: 'WEBSITE_PUBLISH',
        status: result.status,
        result
      });

      return result;
    } catch (error) {
      this.websiteState.publishFailed += 1;
      this.websiteState.status = 'SITE_PUBLISH_FAILED';
      this.websiteState.lastError = error.message;
      this.persistWebsiteState();

      const failure = {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'SITE_PUBLISH_FAILED',
        error: error.message
      };

      this.appendWebsiteLog({
        ...failure,
        startedAt,
        failedAt: new Date().toISOString()
      });

      return failure;
    }
  }

  async websiteHealthCheck() {
    let connectorHealth = {
      ok: false,
      status: 'WEBSITE_CONNECTOR_NOT_CHECKED'
    };

    if (this.connectorRuntimeManager && typeof this.connectorRuntimeManager.execute === 'function') {
      connectorHealth = await this.callConnector(
        this.websiteConnectorId,
        'healthCheck',
        {},
        {
          action: 'WEBSITE_HEALTH_CHECK'
        }
      );
    }

    const pageRegistry = this.readJsonArray(this.websitePageRegistryPath);
    const changeQueue = this.readJsonArray(this.websiteChangeQueuePath);

    const ok =
      fs.existsSync(this.websiteRuntimeDir) &&
      fs.existsSync(this.websiteStatePath) &&
      fs.existsSync(this.websiteChangeQueuePath) &&
      fs.existsSync(this.websitePageRegistryPath) &&
      fs.existsSync(this.websiteExecutionLogPath);

    return {
      ok,
      service: this.service,
      workerId: this.workerId,
      status: ok ? 'WEBSITE_HEALTHY' : 'WEBSITE_DEGRADED',
      pagesRegistered: pageRegistry.length,
      changesQueued: changeQueue.length,
      connectorHealth,
      websiteState: this.websiteState,
      generatedAt: new Date().toISOString()
    };
  }

  async generateWebsiteReport() {
    const pages = this.readJsonArray(this.websitePageRegistryPath);
    const changes = this.readJsonArray(this.websiteChangeQueuePath);

    const report = {
      ok: true,
      service: this.service,
      workerId: this.workerId,
      status: 'WEBSITE_REPORT_READY',
      generatedAt: new Date().toISOString(),
      websiteState: this.websiteState,
      pagesRegistered: pages.length,
      changesQueued: changes.length,
      approvalRequiredActions: this.approvalRequiredActions,
      supportedActions: this.supportedActions,
      paths: {
        websiteRuntimeDir: this.websiteRuntimeDir,
        websiteStatePath: this.websiteStatePath,
        websiteChangeQueuePath: this.websiteChangeQueuePath,
        websitePageRegistryPath: this.websitePageRegistryPath,
        websiteExecutionLogPath: this.websiteExecutionLogPath
      },
      workerState: this.getState()
    };

    fs.writeFileSync(this.websiteReportPath, JSON.stringify(report, null, 2), 'utf8');

    this.websiteState.lastReportAt = new Date().toISOString();
    this.websiteState.status = 'WEBSITE_REPORT_READY';
    this.persistWebsiteState();

    await this.recordExecutiveEvent({
      eventType: 'WEBSITE_REPORT',
      report
    });

    return report;
  }

  async healthCheck() {
    const baseHealth = await super.healthCheck();
    const websiteHealth = await this.websiteHealthCheck();

    const reportExists = fs.existsSync(this.websiteReportPath);

    const ok = baseHealth.ok && websiteHealth.ok && reportExists;

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
      websiteHealth,
      storage: {
        reportExists
      },
      state: this.getState(),
      websiteState: this.websiteState
    };
  }

  getMetadata() {
    return {
      ...super.getMetadata(),
      service: this.service,
      version: this.version,
      websiteConnectorId: this.websiteConnectorId,
      supportedActions: this.supportedActions
    };
  }
}

module.exports = WebsiteCOOWorker;