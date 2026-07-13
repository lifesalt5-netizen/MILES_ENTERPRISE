'use strict';

const fs = require('fs');
const path = require('path');

const BaseCOOWorker = require('./BaseCOOWorker');

class GoogleWorkspaceCOOWorker extends BaseCOOWorker {
  constructor(options = {}) {
    super({
      ...options,
      workerId: options.workerId || 'GOOGLE_WORKSPACE_COO_WORKER',
      workerName: options.workerName || 'Google Workspace COO Worker',
      workerType: options.workerType || 'GOOGLE_WORKSPACE_COO',
      domain: options.domain || 'GOOGLE_WORKSPACE',
      description:
        options.description ||
        'Autonomous COO worker for Google Workspace user, alias, group, domain, routing, and workspace health operations.'
    });

    this.service = 'GOOGLE_WORKSPACE_COO_WORKER';
    this.version = '1.0.0';

    this.googleConnectorId = options.googleConnectorId || 'google_workspace';

    this.googleRuntimeDir =
      options.googleRuntimeDir ||
      path.join(this.runtimeDir, 'google_workspace_coo');

    this.googleStatePath =
      options.googleStatePath ||
      path.join(this.googleRuntimeDir, 'google_workspace_state.json');

    this.userRegistryPath =
      options.userRegistryPath ||
      path.join(this.googleRuntimeDir, 'user_registry.json');

    this.aliasRegistryPath =
      options.aliasRegistryPath ||
      path.join(this.googleRuntimeDir, 'alias_registry.json');

    this.groupRegistryPath =
      options.groupRegistryPath ||
      path.join(this.googleRuntimeDir, 'group_registry.json');

    this.domainRegistryPath =
      options.domainRegistryPath ||
      path.join(this.googleRuntimeDir, 'domain_registry.json');

    this.provisioningQueuePath =
      options.provisioningQueuePath ||
      path.join(this.googleRuntimeDir, 'provisioning_queue.json');

    this.googleExecutionLogPath =
      options.googleExecutionLogPath ||
      path.join(this.googleRuntimeDir, 'google_workspace_execution_log.jsonl');

    this.googleReportPath =
      options.googleReportPath ||
      path.join(this.googleRuntimeDir, 'google_workspace_report.json');

    this.approvalRequiredActions = Array.from(
      new Set([
        ...this.approvalRequiredActions,
        'CREATE_USER',
        'DELETE_USER',
        'SUSPEND_USER',
        'RESET_PASSWORD',
        'CHANGE_ADMIN_ROLE',
        'CHANGE_MAIL_ROUTING',
        'DELETE_ALIAS',
        'DELETE_GROUP',
        'VERIFY_DOMAIN',
        'REMOVE_DOMAIN'
      ])
    );

    this.supportedActions = Array.from(
      new Set([
        ...this.supportedActions,
        'SYNC_USERS',
        'SYNC_ALIASES',
        'SYNC_GROUPS',
        'SYNC_DOMAINS',
        'QUEUE_PROVISIONING',
        'PROCESS_PROVISIONING_QUEUE',
        'CREATE_USER',
        'SUSPEND_USER',
        'CREATE_ALIAS',
        'DELETE_ALIAS',
        'CREATE_GROUP',
        'ADD_GROUP_MEMBER',
        'REMOVE_GROUP_MEMBER',
        'VERIFY_DOMAIN',
        'CONFIGURE_MAIL_ROUTING',
        'GOOGLE_WORKSPACE_HEALTH_CHECK',
        'GENERATE_GOOGLE_WORKSPACE_REPORT'
      ])
    );

    this.googleState = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      usersTracked: 0,
      aliasesTracked: 0,
      groupsTracked: 0,
      domainsTracked: 0,
      provisioningQueued: 0,
      provisioningCompleted: 0,
      provisioningFailed: 0,
      workspaceActionsCompleted: 0,
      workspaceActionsFailed: 0,
      lastSyncAt: null,
      lastProvisioningAt: null,
      lastWorkspaceActionAt: null,
      lastHealthCheckAt: null,
      lastReportAt: null,
      lastError: null,
      generatedAt: new Date().toISOString()
    };

