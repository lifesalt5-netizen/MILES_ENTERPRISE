'use strict';

const fs = require('fs');
const path = require('path');

const BaseCOOWorker = require('./BaseCOOWorker');

class InstantlyCOOWorker extends BaseCOOWorker {
  constructor(options = {}) {
    super({
      ...options,
      workerId: options.workerId || 'INSTANTLY_COO_WORKER',
      workerName: options.workerName || 'Instantly COO Worker',
      workerType: options.workerType || 'INSTANTLY_COO',
      domain: options.domain || 'INSTANTLY',
      description:
        options.description ||
        'Autonomous COO worker for Instantly campaign operations, segment routing, lead upload orchestration, deliverability monitoring, and outbound execution control.'
    });

    this.service = 'INSTANTLY_COO_WORKER';
    this.version = '1.0.0';

    this.instantlyConnectorId = options.instantlyConnectorId || 'instantly';

    this.instantlyRuntimeDir =
      options.instantlyRuntimeDir ||
      path.join(this.runtimeDir, 'instantly_coo');

    this.instantlyStatePath =
      options.instantlyStatePath ||
      path.join(this.instantlyRuntimeDir, 'instantly_state.json');

    this.segmentInventoryPath =
      options.segmentInventoryPath ||
      path.join(this.instantlyRuntimeDir, 'segment_inventory.json');

    this.campaignRegistryPath =
      options.campaignRegistryPath ||
      path.join(this.instantlyRuntimeDir, 'campaign_registry.json');

    this.leadUploadQueuePath =
      options.leadUploadQueuePath ||
      path.join(this.instantlyRuntimeDir, 'lead_upload_queue.json');

    this.deliverabilityLogPath =
      options.deliverabilityLogPath ||
      path.join(this.instantlyRuntimeDir, 'deliverability_log.jsonl');

    this.instantlyExecutionLogPath =
      options.instantlyExecutionLogPath ||
      path.join(this.instantlyRuntimeDir, 'instantly_execution_log.jsonl');

    this.instantlyReportPath =
      options.instantlyReportPath ||
      path.join(this.instantlyRuntimeDir, 'instantly_report.json');

    this.approvalRequiredActions = Array.from(
      new Set([
        ...this.approvalRequiredActions,
        'SEND_CAMPAIGN',
        'START_CAMPAIGN',
        'RESUME_CAMPAIGN',
        'INCREASE_DAILY_LIMIT',
        'DELETE_CAMPAIGN',
        'DELETE_LEADS',
        'CHANGE_SENDING_DOMAIN',
        'CHANGE_EMAIL_COPY'
      ])
    );

    this.supportedActions = Array.from(
      new Set([
        ...this.supportedActions,
        'SYNC_CAMPAIGNS',
        'SYNC_SEGMENTS',
        'QUEUE_LEAD_UPLOAD',
        'PROCESS_LEAD_UPLOADS',
        'UPLOAD_LEADS',
        'CHECK_DELIVERABILITY',
        'PAUSE_CAMPAIGN',
        'RESUME_CAMPAIGN',
        'START_CAMPAIGN',
        'STOP_CAMPAIGN',
        'GENERATE_INSTANTLY_REPORT',
        'INSTANTLY_HEALTH_CHECK'
      ])
    );

    this.instantlyState = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      segmentsTracked: 0,
      campaignsTracked: 0,
      leadUploadsQueued: 0,
      leadUploadsCompleted: 0,
      leadUploadsFailed: 0,
      deliverabilityChecks: 0,
      campaignsPaused: 0,
      campaignsResumed: 0,
      campaignsStarted: 0,
      campaignsStopped: 0,
      lastSyncAt: null,
      lastUploadAt: null,
      lastDeliverabilityCheckAt: null,
      lastCampaignActionAt: null,
      lastReportAt: null,
      lastError: null,
      generatedAt: new Date().toISOString()
    };

