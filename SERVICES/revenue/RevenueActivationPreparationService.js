"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex").toUpperCase();
}

function slug(value) {
  return String(value || "segment").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

class RevenueActivationPreparationService {
  constructor(options = {}) {
    this.service = "REVENUE_ACTIVATION_PREPARATION";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.inputPath = options.inputPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "segment_readiness_reconciliation.json");
    this.outputPath = options.outputPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "activation_preparation_queues.json");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    this.inputProvider = options.inputProvider || (() => JSON.parse(fs.readFileSync(this.inputPath, "utf8").replace(/^\uFEFF/, "")));
  }

  plan() {
    return {
      ok: true,
      service: this.service,
      mode: "PLAN_ONLY",
      status: "PLANNED",
      intendedWrites: [this.outputPath],
      externalMutationsAuthorized: false,
      providerWritesAuthorized: false,
      emailsSent: false,
      leadsUploaded: false,
      campaignsCreated: false,
      campaignsChanged: false
    };
  }

  taskId(type, segmentName) {
    return `${type.toLowerCase()}_${slug(segmentName)}`;
  }

  makeTask(type, segment, dependencies = []) {
    const evidence = {
      sourceFiles: segment.sourceFiles || [],
      sourceFile: segment.sourceFile || null,
      verifiedEmailCount: Number(segment.verifiedEmailCount || 0),
      assignedDomain: segment.assignedDomain || null,
      assignedInboxes: segment.assignedInboxes || [],
      campaignName: segment.campaignName || null,
      liveCampaignId: segment.liveCampaignId || null,
      blockers: segment.blockers || []
    };
    return {
      taskId: this.taskId(type, segment.segmentName),
      taskType: type,
      segmentName: segment.segmentName,
      priority: Number(segment.priority || 99),
      status: "PREPARED_NOT_AUTHORIZED",
      dependsOn: unique(dependencies),
      evidence,
      evidenceHash: sha256(Buffer.from(JSON.stringify(evidence))),
      externalExecutionAuthorized: false
    };
  }

  buildQueues(segments) {
    const queues = {
      sourceRecovery: [],
      emailVerification: [],
      mailboxRouting: [],
      campaignPreparation: []
    };
    for (const segment of segments) {
      const blockers = new Set(segment.blockers || []);
      const sourceTask = blockers.has("SOURCE_FILE_NOT_MAPPED")
        ? this.makeTask("SOURCE_RECOVERY", segment)
        : null;
      if (sourceTask) queues.sourceRecovery.push(sourceTask);

      const verificationDependencies = sourceTask ? [sourceTask.taskId] : [];
      const verificationTask = blockers.has("NO_VERIFIED_EMAILS")
        ? this.makeTask("EMAIL_VERIFICATION", segment, verificationDependencies)
        : null;
      if (verificationTask) queues.emailVerification.push(verificationTask);

      if (blockers.has("INBOXES_NOT_ASSIGNED")) {
        queues.mailboxRouting.push(this.makeTask("MAILBOX_ROUTING", segment));
      }

      if (blockers.has("LIVE_CAMPAIGN_NOT_FOUND") || blockers.has("CAMPAIGN_NOT_MAPPED")) {
        const dependencies = [];
        if (sourceTask) dependencies.push(sourceTask.taskId);
        if (verificationTask) dependencies.push(verificationTask.taskId);
        queues.campaignPreparation.push(this.makeTask("CAMPAIGN_PREPARATION", segment, dependencies));
      }
    }
    for (const queue of Object.values(queues)) {
      queue.sort((left, right) => left.priority - right.priority || left.segmentName.localeCompare(right.segmentName));
    }
    return queues;
  }

  validateQueues(queues) {
    const all = Object.values(queues).flat();
    const ids = new Set(all.map(task => task.taskId));
    const duplicateTaskIds = all.length - ids.size;
    const missingDependencies = all.flatMap(task => task.dependsOn.filter(dependency => !ids.has(dependency)));
    const authorityViolations = all.filter(task => task.externalExecutionAuthorized !== false);
    return {
      ok: duplicateTaskIds === 0 && missingDependencies.length === 0 && authorityViolations.length === 0,
      taskCount: all.length,
      duplicateTaskIds,
      missingDependencies: unique(missingDependencies),
      authorityViolations: authorityViolations.map(task => task.taskId)
    };
  }

  writeAtomic(value) {
    fs.mkdirSync(path.dirname(this.outputPath), { recursive: true });
    const temporary = `${this.outputPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
    fs.renameSync(temporary, this.outputPath);
    return { filePath: this.outputPath, bytes: fs.statSync(this.outputPath).size, sha256: sha256(fs.readFileSync(this.outputPath)) };
  }

  prepare(input = {}) {
    if (input.apply !== true) return this.plan();
    const readiness = this.inputProvider();
    if (readiness?.ok !== true || readiness.status !== "RECONCILED" || !Array.isArray(readiness.segments)) {
      throw new Error("Healthy Gate 3 readiness evidence is required.");
    }
    const queues = this.buildQueues(readiness.segments);
    const validation = this.validateQueues(queues);
    if (!validation.ok) throw new Error("Prepared activation queues failed validation.");
    const report = {
      ok: true,
      service: this.service,
      mode: "APPLY",
      status: "PREPARED",
      generatedAt: this.generatedAt(),
      inputFingerprint: readiness.reconciliationFingerprint || null,
      summary: {
        segments: readiness.segments.length,
        tasks: validation.taskCount,
        sourceRecovery: queues.sourceRecovery.length,
        emailVerification: queues.emailVerification.length,
        mailboxRouting: queues.mailboxRouting.length,
        campaignPreparation: queues.campaignPreparation.length,
        activationReady: readiness.segments.filter(segment => (segment.blockers || []).length === 0).length
      },
      queues,
      validation,
      externalMutationsAuthorized: false,
      providerWritesAuthorized: false,
      emailsSent: false,
      leadsUploaded: false,
      campaignsCreated: false,
      campaignsChanged: false
    };
    const identity = { ...report }; delete identity.generatedAt;
    report.preparationFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    report.artifact = this.writeAtomic(report);
    return report;
  }
}

module.exports = RevenueActivationPreparationService;
module.exports.RevenueActivationPreparationService = RevenueActivationPreparationService;
