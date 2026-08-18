"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const CAMPAIGN_KEY = "P2GC_CAPTURE_CAPACITY_2026Q3";
const DEFAULT_MAX_AUDIENCE = 2000;
const DEFAULT_DAILY_LIMIT = 50;

function clean(value) {
  return String(value ?? "").trim();
}

function envBool(env, name, fallback = false) {
  const raw = env?.[name];
  if (raw === undefined || raw === null || clean(raw) === "") return fallback;
  return ["1", "true", "yes", "on", "enabled"].includes(clean(raw).toLowerCase());
}

function stableTrigger(trigger = {}) {
  return {
    type: clean(trigger.type || trigger.trigger || trigger.name).toUpperCase(),
    evidence: clean(trigger.evidence || trigger.summary || trigger.detail || trigger.value),
    source: clean(trigger.source || trigger.url || trigger.source_name)
  };
}

class CaptureCapacityAutonomousExecutionService {
  constructor(options = {}) {
    this.rootDir = path.resolve(
      options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", "..")
    );
    this.env = options.env || process.env;
    this.discoveryService = options.discoveryService || null;
    this.campaignService = options.campaignService || null;
    this.now = options.now || (() => new Date());
    this.stateFile = options.stateFile || path.join(
      this.rootDir,
      "DATA",
      "runtime",
      "revenue",
      "capture_capacity",
      "capture_capacity_autonomous_state.json"
    );
  }

  getDiscoveryService() {
    if (this.discoveryService) return this.discoveryService;
    const Discovery = require("./CaptureCapacityProspectDiscoveryService");
    this.discoveryService = new Discovery({ rootDir: this.rootDir });
    return this.discoveryService;
  }

  getCampaignService() {
    if (this.campaignService) return this.campaignService;
    const Campaign = require("./CaptureCapacityCampaignService");
    this.campaignService = new Campaign({ rootDir: this.rootDir });
    return this.campaignService;
  }

  policy() {
    const autoStageEnabled = envBool(this.env, "CAPTURE_CAPACITY_AUTO_STAGE", true);
    const instantlyWriteEnabled = envBool(this.env, "INSTANTLY_WRITE_ENABLED", false);

    return {
      autoStageEnabled,
      instantlyWriteEnabled,
      apply: autoStageEnabled && instantlyWriteEnabled,
      autoActivate: false,
      activationPolicy: "NEVER_AUTO_ACTIVATE"
    };
  }

  readState() {
    try {
      if (!fs.existsSync(this.stateFile)) return null;
      return JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
    } catch {
      return null;
    }
  }