    this.ensureGoogleStorage();
    this.loadGoogleState();
  }

  ensureGoogleStorage() {
    if (!fs.existsSync(this.googleRuntimeDir)) {
      fs.mkdirSync(this.googleRuntimeDir, { recursive: true });
    }

    if (!fs.existsSync(this.googleStatePath)) {
      fs.writeFileSync(this.googleStatePath, JSON.stringify(this.googleState, null, 2), 'utf8');
    }

    if (!fs.existsSync(this.userRegistryPath)) {
      fs.writeFileSync(this.userRegistryPath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.aliasRegistryPath)) {
      fs.writeFileSync(this.aliasRegistryPath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.groupRegistryPath)) {
      fs.writeFileSync(this.groupRegistryPath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.domainRegistryPath)) {
      fs.writeFileSync(this.domainRegistryPath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.provisioningQueuePath)) {
      fs.writeFileSync(this.provisioningQueuePath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.googleExecutionLogPath)) {
      fs.writeFileSync(this.googleExecutionLogPath, '', 'utf8');
    }

    if (!fs.existsSync(this.googleReportPath)) {
      fs.writeFileSync(this.googleReportPath, JSON.stringify({}, null, 2), 'utf8');
    }
  }

  loadGoogleState() {
    try {
      if (!fs.existsSync(this.googleStatePath)) {
        return;
      }

      const raw = fs.readFileSync(this.googleStatePath, 'utf8');

      if (!raw.trim()) {
        return;
      }

      const loaded = JSON.parse(raw);

      this.googleState = {
        ...this.googleState,
        ...loaded,
        service: this.service,
        version: this.version
      };
    } catch (error) {
      this.googleState.ok = false;
      this.googleState.status = 'GOOGLE_WORKSPACE_STATE_LOAD_FAILED';
      this.googleState.lastError = error.message;
      this.persistGoogleState();
    }
  }

  persistGoogleState() {
    this.googleState.generatedAt = new Date().toISOString();
    fs.writeFileSync(this.googleStatePath, JSON.stringify(this.googleState, null, 2), 'utf8');
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
      this.googleState.ok = false;
      this.googleState.status = 'JSON_ARRAY_READ_FAILED';
      this.googleState.lastError = error.message;
      this.persistGoogleState();

      return [];
    }
  }

  writeJsonArray(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(Array.isArray(value) ? value : [], null, 2), 'utf8');
  }

  appendGoogleLog(payload) {
    this.appendJsonLine(this.googleExecutionLogPath, {
      ...payload,
      workerId: this.workerId,
      domain: this.domain
    });
  }

  async run(input = {}, context = {}) {
    const task = this.normalizeTask(input);

    switch (task.action) {
      case 'SYNC_USERS':
        return await this.syncUsers(task.payload || {}, context);

      case 'SYNC_ALIASES':
        return await this.syncAliases(task.payload || {}, context);

      case 'SYNC_GROUPS':
        return await this.syncGroups(task.payload || {}, context);

      case 'SYNC_DOMAINS':
        return await this.syncDomains(task.payload || {}, context);

      case 'QUEUE_PROVISIONING':
        return this.queueProvisioning(task.payload || {});

      case 'PROCESS_PROVISIONING_QUEUE':
        return await this.processProvisioningQueue(task.payload || {}, context);

      case 'CREATE_USER':
      case 'SUSPEND_USER':
      case 'CREATE_ALIAS':
      case 'DELETE_ALIAS':
      case 'CREATE_GROUP':
      case 'ADD_GROUP_MEMBER':
      case 'REMOVE_GROUP_MEMBER':
      case 'VERIFY_DOMAIN':
      case 'CONFIGURE_MAIL_ROUTING':
        return await this.workspaceAction(task.action, task.payload || {}, context);

      case 'GOOGLE_WORKSPACE_HEALTH_CHECK':
        return await this.googleWorkspaceHealthCheck();

      case 'GENERATE_GOOGLE_WORKSPACE_REPORT':
        return await this.generateGoogleWorkspaceReport();

      default:
        return await super.run(input, context);
    }
  }

  async executeDomainWork(work = {}, context = {}) {
    const action = String(work.action || 'DOMAIN_TASK').toUpperCase();

    switch (action) {
      case 'SYNC_USERS':
        return await this.syncUsers(work.payload || {}, context);

      case 'SYNC_ALIASES':
        return await this.syncAliases(work.payload || {}, context);

      case 'SYNC_GROUPS':
        return await this.syncGroups(work.payload || {}, context);

      case 'SYNC_DOMAINS':
        return await this.syncDomains(work.payload || {}, context);

      case 'QUEUE_PROVISIONING':
        return this.queueProvisioning(work.payload || {});

      case 'PROCESS_PROVISIONING_QUEUE':
        return await this.processProvisioningQueue(work.payload || {}, context);

      case 'CREATE_USER':
      case 'SUSPEND_USER':
      case 'CREATE_ALIAS':
      case 'DELETE_ALIAS':
      case 'CREATE_GROUP':
      case 'ADD_GROUP_MEMBER':
      case 'REMOVE_GROUP_MEMBER':
      case 'VERIFY_DOMAIN':
      case 'CONFIGURE_MAIL_ROUTING':
        return await this.workspaceAction(action, work.payload || {}, context);

      case 'GOOGLE_WORKSPACE_HEALTH_CHECK':
        return await this.googleWorkspaceHealthCheck();

      case 'GENERATE_GOOGLE_WORKSPACE_REPORT':
        return await this.generateGoogleWorkspaceReport();

      default:
        return {
          ok: false,
          service: this.service,
          workerId: this.workerId,
          status: 'UNSUPPORTED_GOOGLE_WORKSPACE_ACTION',
          action,
          work
        };
    }
  }

  async syncUsers(payload = {}) {
    return await this.syncRegistry({
      payload,
      registryPath: this.userRegistryPath,
      connectorAction: payload.connectorAction || 'listUsers',
      resultKey: 'users',
      normalize: (item, index) => this.normalizeUser(item, index),
      successStatus: 'USERS_SYNCED',
      failureStatus: 'USERS_SYNC_FAILED',
      stateCountKey: 'usersTracked'
    });
  }

  async syncAliases(payload = {}) {
    return await this.syncRegistry({
      payload,
      registryPath: this.aliasRegistryPath,
      connectorAction: payload.connectorAction || 'listAliases',
      resultKey: 'aliases',
      normalize: (item, index) => this.normalizeAlias(item, index),
      successStatus: 'ALIASES_SYNCED',
      failureStatus: 'ALIASES_SYNC_FAILED',
      stateCountKey: 'aliasesTracked'
    });
  }

  async syncGroups(payload = {}) {
    return await this.syncRegistry({
      payload,
      registryPath: this.groupRegistryPath,
      connectorAction: payload.connectorAction || 'listGroups',
      resultKey: 'groups',
      normalize: (item, index) => this.normalizeGroup(item, index),
      successStatus: 'GROUPS_SYNCED',
      failureStatus: 'GROUPS_SYNC_FAILED',
      stateCountKey: 'groupsTracked'
    });
  }

  async syncDomains(payload = {}) {
    return await this.syncRegistry({
      payload,
      registryPath: this.domainRegistryPath,
      connectorAction: payload.connectorAction || 'listDomains',
      resultKey: 'domains',
      normalize: (item, index) => this.normalizeDomain(item, index),
      successStatus: 'DOMAINS_SYNCED',
      failureStatus: 'DOMAINS_SYNC_FAILED',
      stateCountKey: 'domainsTracked'
    });
  }

  async syncRegistry(config = {}) {
    const startedAt = new Date().toISOString();

    try {
      let items = [];

      if (Array.isArray(config.payload[config.resultKey])) {
        items = config.payload[config.resultKey];
      } else {
        const connectorResult = await this.callConnector(
          config.payload.connectorId || this.googleConnectorId,
          config.connectorAction,
          config.payload,
          {
            action: config.successStatus
          }
        );

        if (
          connectorResult &&
          connectorResult.ok &&
          connectorResult.result &&
          Array.isArray(connectorResult.result[config.resultKey])
        ) {
          items = connectorResult.result[config.resultKey];
        }
      }

      const normalized = items.map((item, index) => config.normalize(item, index));

      this.writeJsonArray(config.registryPath, normalized);

      this.googleState[config.stateCountKey] = normalized.length;
      this.googleState.status = config.successStatus;
      this.googleState.lastSyncAt = new Date().toISOString();
      this.googleState.lastError = null;
      this.persistGoogleState();

      const result = {
        ok: true,
        service: this.service,
        workerId: this.workerId,
        status: config.successStatus,
        count: normalized.length,
        items: normalized
      };

      this.appendGoogleLog({
        status: config.successStatus,
        startedAt,
        result
      });

      return result;
    } catch (error) {
      this.googleState.ok = false;
      this.googleState.status = config.failureStatus;
      this.googleState.lastError = error.message;
      this.persistGoogleState();

      const failure = {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: config.failureStatus,
        error: error.message
      };

      this.appendGoogleLog({
        ...failure,
        startedAt
      });

      return failure;
    }
  }

  normalizeUser(user = {}, index = 0) {
    return {
      userId: user.userId || user.id || user.primaryEmail || `user_${index + 1}`,
      primaryEmail: user.primaryEmail || user.email || null,
      name: user.name || user.fullName || user.displayName || null,
      givenName: user.givenName || user.firstName || null,
      familyName: user.familyName || user.lastName || null,
      suspended: Boolean(user.suspended),
      admin: Boolean(user.admin || user.isAdmin),
      aliases: Array.isArray(user.aliases) ? user.aliases : [],
      metadata: user,
      syncedAt: new Date().toISOString()
    };
  }

  normalizeAlias(alias = {}, index = 0) {
    return {
      aliasId: alias.aliasId || alias.id || alias.alias || `alias_${index + 1}`,
      alias: alias.alias || alias.email || null,
      targetEmail: alias.targetEmail || alias.primaryEmail || alias.userEmail || null,
      metadata: alias,
      syncedAt: new Date().toISOString()
    };
  }

  normalizeGroup(group = {}, index = 0) {
    return {
      groupId: group.groupId || group.id || group.email || `group_${index + 1}`,
      email: group.email || null,
      name: group.name || group.displayName || null,
      description: group.description || null,
      membersCount: Number(group.membersCount || group.memberCount || 0),
      metadata: group,
      syncedAt: new Date().toISOString()
    };
  }

  normalizeDomain(domain = {}, index = 0) {
    return {
      domainId: domain.domainId || domain.id || domain.domainName || domain.name || `domain_${index + 1}`,
      domainName: domain.domainName || domain.name || domain.domain || null,
      verified: Boolean(domain.verified || domain.isVerified),
      primary: Boolean(domain.primary || domain.isPrimary),
      metadata: domain,
      syncedAt: new Date().toISOString()
    };
  }

  queueProvisioning(item = {}) {
    const queue = this.readJsonArray(this.provisioningQueuePath);

    const action = String(item.action || item.operation || 'CREATE_USER').toUpperCase();

    const normalized = {
      provisioningId:
        item.provisioningId ||
        item.id ||
        `GOOGLE_PROVISION_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      action,
      email: item.email || item.primaryEmail || null,
      domainName: item.domainName || item.domain || null,
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
    this.writeJsonArray(this.provisioningQueuePath, queue);

    this.googleState.provisioningQueued = queue.length;
    this.googleState.status = 'PROVISIONING_QUEUED';
    this.googleState.lastProvisioningAt = new Date().toISOString();
    this.googleState.lastError = null;
    this.persistGoogleState();

    return {
      ok: true,
      service: this.service,
      workerId: this.workerId,
      status: 'PROVISIONING_QUEUED',
      provisioning: normalized,
      queueLength: queue.length
    };
  }

  async processProvisioningQueue(payload = {}, context = {}) {
    const limit = Number(payload.limit || 1);
    const queue = this.readJsonArray(this.provisioningQueuePath);

    const selected = queue.slice(0, limit);
    const remaining = queue.slice(limit);

    this.writeJsonArray(this.provisioningQueuePath, remaining);

    const results = [];

    for (const item of selected) {
      const result = await this.workspaceAction(item.action, item, context);
      results.push(result);
    }

    this.googleState.provisioningQueued = remaining.length;
    this.persistGoogleState();

    return {
      ok: results.every((result) => result.ok),
      service: this.service,
      workerId: this.workerId,
      status: 'PROVISIONING_QUEUE_PROCESSED',
      processed: results.length,
      remaining: remaining.length,
      results
    };
  }

  async workspaceAction(action, payload = {}, context = {}) {
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
            payload.provisioningId ||
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

      const connectorAction = this.resolveWorkspaceConnectorAction(normalizedAction);

      const connectorResult = await this.callConnector(
        payload.connectorId || this.googleConnectorId,
        connectorAction,
        payload,
        {
          action: normalizedAction,
          context
        }
      );

      const ok = Boolean(connectorResult && connectorResult.ok);

      if (ok) {
        this.googleState.workspaceActionsCompleted += 1;
        this.googleState.status = `${normalizedAction}_COMPLETED`;
        this.googleState.lastError = null;

        if (payload.provisioningId) {
          this.googleState.provisioningCompleted += 1;
        }
      } else {
        this.googleState.workspaceActionsFailed += 1;
        this.googleState.status = `${normalizedAction}_FAILED`;
        this.googleState.lastError =
          connectorResult && connectorResult.error
            ? connectorResult.error
            : `${normalizedAction} failed.`;

        if (payload.provisioningId) {
          this.googleState.provisioningFailed += 1;
        }
      }

      this.googleState.lastWorkspaceActionAt = new Date().toISOString();
      this.googleState.lastProvisioningAt = payload.provisioningId
        ? new Date().toISOString()
        : this.googleState.lastProvisioningAt;
      this.persistGoogleState();

      const result = {
        ok,
        service: this.service,
        workerId: this.workerId,
        status: ok ? `${normalizedAction}_COMPLETED` : `${normalizedAction}_FAILED`,
        action: normalizedAction,
        payload,
        connectorResult
      };

      this.appendGoogleLog({
        ...result,
        startedAt,
        completedAt: new Date().toISOString()
      });

      await this.recordExecutiveEvent({
        eventType: 'GOOGLE_WORKSPACE_ACTION',
        action: normalizedAction,
        status: result.status,
        result
      });

      return result;
    } catch (error) {
      this.googleState.workspaceActionsFailed += 1;
      this.googleState.status = `${normalizedAction}_FAILED`;
      this.googleState.lastError = error.message;
      this.persistGoogleState();

      const failure = {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: `${normalizedAction}_FAILED`,
        action: normalizedAction,
        error: error.message
      };

      this.appendGoogleLog({
        ...failure,
        startedAt,
        failedAt: new Date().toISOString()
      });

      return failure;
    }
  }

  resolveWorkspaceConnectorAction(action) {
    const map = {
      CREATE_USER: 'createUser',
      SUSPEND_USER: 'suspendUser',
      CREATE_ALIAS: 'createAlias',
      DELETE_ALIAS: 'deleteAlias',
      CREATE_GROUP: 'createGroup',
      ADD_GROUP_MEMBER: 'addGroupMember',
      REMOVE_GROUP_MEMBER: 'removeGroupMember',
      VERIFY_DOMAIN: 'verifyDomain',
      CONFIGURE_MAIL_ROUTING: 'configureMailRouting',
      RESET_PASSWORD: 'resetPassword',
      CHANGE_ADMIN_ROLE: 'changeAdminRole'
    };

    return map[action] || 'executeWorkspaceAction';
  }

  async googleWorkspaceHealthCheck() {
    let connectorHealth = {
      ok: false,
      status: 'GOOGLE_WORKSPACE_CONNECTOR_NOT_CHECKED'
    };

    if (this.connectorRuntimeManager && typeof this.connectorRuntimeManager.execute === 'function') {
      connectorHealth = await this.callConnector(
        this.googleConnectorId,
        'healthCheck',
        {},
        {
          action: 'GOOGLE_WORKSPACE_HEALTH_CHECK'
        }
      );
    }

    const users = this.readJsonArray(this.userRegistryPath);
    const aliases = this.readJsonArray(this.aliasRegistryPath);
    const groups = this.readJsonArray(this.groupRegistryPath);
    const domains = this.readJsonArray(this.domainRegistryPath);
    const queue = this.readJsonArray(this.provisioningQueuePath);

    const ok =
      fs.existsSync(this.googleRuntimeDir) &&
      fs.existsSync(this.googleStatePath) &&
      fs.existsSync(this.userRegistryPath) &&
      fs.existsSync(this.aliasRegistryPath) &&
      fs.existsSync(this.groupRegistryPath) &&
      fs.existsSync(this.domainRegistryPath) &&
      fs.existsSync(this.provisioningQueuePath) &&
      fs.existsSync(this.googleExecutionLogPath);

    this.googleState.lastHealthCheckAt = new Date().toISOString();
    this.persistGoogleState();

    return {
      ok,
      service: this.service,
      workerId: this.workerId,
      status: ok ? 'GOOGLE_WORKSPACE_HEALTHY' : 'GOOGLE_WORKSPACE_DEGRADED',
      usersTracked: users.length,
      aliasesTracked: aliases.length,
      groupsTracked: groups.length,
      domainsTracked: domains.length,
      provisioningQueued: queue.length,
      connectorHealth,
      googleState: this.googleState,
      generatedAt: new Date().toISOString()
    };
  }

  async generateGoogleWorkspaceReport() {
    const users = this.readJsonArray(this.userRegistryPath);
    const aliases = this.readJsonArray(this.aliasRegistryPath);
    const groups = this.readJsonArray(this.groupRegistryPath);
    const domains = this.readJsonArray(this.domainRegistryPath);
    const queue = this.readJsonArray(this.provisioningQueuePath);

    const report = {
      ok: true,
      service: this.service,
      workerId: this.workerId,
      status: 'GOOGLE_WORKSPACE_REPORT_READY',
      generatedAt: new Date().toISOString(),
      googleState: this.googleState,
      usersTracked: users.length,
      aliasesTracked: aliases.length,
      groupsTracked: groups.length,
      domainsTracked: domains.length,
      provisioningQueued: queue.length,
      approvalRequiredActions: this.approvalRequiredActions,
      supportedActions: this.supportedActions,
      paths: {
        googleRuntimeDir: this.googleRuntimeDir,
        googleStatePath: this.googleStatePath,
        userRegistryPath: this.userRegistryPath,
        aliasRegistryPath: this.aliasRegistryPath,
        groupRegistryPath: this.groupRegistryPath,
        domainRegistryPath: this.domainRegistryPath,
        provisioningQueuePath: this.provisioningQueuePath,
        googleExecutionLogPath: this.googleExecutionLogPath
      },
      workerState: this.getState()
    };

    fs.writeFileSync(this.googleReportPath, JSON.stringify(report, null, 2), 'utf8');

    this.googleState.lastReportAt = new Date().toISOString();
    this.googleState.status = 'GOOGLE_WORKSPACE_REPORT_READY';
    this.persistGoogleState();

    await this.recordExecutiveEvent({
      eventType: 'GOOGLE_WORKSPACE_REPORT',
      report
    });

    return report;
  }

  async healthCheck() {
    const baseHealth = await super.healthCheck();
    const googleHealth = await this.googleWorkspaceHealthCheck();

    const reportExists = fs.existsSync(this.googleReportPath);

    const ok = baseHealth.ok && googleHealth.ok && reportExists;

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
      googleHealth,
      storage: {
        reportExists
      },
      state: this.getState(),
      googleState: this.googleState
    };
  }

  getMetadata() {
    return {
      ...super.getMetadata(),
      service: this.service,
      version: this.version,
      googleConnectorId: this.googleConnectorId,
      supportedActions: this.supportedActions
    };
  }
}

module.exports = GoogleWorkspaceCOOWorker;