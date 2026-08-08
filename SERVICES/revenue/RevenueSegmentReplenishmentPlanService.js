"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const ActivationPlanner = require("./RevenueInstantlyActivationPlanService");

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }
function normalize(value) { return String(value || "").trim().toLowerCase(); }

class RevenueSegmentReplenishmentPlanService {
  constructor(options = {}) {
    this.service = "REVENUE_SEGMENT_REPLENISHMENT_PLAN";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.auditPath = options.auditPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "global_instantly_duplicate_audit", "manifest.json");
    this.deferredPath = options.deferredPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "email_verification_batch", "deferred_pending_verification.jsonl");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "segment_replenishment");
    this.outputPath = options.outputPath || path.join(this.outputRoot, "plan.json");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    this.planner = options.planner || new ActivationPlanner({ rootDir: this.rootDir });
  }

  preview(input = {}) {
    return {
      ok: true, service: this.service, mode: "PLAN_ONLY", status: "PLANNED",
      targetPerSegment: Number(input.target || 5000),
      sourceReadsAuthorized: false, sourceWritesAuthorized: false, providerWritesAuthorized: false,
      verificationCreditsUsed: 0, leadsUploaded: 0, emailsSent: false, campaignsLaunched: false
    };
  }

  loadJson(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("Required replenishment evidence is missing: " + filePath);
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  }

  loadJsonl(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("Required replenishment inventory is missing: " + filePath);
    return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  }

  route(record) {
    const provenance = [
      ...(Array.isArray(record.segments) ? record.segments : []),
      ...(Array.isArray(record.sources) ? record.sources : []),
      ...(Array.isArray(record.evidence) ? record.evidence.map(item => item?.sourceFile) : [])
    ].filter(Boolean);
    return this.planner.route({ ...record, segments: [...new Set(provenance)] }).name;
  }

  build(input = {}) {
    if (input.apply !== true) return this.preview(input);
    const target = input.target == null ? 5000 : Number(input.target);
    if (!Number.isInteger(target) || target <= 0) throw new Error("A positive integer segment target is required.");

    const audit = this.loadJson(this.auditPath);
    const deferred = this.loadJsonl(this.deferredPath);
    if (audit.ok !== true || audit.status !== "GLOBAL_DUPLICATE_AUDIT_COMPLETED" || audit.conservation?.ok !== true) throw new Error("Gate 15 global duplicate audit is unhealthy.");
    if (Number(audit.summary.classifiedCandidates) !== 8576 || Number(audit.summary.unclassifiedHeld) !== 2) throw new Error("Gate 15 classified lead totals changed.");
    const deferredEmails = deferred.map(record => normalize(record.email));
    if (deferredEmails.some(email => !email) || new Set(deferredEmails).size !== deferred.length) throw new Error("Deferred verification inventory contains missing or duplicate emails.");

    const pendingByRoute = new Map();
    for (const record of deferred) {
      const route = this.route(record);
      pendingByRoute.set(route, (pendingByRoute.get(route) || 0) + 1);
    }

    const routes = audit.routes.map(route => {
      const verified = Number(route.candidates);
      const pendingVerification = Number(pendingByRoute.get(route.route) || 0);
      const verifiedGap = Math.max(0, target - verified);
      const bestCaseAfterPending = verified + pendingVerification;
      const netNewSourceNeededAtBestCase = Math.max(0, target - bestCaseAfterPending);
      return {
        route: route.route,
        target,
        verified,
        alreadyPresentInInstantly: Number(route.alreadyPresentGlobally),
        safeUploadDelta: Number(route.uploadDelta),
        pendingVerification,
        verifiedGap,
        bestCaseAfterPending,
        netNewSourceNeededAtBestCase,
        replenishmentStatus: verified >= target ? "TARGET_MET" : netNewSourceNeededAtBestCase === 0 ? "VERIFY_EXISTING_PENDING" : "NEW_SOURCE_PULL_REQUIRED",
        sourcePullAuthorized: false,
        verificationAuthorized: false,
        uploadAuthorized: false,
        launchAuthorized: false
      };
    });

    const knownRoutes = new Set(routes.map(route => route.route));
    const sortedPendingRoutes = [...pendingByRoute.entries()].sort(([left], [right]) => left.localeCompare(right));
    const outsidePendingRoutes = sortedPendingRoutes.filter(([route]) => !knownRoutes.has(route));
    const deferredOutsideRoutes = outsidePendingRoutes.reduce((sum, [, count]) => sum + count, 0);
    const report = {
      ok: true, service: this.service, mode: "APPLY_INTERNAL_PLAN", status: "SEGMENT_REPLENISHMENT_PLANNED", generatedAt: this.generatedAt(),
      targetPolicy: {
        defaultVerifiedLeadTargetPerSegment: target,
        onePrimaryRoutePerEmail: true,
        sourceLimitedSegmentsMayRemainBelowTarget: true,
        fullSnapshotAllowedWhenIncrementalSourceUnavailable: true,
        retainOnlyNetNewRecordsAfterGlobalDeduplication: true
      },
      sourceAuditFingerprint: audit.auditFingerprint,
      summary: {
        routes: routes.length,
        targetPerRoute: target,
        aggregateTarget: routes.length * target,
        verified: routes.reduce((sum, route) => sum + route.verified, 0),
        pendingVerification: deferred.length,
        verifiedGap: routes.reduce((sum, route) => sum + route.verifiedGap, 0),
        netNewSourceNeededAtBestCase: routes.reduce((sum, route) => sum + route.netNewSourceNeededAtBestCase, 0),
        routesMeetingTarget: routes.filter(route => route.replenishmentStatus === "TARGET_MET").length,
        routesRequiringVerification: routes.filter(route => route.replenishmentStatus === "VERIFY_EXISTING_PENDING").length,
        routesRequiringNewSources: routes.filter(route => route.replenishmentStatus === "NEW_SOURCE_PULL_REQUIRED").length,
        deferredOutsideConfiguredRoutes: deferredOutsideRoutes,
        pendingRouteCounts: Object.fromEntries(sortedPendingRoutes),
        outsideConfiguredRouteCounts: Object.fromEntries(outsidePendingRoutes)
      },
      routes,
      globalExclusionPolicy: [
        "MILES_MASTER_EMAILS", "PENDING_VERIFICATION_EMAILS", "VERIFIED_EMAILS", "INVALID_EMAILS",
        "RISKY_BLOCKED_EMAILS", "DO_NOT_MAIL_EMAILS", "UNSUBSCRIBED_EMAILS", "ALL_INSTANTLY_CAMPAIGN_EMAILS"
      ],
      acquisitionSequence: [
        "MEASURE_TARGET_SHORTFALL", "PULL_INCREMENTAL_WHEN_SUPPORTED", "OTHERWISE_PULL_AUTHORITATIVE_SNAPSHOT",
        "NORMALIZE_COMPANY_UEI_DOMAIN_EMAIL", "GLOBAL_DEDUPLICATION", "ASSIGN_ONE_PRIMARY_ROUTE",
        "VERIFY_NET_NEW_EMAILS", "PREPARE_GOVERNED_UPLOAD_DELTA"
      ],
      sourceReadsAuthorized: false, sourceWritesAuthorized: false, providerWritesAuthorized: false,
      verificationCreditsUsed: 0, leadsUploaded: 0, emailsSent: false, campaignsChanged: false, campaignsLaunched: false
    };
    if (report.summary.verified !== 8576 || report.summary.pendingVerification !== deferred.length) throw new Error("Replenishment planning conservation failed.");
    const identity = { ...report }; delete identity.generatedAt;
    report.replenishmentFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    fs.mkdirSync(this.outputRoot, { recursive: true });
    fs.writeFileSync(this.outputPath, JSON.stringify(report, null, 2), "utf8");
    report.artifact = { filePath: this.outputPath, bytes: fs.statSync(this.outputPath).size, sha256: sha256(fs.readFileSync(this.outputPath)) };
    return report;
  }
}

module.exports = RevenueSegmentReplenishmentPlanService;
module.exports.RevenueSegmentReplenishmentPlanService = RevenueSegmentReplenishmentPlanService;