  writeState(state) {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
    const temporary = `${this.stateFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(temporary, this.stateFile);
    return this.stateFile;
  }

  fingerprint(candidates = []) {
    const normalized = (Array.isArray(candidates) ? candidates : [])
      .map(candidate => ({
        email: clean(candidate.email || candidate.contact).toLowerCase(),
        company: clean(candidate.company || candidate.company_name || candidate.companyName).toLowerCase(),
        triggers: (Array.isArray(candidate.triggers) ? candidate.triggers : [])
          .map(stableTrigger)
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      }))
      .sort((a, b) => `${a.email}|${a.company}`.localeCompare(`${b.email}|${b.company}`));

    return crypto
      .createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex");
  }

  async refreshExistingDraft({ campaignId, candidates, maxAudience }) {
    const campaignService = this.getCampaignService();

    if (
      typeof campaignService.prepareAudience !== "function" ||
      typeof campaignService.buildLeadPayload !== "function" ||
      typeof campaignService.getConnector !== "function"
    ) {
      return {
        ok: false,
        status: "EXISTING_DRAFT_REFRESH_NOT_SUPPORTED",
        leadsUploaded: 0
      };
    }

    const audience = campaignService.prepareAudience(candidates, { maxAudience });
    const leads = audience.eligible.map(item => campaignService.buildLeadPayload(item, campaignId));

    if (leads.length === 0) {
      return {
        ok: false,
        status: "NO_ELIGIBLE_LEADS_FOR_EXISTING_DRAFT",
        leadsUploaded: 0
      };
    }

    const connector = campaignService.getConnector();
    const uploadResult = await connector.execute({
      action: "uploadLeads",
      payload: { campaignId, leads }
    }, { reason: `${CAMPAIGN_KEY}:AUTONOMOUS_DRAFT_REFRESH` });

    return {
      ok: Boolean(uploadResult?.ok),
      status: uploadResult?.ok ? "EXISTING_DRAFT_REFRESHED" : "EXISTING_DRAFT_REFRESH_FAILED",
      leadsAttempted: leads.length,
      leadsUploaded: Number(uploadResult?.uploaded || uploadResult?.result?.uploaded || 0),
      uploadResult
    };
  }

  async execute(input = {}) {
    const workItem = input.workItem || {};
    const capability = clean(workItem.capability || input.capability);

    if (capability && capability !== "revenue.capture_capacity_handoff") {
      return {
        ok: false,
        status: "UNSUPPORTED_CAPABILITY",
        capability
      };
    }

    const policy = this.policy();
    const maxAudience = Math.min(
      DEFAULT_MAX_AUDIENCE,
      Math.max(1, Number(input.maxAudience || this.env.CAPTURE_CAPACITY_MAX_AUDIENCE || DEFAULT_MAX_AUDIENCE))
    );
    const dailyLimit = Math.max(
      1,
      Number(input.dailyLimit || this.env.CAPTURE_CAPACITY_DAILY_LIMIT || DEFAULT_DAILY_LIMIT)
    );

    const discovery = this.getDiscoveryService().discover({ maxAudience });
    const candidates = Array.isArray(discovery?.candidates) ? discovery.candidates : [];

    if (candidates.length === 0) {
      return {
        ok: false,
        status: "NO_QUALIFIED_PROSPECTS",
        capability: "revenue.capture_capacity_handoff",
        campaignKey: CAMPAIGN_KEY,
        policy,
        discovery: {
          artifact: discovery?.artifact || null,
          sourceCounts: discovery?.sourceCounts || {},
          campaignGate: discovery?.campaignGate || null,
          nextAction: discovery?.nextAction || null
        },
        campaign: null,
        generatedAt: this.now().toISOString()
      };
    }

    const prospectFingerprint = this.fingerprint(candidates);
    const previousState = this.readState();

    if (
      policy.apply &&
      previousState?.campaignKey === CAMPAIGN_KEY &&
      previousState?.campaignId &&
      previousState?.staged === true
    ) {
      if (previousState.prospectFingerprint === prospectFingerprint) {
        return {
          ok: true,
          status: "ALREADY_STAGED",
          capability: "revenue.capture_capacity_handoff",
          campaignKey: CAMPAIGN_KEY,
          campaignId: previousState.campaignId,
          qualifiedCount: candidates.length,
          prospectFingerprint,
          policy,
          stateFile: this.stateFile,
          generatedAt: this.now().toISOString()
        };
      }

      const refresh = await this.refreshExistingDraft({
        campaignId: previousState.campaignId,
        candidates,
        maxAudience
      });

      if (refresh.ok) {
        const updatedState = {
          ...previousState,
          prospectFingerprint,
          qualifiedCount: candidates.length,
          lastRefreshAt: this.now().toISOString(),
          lastRefreshStatus: refresh.status,
          lastLeadsUploaded: refresh.leadsUploaded
        };
        this.writeState(updatedState);
      }

      return {
        ok: refresh.ok,
        status: refresh.status,
        capability: "revenue.capture_capacity_handoff",
        campaignKey: CAMPAIGN_KEY,
        campaignId: previousState.campaignId,
        qualifiedCount: candidates.length,
        prospectFingerprint,
        policy,
        refresh,
        stateFile: this.stateFile,
        generatedAt: this.now().toISOString()
      };
    }

    const campaign = await this.getCampaignService().execute({
      candidates,
      apply: policy.apply,
      activate: false,
      dailyLimit,
      maxAudience
    });

    const staged = Boolean(
      policy.apply &&
      campaign?.campaignCreated === true &&
      campaign?.campaignId &&
      campaign?.campaignActivated !== true
    );

    if (staged) {
      this.writeState({
        campaignKey: CAMPAIGN_KEY,
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName || null,
        prospectFingerprint,
        qualifiedCount: candidates.length,
        staged: true,
        activated: false,
        stagedAt: this.now().toISOString(),
        campaignStatus: campaign.status || "CAMPAIGN_PREPARED_DRAFT"
      });
    }

    const status = staged
      ? "CAMPAIGN_STAGED_DRAFT"
      : !policy.apply
        ? "READY_WRITE_GATE_DISABLED"
        : campaign?.status || "CAMPAIGN_STAGE_FAILED";

    return {
      ok: !policy.apply ? true : Boolean(campaign?.ok),
      status,
      capability: "revenue.capture_capacity_handoff",
      campaignKey: CAMPAIGN_KEY,
      campaignId: campaign?.campaignId || null,
      qualifiedCount: candidates.length,
      prospectFingerprint,
      policy,
      discovery: {
        artifact: discovery?.artifact || null,
        sourceCounts: discovery?.sourceCounts || {},
        campaignGate: discovery?.campaignGate || null,
        nextAction: discovery?.nextAction || null
      },
      campaign: {
        status: campaign?.status || null,
        mode: campaign?.mode || null,
        campaignCreated: Boolean(campaign?.campaignCreated),
        leadsUploaded: Number(campaign?.leadsUploaded || 0),
        campaignActivated: Boolean(campaign?.campaignActivated),
        artifact: campaign?.artifact || null
      },
      stateFile: staged ? this.stateFile : null,
      generatedAt: this.now().toISOString()
    };
  }
}

module.exports = new CaptureCapacityAutonomousExecutionService();
module.exports.CaptureCapacityAutonomousExecutionService = CaptureCapacityAutonomousExecutionService;
module.exports.helpers = { clean, envBool, stableTrigger };
