"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex").toUpperCase(); }
function normalize(value) { return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }

const ROUTES = [
  { rank: 1, name: "Expired Everything", pattern: /expired everything/i },
  { rank: 2, name: "Expiring GSA 6 Months", pattern: /expiring gsa 6/i },
  { rank: 2, name: "Expiring VA 6 Months", pattern: /expiring va 6/i },
  { rank: 3, name: "Expiring GSA 12 Months", pattern: /expiring gsa 12/i },
  { rank: 3, name: "Expiring VA 12 Months", pattern: /expiring va 12/i },
  { rank: 4, name: "GSA", pattern: /\bgsa\b/i },
  { rank: 5, name: "VA", pattern: /\bva\b|veteran/i },
  { rank: 6, name: "SAM", pattern: /\bsam\b/i },
  { rank: 7, name: "SDVOSB", pattern: /sdvosb/i },
  { rank: 7, name: "VOSB", pattern: /vosb/i },
  { rank: 7, name: "WOSB", pattern: /wosb/i },
  { rank: 7, name: "HUBZone", pattern: /hubzone/i },
  { rank: 7, name: "8(a)", pattern: /\b8a\b|8 a/i },
  { rank: 8, name: "SBS", pattern: /\bsbs\b/i }
];

class RevenueInstantlyActivationPlanService {
  constructor(options = {}) {
    this.service = "REVENUE_INSTANTLY_ACTIVATION_PLAN";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.activationRoot = options.activationRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "verified_segment_activation");
    this.resultsRoot = options.resultsRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "email_verification_results");
    this.masterPath = options.masterPath || path.join(this.activationRoot, "verified_segment_master.jsonl");
    this.activationManifestPath = options.activationManifestPath || path.join(this.activationRoot, "manifest.json");
    this.riskyPath = options.riskyPath || path.join(this.resultsRoot, "risky_blocked.jsonl");
    this.invalidPath = options.invalidPath || path.join(this.resultsRoot, "invalid_do_not_mail.jsonl");
    this.segmentInventoryPath = options.segmentInventoryPath || path.join(this.rootDir, "runtime", "instantly_coo", "segment_inventory.json");
    this.campaignRegistryPath = options.campaignRegistryPath || path.join(this.rootDir, "runtime", "instantly_coo", "campaign_registry.json");
    this.outputPath = options.outputPath || path.join(this.rootDir, "DATA", "runtime", "revenue", "instantly_activation_plan.json");
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
  }

  plan() {
    return { ok: true, service: this.service, mode: "PLAN_ONLY", status: "PLANNED", providerWritesAuthorized: false, leadsUploaded: false, emailsSent: false, campaignsChanged: false };
  }

  loadJson(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("Required JSON file is missing: " + filePath);
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  }

  loadJsonl(filePath) {
    if (!fs.existsSync(filePath)) throw new Error("Required JSONL file is missing: " + filePath);
    return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  }

  route(record) {
    const text = (Array.isArray(record.segments) ? record.segments : [record.primarySegment || ""])
      .join(" | ").replace(/[_-]+/g, " ").replace(/\s+/g, " ");
    return ROUTES.find(item => item.pattern.test(text)) || { rank: 99, name: "Unclassified" };
  }

  findSegment(route, inventory) {
    const target = normalize(route.name);
    return inventory.find(item => {
      const name = normalize(item.segmentName || item.name || item.segmentId);
      return name === target || name.includes(target) || target.includes(name);
    }) || null;
  }

  findCampaign(route, segment, campaigns) {
    if (segment?.liveCampaignId) return campaigns.find(item => String(item.campaignId) === String(segment.liveCampaignId)) || null;
    const target = normalize(segment?.campaignName || route.name);
    return campaigns.find(item => {
      const name = normalize(item.name);
      return name === target || name.includes(target) || target.includes(name);
    }) || null;
  }

  build(input = {}) {
    if (input.apply !== true) return this.plan();
    const manifest = this.loadJson(this.activationManifestPath);
    if (manifest.ok !== true || manifest.status !== "ACTIVATION_INVENTORIES_PREPARED" || manifest.conservation?.ok !== true) throw new Error("Verified activation evidence is unhealthy.");
    const leads = this.loadJsonl(this.masterPath);
    if (leads.length !== Number(manifest.summary.uniqueVerifiedLeads)) throw new Error("Verified master count does not match its manifest.");
    const risky = new Set(this.loadJsonl(this.riskyPath).map(item => normalize(item.email)));
    const invalid = new Set(this.loadJsonl(this.invalidPath).map(item => normalize(item.email)));
    const segments = this.loadJson(this.segmentInventoryPath);
    const campaigns = this.loadJson(this.campaignRegistryPath);
    if (!Array.isArray(segments) || !segments.length) throw new Error("Instantly segment inventory is unavailable.");
    if (!Array.isArray(campaigns)) throw new Error("Instantly campaign registry is invalid.");

    const duplicateEmails = leads.length - new Set(leads.map(item => normalize(item.email))).size;
    if (duplicateEmails) throw new Error("Verified activation master contains duplicate emails.");
    const suppressed = leads.filter(item => risky.has(normalize(item.email)) || invalid.has(normalize(item.email)));
    if (suppressed.length) throw new Error("Verified activation master contains suppressed emails.");

    const routeMap = new Map();
    for (const lead of leads) {
      const route = this.route(lead);
      if (!routeMap.has(route.name)) routeMap.set(route.name, { route, leads: [] });
      routeMap.get(route.name).leads.push(lead);
    }

    const activationRoutes = [];
    for (const { route, leads: routeLeads } of routeMap.values()) {
      const segment = this.findSegment(route, segments);
      const campaign = this.findCampaign(route, segment, campaigns);
      const inboxes = Array.isArray(segment?.assignedInboxes) ? segment.assignedInboxes.filter(Boolean) : [];
      const blockers = [];
      if (route.name === "Unclassified") blockers.push("UNCLASSIFIED_LEADS");
      if (!segment) blockers.push("CANONICAL_SEGMENT_NOT_FOUND");
      if (!campaign) blockers.push("LIVE_CAMPAIGN_NOT_FOUND");
      if (!inboxes.length) blockers.push("SENDING_INBOXES_NOT_ASSIGNED");
      if (segment && segment.blockers?.length) blockers.push(...segment.blockers);
      blockers.push("PROVIDER_DUPLICATE_SUPPRESSION_CHECK_REQUIRED");
      activationRoutes.push({
        priority: route.rank,
        route: route.name,
        verifiedLeads: routeLeads.length,
        sourceFile: manifest.artifacts?.segments?.[leadSegmentName(route, manifest)]?.filePath || null,
        segmentId: segment?.segmentId || null,
        liveCampaignId: campaign?.campaignId || null,
        campaignName: campaign?.name || segment?.campaignName || null,
        campaignStatus: campaign?.status || segment?.campaignStatus || "UNKNOWN",
        assignedDomain: segment?.assignedDomain || null,
        assignedInboxes: inboxes,
        blockers: [...new Set(blockers)].sort(),
        uploadAuthorized: false,
        launchAuthorized: false
      });
    }
    activationRoutes.sort((a, b) => a.priority - b.priority || a.route.localeCompare(b.route));

    const report = {
      ok: true, service: this.service, mode: "APPLY", status: "ACTIVATION_PLAN_PREPARED", generatedAt: this.generatedAt(),
      sourceActivationFingerprint: manifest.activationFingerprint,
      summary: {
        verifiedLeads: leads.length,
        routes: activationRoutes.length,
        routesReadyAfterProviderDuplicateCheck: activationRoutes.filter(item => item.blockers.length === 1 && item.blockers[0] === "PROVIDER_DUPLICATE_SUPPRESSION_CHECK_REQUIRED").length,
        routesWithConfigurationBlockers: activationRoutes.filter(item => item.blockers.some(blocker => blocker !== "PROVIDER_DUPLICATE_SUPPRESSION_CHECK_REQUIRED")).length,
        duplicateEmails,
        suppressedEmails: suppressed.length
      },
      activationRoutes,
      suppression: { riskyBlocked: risky.size, doNotMail: invalid.size, verifiedSuppressionConflicts: suppressed.length },
      providerWritesAuthorized: false, leadsUploaded: false, emailsSent: false, campaignsChanged: false, campaignsLaunched: false
    };
    const identity = { ...report }; delete identity.generatedAt;
    report.planFingerprint = sha256(Buffer.from(JSON.stringify(identity)));
    fs.mkdirSync(path.dirname(this.outputPath), { recursive: true });
    fs.writeFileSync(this.outputPath, JSON.stringify(report, null, 2), "utf8");
    report.artifact = { filePath: this.outputPath, bytes: fs.statSync(this.outputPath).size, sha256: sha256(fs.readFileSync(this.outputPath)) };
    return report;
  }
}

function leadSegmentName(route, manifest) {
  if (manifest.artifacts?.segments?.[route.name]) return route.name;
  if (route.name.startsWith("Expiring ")) return "Expiring 12 Months";
  if (["SDVOSB", "VOSB", "WOSB", "HUBZone", "8(a)"].includes(route.name)) return "Certifications";
  return route.name;
}

module.exports = RevenueInstantlyActivationPlanService;
module.exports.RevenueInstantlyActivationPlanService = RevenueInstantlyActivationPlanService;
module.exports.ROUTES = ROUTES;