    this.ensureInstantlyStorage();
    this.loadInstantlyState();
  }

  ensureInstantlyStorage() {
    if (!fs.existsSync(this.instantlyRuntimeDir)) {
      fs.mkdirSync(this.instantlyRuntimeDir, { recursive: true });
    }

    if (!fs.existsSync(this.instantlyStatePath)) {
      fs.writeFileSync(this.instantlyStatePath, JSON.stringify(this.instantlyState, null, 2), 'utf8');
    }

    if (!fs.existsSync(this.segmentInventoryPath)) {
      fs.writeFileSync(this.segmentInventoryPath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.campaignRegistryPath)) {
      fs.writeFileSync(this.campaignRegistryPath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.leadUploadQueuePath)) {
      fs.writeFileSync(this.leadUploadQueuePath, JSON.stringify([], null, 2), 'utf8');
    }

    if (!fs.existsSync(this.deliverabilityLogPath)) {
      fs.writeFileSync(this.deliverabilityLogPath, '', 'utf8');
    }

    if (!fs.existsSync(this.instantlyExecutionLogPath)) {
      fs.writeFileSync(this.instantlyExecutionLogPath, '', 'utf8');
    }

    if (!fs.existsSync(this.instantlyReportPath)) {
      fs.writeFileSync(this.instantlyReportPath, JSON.stringify({}, null, 2), 'utf8');
    }
  }

  loadInstantlyState() {
    try {
      if (!fs.existsSync(this.instantlyStatePath)) {
        return;
      }

      const raw = fs.readFileSync(this.instantlyStatePath, 'utf8');

      if (!raw.trim()) {
        return;
      }

      const loaded = JSON.parse(raw);

      this.instantlyState = {
        ...this.instantlyState,
        ...loaded,
        service: this.service,
        version: this.version
      };
    } catch (error) {
      this.instantlyState.ok = false;
      this.instantlyState.status = 'INSTANTLY_STATE_LOAD_FAILED';
      this.instantlyState.lastError = error.message;
      this.persistInstantlyState();
    }
  }

  persistInstantlyState() {
    this.instantlyState.generatedAt = new Date().toISOString();
    fs.writeFileSync(this.instantlyStatePath, JSON.stringify(this.instantlyState, null, 2), 'utf8');
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
      this.instantlyState.ok = false;
      this.instantlyState.status = 'JSON_ARRAY_READ_FAILED';
      this.instantlyState.lastError = error.message;
      this.persistInstantlyState();

      return [];
    }
  }

  writeJsonArray(filePath, value) {
    fs.writeFileSync(filePath, JSON.stringify(Array.isArray(value) ? value : [], null, 2), 'utf8');
  }

  appendInstantlyLog(payload) {
    this.appendJsonLine(this.instantlyExecutionLogPath, {
      ...payload,
      workerId: this.workerId,
      domain: this.domain
    });
  }

  async run(input = {}, context = {}) {
    const task = this.normalizeTask(input);

    switch (task.action) {
      case 'SYNC_CAMPAIGNS':
        return await this.syncCampaigns(task.payload || {}, context);

      case 'SYNC_SEGMENTS':
        return await this.syncSegments(task.payload || {}, context);

      case 'QUEUE_LEAD_UPLOAD':
        return this.queueLeadUpload(task.payload || {});

      case 'PROCESS_LEAD_UPLOADS':
        return await this.processLeadUploads(task.payload || {}, context);

      case 'UPLOAD_LEADS':
        return await this.uploadLeads(task.payload || {}, context);

      case 'CHECK_DELIVERABILITY':
        return await this.checkDeliverability(task.payload || {}, context);

      case 'PAUSE_CAMPAIGN':
        return await this.campaignAction('PAUSE_CAMPAIGN', task.payload || {}, context);

      case 'RESUME_CAMPAIGN':
        return await this.campaignAction('RESUME_CAMPAIGN', task.payload || {}, context);

      case 'START_CAMPAIGN':
        return await this.campaignAction('START_CAMPAIGN', task.payload || {}, context);

      case 'STOP_CAMPAIGN':
        return await this.campaignAction('STOP_CAMPAIGN', task.payload || {}, context);

      case 'GENERATE_INSTANTLY_REPORT':
        return await this.generateInstantlyReport();

      case 'INSTANTLY_HEALTH_CHECK':
        return await this.instantlyHealthCheck();

      default:
        return await super.run(input, context);
    }
  }

  async executeDomainWork(work = {}, context = {}) {
    const action = String(work.action || 'DOMAIN_TASK').toUpperCase();

    switch (action) {
      case 'SYNC_CAMPAIGNS':
        return await this.syncCampaigns(work.payload || {}, context);

      case 'SYNC_SEGMENTS':
        return await this.syncSegments(work.payload || {}, context);

      case 'QUEUE_LEAD_UPLOAD':
        return this.queueLeadUpload(work.payload || {});

      case 'PROCESS_LEAD_UPLOADS':
        return await this.processLeadUploads(work.payload || {}, context);

      case 'UPLOAD_LEADS':
        return await this.uploadLeads(work.payload || {}, context);

      case 'CHECK_DELIVERABILITY':
        return await this.checkDeliverability(work.payload || {}, context);

      case 'PAUSE_CAMPAIGN':
      case 'RESUME_CAMPAIGN':
      case 'START_CAMPAIGN':
      case 'STOP_CAMPAIGN':
        return await this.campaignAction(action, work.payload || {}, context);

      case 'GENERATE_INSTANTLY_REPORT':
        return await this.generateInstantlyReport();

      case 'INSTANTLY_HEALTH_CHECK':
        return await this.instantlyHealthCheck();

      default:
        return {
          ok: false,
          service: this.service,
          workerId: this.workerId,
          status: 'UNSUPPORTED_INSTANTLY_ACTION',
          action,
          work
        };
    }
  }

  async syncCampaigns(payload = {}) {
    const startedAt = new Date().toISOString();

    try {
      const connectorResult = await this.callConnector(
        payload.connectorId || this.instantlyConnectorId,
        payload.connectorAction || 'listCampaigns',
        payload,
        {
          action: 'SYNC_CAMPAIGNS'
        }
      );

      let campaigns = [];

      if (
        connectorResult &&
        connectorResult.ok &&
        connectorResult.result &&
        Array.isArray(connectorResult.result.campaigns)
      ) {
        campaigns = connectorResult.result.campaigns;
      } else if (Array.isArray(payload.campaigns)) {
        campaigns = payload.campaigns;
      }

      const normalized = campaigns.map((campaign, index) => this.normalizeCampaign(campaign, index));

      this.writeJsonArray(this.campaignRegistryPath, normalized);

      this.instantlyState.campaignsTracked = normalized.length;
      this.instantlyState.status = 'CAMPAIGNS_SYNCED';
      this.instantlyState.lastSyncAt = new Date().toISOString();
      this.instantlyState.lastError = null;
      this.persistInstantlyState();

      const result = {
        ok: true,
        service: this.service,
        workerId: this.workerId,
        status: 'CAMPAIGNS_SYNCED',
        campaigns: normalized,
        connectorResult
      };

      this.appendInstantlyLog({
        status: 'CAMPAIGNS_SYNCED',
        startedAt,
        result
      });

      return result;
    } catch (error) {
      this.instantlyState.ok = false;
      this.instantlyState.status = 'CAMPAIGN_SYNC_FAILED';
      this.instantlyState.lastError = error.message;
      this.persistInstantlyState();

      return {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'CAMPAIGN_SYNC_FAILED',
        error: error.message
      };
    }
  }

  normalizeCampaign(campaign = {}, index = 0) {
    return {
      campaignId:
        campaign.campaignId ||
        campaign.id ||
        campaign.uuid ||
        `campaign_${index + 1}`,
      name:
        campaign.name ||
        campaign.title ||
        `Campaign ${index + 1}`,
      status:
        campaign.status ||
        campaign.state ||
        'UNKNOWN',
      segment:
        campaign.segment ||
        campaign.segmentName ||
        campaign.listName ||
        null,
      dailyLimit:
        Number(campaign.dailyLimit || campaign.daily_limit || campaign.limit || 0),
      metadata: campaign,
      syncedAt: new Date().toISOString()
    };
  }

  async syncSegments(payload = {}) {
    const startedAt = new Date().toISOString();

    try {
      let segments = [];

      if (Array.isArray(payload.segments)) {
        segments = payload.segments;
      } else {
        const connectorResult = await this.callConnector(
          payload.connectorId || this.instantlyConnectorId,
          payload.connectorAction || 'listSegments',
          payload,
          {
            action: 'SYNC_SEGMENTS'
          }
        );

        if (
          connectorResult &&
          connectorResult.ok &&
          connectorResult.result &&
          Array.isArray(connectorResult.result.segments)
        ) {
          segments = connectorResult.result.segments;
        }
      }

      const normalized = segments.map((segment, index) => this.normalizeSegment(segment, index));

      this.writeJsonArray(this.segmentInventoryPath, normalized);

      this.instantlyState.segmentsTracked = normalized.length;
      this.instantlyState.status = 'SEGMENTS_SYNCED';
      this.instantlyState.lastSyncAt = new Date().toISOString();
      this.instantlyState.lastError = null;
      this.persistInstantlyState();

      const result = {
        ok: true,
        service: this.service,
        workerId: this.workerId,
        status: 'SEGMENTS_SYNCED',
        segments: normalized
      };

      this.appendInstantlyLog({
        status: 'SEGMENTS_SYNCED',
        startedAt,
        result
      });

      return result;
    } catch (error) {
      this.instantlyState.ok = false;
      this.instantlyState.status = 'SEGMENT_SYNC_FAILED';
      this.instantlyState.lastError = error.message;
      this.persistInstantlyState();

      return {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'SEGMENT_SYNC_FAILED',
        error: error.message
      };
    }
  }

  normalizeSegment(segment = {}, index = 0) {
    return {
      segmentId:
        segment.segmentId ||
        segment.id ||
        segment.name ||
        `segment_${index + 1}`,
      segmentName:
        segment.segmentName ||
        segment.name ||
        `Segment ${index + 1}`,
      leadCount: Number(segment.leadCount || segment.leads || segment.totalLeads || 0),
      verifiedEmailCount: Number(segment.verifiedEmailCount || segment.verifiedEmails || 0),
      campaignStatus: segment.campaignStatus || segment.status || 'UNKNOWN',
      needsEnrichment: Boolean(segment.needsEnrichment),
      needsUpload: Boolean(segment.needsUpload),
      assignedCampaignId: segment.assignedCampaignId || segment.campaignId || null,
      metadata: segment,
      syncedAt: new Date().toISOString()
    };
  }

  queueLeadUpload(upload = {}) {
    const queue = this.readJsonArray(this.leadUploadQueuePath);

    const normalized = {
      uploadId:
        upload.uploadId ||
        upload.id ||
        `LEAD_UPLOAD_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      segmentId: upload.segmentId || upload.segment || null,
      campaignId: upload.campaignId || upload.campaign || null,
      leadsPath: upload.leadsPath || upload.filePath || null,
      leads: Array.isArray(upload.leads) ? upload.leads : [],
      priority: Number(upload.priority || 3),
      confidence:
        typeof upload.confidence === 'number'
          ? upload.confidence
          : 0.9,
      requiresApproval: Boolean(upload.requiresApproval || false),
      status: 'QUEUED',
      queuedAt: new Date().toISOString(),
      metadata: upload.metadata || {}
    };

    queue.push(normalized);
    this.writeJsonArray(this.leadUploadQueuePath, queue);

    this.instantlyState.leadUploadsQueued = queue.length;
    this.instantlyState.status = 'LEAD_UPLOAD_QUEUED';
    this.instantlyState.lastUploadAt = new Date().toISOString();
    this.instantlyState.lastError = null;
    this.persistInstantlyState();

    return {
      ok: true,
      service: this.service,
      workerId: this.workerId,
      status: 'LEAD_UPLOAD_QUEUED',
      upload: normalized,
      queueLength: queue.length
    };
  }

  async processLeadUploads(payload = {}, context = {}) {
    const limit = Number(payload.limit || 1);
    const queue = this.readJsonArray(this.leadUploadQueuePath);

    const selected = queue.slice(0, limit);
    const remaining = queue.slice(limit);

    this.writeJsonArray(this.leadUploadQueuePath, remaining);

    const results = [];

    for (const upload of selected) {
      const result = await this.uploadLeads(upload, context);
      results.push(result);
    }

    this.instantlyState.leadUploadsQueued = remaining.length;
    this.persistInstantlyState();

    return {
      ok: results.every((result) => result.ok),
      service: this.service,
      workerId: this.workerId,
      status: 'LEAD_UPLOAD_QUEUE_PROCESSED',
      processed: results.length,
      remaining: remaining.length,
      results
    };
  }

  async uploadLeads(upload = {}, context = {}) {
    const startedAt = new Date().toISOString();

    try {
      if (upload.requiresApproval) {
        const decision = await this.requestDecision({
          operationId: upload.uploadId,
          operationType: 'UPLOAD_LEADS',
          priority: upload.priority || 3,
          confidence: upload.confidence || 0.9,
          requiresApproval: true,
          payload: upload
        });

        if (!decision || !decision.ok) {
          return {
            ok: false,
            service: this.service,
            workerId: this.workerId,
            status: 'LEAD_UPLOAD_REQUIRES_APPROVAL',
            upload,
            decision
          };
        }
      }

      const connectorResult = await this.callConnector(
        upload.connectorId || this.instantlyConnectorId,
        upload.connectorAction || 'uploadLeads',
        upload,
        {
          action: 'UPLOAD_LEADS',
          context
        }
      );

      const ok = Boolean(connectorResult && connectorResult.ok);

      if (ok) {
        this.instantlyState.leadUploadsCompleted += 1;
        this.instantlyState.status = 'LEADS_UPLOADED';
        this.instantlyState.lastError = null;
      } else {
        this.instantlyState.leadUploadsFailed += 1;
        this.instantlyState.status = 'LEAD_UPLOAD_FAILED';
        this.instantlyState.lastError =
          connectorResult && connectorResult.error
            ? connectorResult.error
            : 'Lead upload failed.';
      }

      this.instantlyState.lastUploadAt = new Date().toISOString();
      this.persistInstantlyState();

      const result = {
        ok,
        service: this.service,
        workerId: this.workerId,
        status: ok ? 'LEADS_UPLOADED' : 'LEAD_UPLOAD_FAILED',
        upload,
        connectorResult
      };

      this.appendInstantlyLog({
        ...result,
        startedAt,
        completedAt: new Date().toISOString()
      });

      return result;
    } catch (error) {
      this.instantlyState.leadUploadsFailed += 1;
      this.instantlyState.status = 'LEAD_UPLOAD_FAILED';
      this.instantlyState.lastError = error.message;
      this.persistInstantlyState();

      return {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'LEAD_UPLOAD_FAILED',
        upload,
        error: error.message
      };
    }
  }

  async checkDeliverability(payload = {}) {
    const startedAt = new Date().toISOString();

    try {
      const connectorResult = await this.callConnector(
        payload.connectorId || this.instantlyConnectorId,
        payload.connectorAction || 'checkDeliverability',
        payload,
        {
          action: 'CHECK_DELIVERABILITY'
        }
      );

      const ok = Boolean(connectorResult && connectorResult.ok);

      const result = {
        ok,
        service: this.service,
        workerId: this.workerId,
        status: ok ? 'DELIVERABILITY_CHECK_COMPLETED' : 'DELIVERABILITY_CHECK_FAILED',
        connectorResult,
        checkedAt: new Date().toISOString()
      };

      this.instantlyState.deliverabilityChecks += 1;
      this.instantlyState.status = result.status;
      this.instantlyState.lastDeliverabilityCheckAt = result.checkedAt;
      this.instantlyState.lastError = ok ? null : result.connectorResult && result.connectorResult.error ? result.connectorResult.error : 'Deliverability check failed.';
      this.persistInstantlyState();

      this.appendJsonLine(this.deliverabilityLogPath, {
        ...result,
        startedAt
      });

      await this.recordExecutiveEvent({
        eventType: 'INSTANTLY_DELIVERABILITY',
        result
      });

      return result;
    } catch (error) {
      this.instantlyState.deliverabilityChecks += 1;
      this.instantlyState.status = 'DELIVERABILITY_CHECK_FAILED';
      this.instantlyState.lastError = error.message;
      this.persistInstantlyState();

      const failure = {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'DELIVERABILITY_CHECK_FAILED',
        error: error.message
      };

      this.appendJsonLine(this.deliverabilityLogPath, {
        ...failure,
        startedAt
      });

      return failure;
    }
  }

  async campaignAction(action, payload = {}, context = {}) {
    const startedAt = new Date().toISOString();

    try {
      const requiresApproval =
        typeof payload.requiresApproval === 'boolean'
          ? payload.requiresApproval
          : this.actionRequiresApproval(action);

      if (requiresApproval) {
        const decision = await this.requestDecision({
          operationId:
            payload.operationId ||
            `${action}_${payload.campaignId || 'UNKNOWN'}_${Date.now()}`,
          operationType: action,
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
            status: `${action}_REQUIRES_APPROVAL`,
            decision
          };
        }
      }

      const connectorAction = this.resolveCampaignConnectorAction(action);

      const connectorResult = await this.callConnector(
        payload.connectorId || this.instantlyConnectorId,
        connectorAction,
        payload,
        {
          action,
          context
        }
      );

      const ok = Boolean(connectorResult && connectorResult.ok);

      this.updateCampaignActionState(action, ok, connectorResult);

      const result = {
        ok,
        service: this.service,
        workerId: this.workerId,
        status: ok ? `${action}_COMPLETED` : `${action}_FAILED`,
        action,
        payload,
        connectorResult
      };

      this.appendInstantlyLog({
        ...result,
        startedAt,
        completedAt: new Date().toISOString()
      });

      return result;
    } catch (error) {
      this.instantlyState.status = `${action}_FAILED`;
      this.instantlyState.lastError = error.message;
      this.persistInstantlyState();

      return {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: `${action}_FAILED`,
        action,
        error: error.message
      };
    }
  }

  resolveCampaignConnectorAction(action) {
    const map = {
      PAUSE_CAMPAIGN: 'pauseCampaign',
      RESUME_CAMPAIGN: 'resumeCampaign',
      START_CAMPAIGN: 'startCampaign',
      STOP_CAMPAIGN: 'stopCampaign'
    };

    return map[action] || 'campaignAction';
  }

  updateCampaignActionState(action, ok, connectorResult) {
    if (action === 'PAUSE_CAMPAIGN' && ok) {
      this.instantlyState.campaignsPaused += 1;
    }

    if (action === 'RESUME_CAMPAIGN' && ok) {
      this.instantlyState.campaignsResumed += 1;
    }

    if (action === 'START_CAMPAIGN' && ok) {
      this.instantlyState.campaignsStarted += 1;
    }

    if (action === 'STOP_CAMPAIGN' && ok) {
      this.instantlyState.campaignsStopped += 1;
    }

    this.instantlyState.status = ok ? `${action}_COMPLETED` : `${action}_FAILED`;
    this.instantlyState.lastCampaignActionAt = new Date().toISOString();
    this.instantlyState.lastError =
      ok
        ? null
        : connectorResult && connectorResult.error
          ? connectorResult.error
          : `${action} failed.`;

    this.persistInstantlyState();
  }

  async instantlyHealthCheck() {
    let connectorHealth = {
      ok: false,
      status: 'INSTANTLY_CONNECTOR_NOT_CHECKED'
    };

    if (this.connectorRuntimeManager && typeof this.connectorRuntimeManager.execute === 'function') {
      connectorHealth = await this.callConnector(
        this.instantlyConnectorId,
        'healthCheck',
        {},
        {
          action: 'INSTANTLY_HEALTH_CHECK'
        }
      );
    }

    const segments = this.readJsonArray(this.segmentInventoryPath);
    const campaigns = this.readJsonArray(this.campaignRegistryPath);
    const uploads = this.readJsonArray(this.leadUploadQueuePath);

    const ok =
      fs.existsSync(this.instantlyRuntimeDir) &&
      fs.existsSync(this.instantlyStatePath) &&
      fs.existsSync(this.segmentInventoryPath) &&
      fs.existsSync(this.campaignRegistryPath) &&
      fs.existsSync(this.leadUploadQueuePath) &&
      fs.existsSync(this.instantlyExecutionLogPath);

    return {
      ok,
      service: this.service,
      workerId: this.workerId,
      status: ok ? 'INSTANTLY_HEALTHY' : 'INSTANTLY_DEGRADED',
      segmentsTracked: segments.length,
      campaignsTracked: campaigns.length,
      leadUploadsQueued: uploads.length,
      connectorHealth,
      instantlyState: this.instantlyState,
      generatedAt: new Date().toISOString()
    };
  }

  async generateInstantlyReport() {
    const segments = this.readJsonArray(this.segmentInventoryPath);
    const campaigns = this.readJsonArray(this.campaignRegistryPath);
    const uploads = this.readJsonArray(this.leadUploadQueuePath);

    const report = {
      ok: true,
      service: this.service,
      workerId: this.workerId,
      status: 'INSTANTLY_REPORT_READY',
      generatedAt: new Date().toISOString(),
      instantlyState: this.instantlyState,
      segmentsTracked: segments.length,
      campaignsTracked: campaigns.length,
      leadUploadsQueued: uploads.length,
      approvalRequiredActions: this.approvalRequiredActions,
      supportedActions: this.supportedActions,
      paths: {
        instantlyRuntimeDir: this.instantlyRuntimeDir,
        instantlyStatePath: this.instantlyStatePath,
        segmentInventoryPath: this.segmentInventoryPath,
        campaignRegistryPath: this.campaignRegistryPath,
        leadUploadQueuePath: this.leadUploadQueuePath,
        deliverabilityLogPath: this.deliverabilityLogPath,
        instantlyExecutionLogPath: this.instantlyExecutionLogPath
      },
      workerState: this.getState()
    };

    fs.writeFileSync(this.instantlyReportPath, JSON.stringify(report, null, 2), 'utf8');

    this.instantlyState.lastReportAt = new Date().toISOString();
    this.instantlyState.status = 'INSTANTLY_REPORT_READY';
    this.persistInstantlyState();

    await this.recordExecutiveEvent({
      eventType: 'INSTANTLY_REPORT',
      report
    });

    return report;
  }

  async healthCheck() {
    const baseHealth = await super.healthCheck();
    const instantlyHealth = await this.instantlyHealthCheck();

    const reportExists = fs.existsSync(this.instantlyReportPath);

    const ok = baseHealth.ok && instantlyHealth.ok && reportExists;

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
      instantlyHealth,
      storage: {
        reportExists
      },
      state: this.getState(),
      instantlyState: this.instantlyState
    };
  }

  getMetadata() {
    return {
      ...super.getMetadata(),
      service: this.service,
      version: this.version,
      instantlyConnectorId: this.instantlyConnectorId,
      supportedActions: this.supportedActions
    };
  }
}

module.exports = InstantlyCOOWorker;