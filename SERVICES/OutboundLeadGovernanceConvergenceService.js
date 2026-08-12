"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_ROOT = process.env.MILES_ROOT || process.cwd();

const APPROVED_VERIFIED_FILE_PATTERNS = [
  /SBS_FILTERED_TARGETS_OK_ONLY_MILLIONVERIFIER\.csv$/i,
  /SBS_VALIDATED_EMAIL_TARGETS\.csv$/i,
  /MILLIONVERIFIER.*(?:OK|VALID).*\.csv$/i,
  /(?:VERIFIED|VALIDATED).*EMAIL.*\.csv$/i,
  /EMAIL.*(?:VERIFIED|VALIDATED).*\.csv$/i
];

const MASTER_PATTERNS = [
  /MASTER_DEDUPED_ALL_SEGMENTS\.csv$/i,
  /MASTER.*DEDUP.*SEGMENT.*\.csv$/i
];

const SEGMENT_PATTERNS = [
  /EXPIRED_EVERYTHING/i,
  /EXPIRING.*6M/i,
  /EXPIRING.*12M/i,
  /GSA/i,
  /VA(?:_FSS)?/i,
  /SAM/i,
  /SBS/i,
  /HUBZONE/i,
  /WOSB/i,
  /SDVOSB/i,
  /VOSB/i,
  /(?:^|[_-])8A(?:[_-]|\.|$)/i,
  /EIGHT_A/i,
  /STATE/i,
  /SLED/i
];

const REJECTED_VERIFICATION = new Set([
  "invalid", "disposable", "bad", "rejected", "do not mail", "do_not_mail"
]);

function now() { return new Date().toISOString(); }
function norm(v) { return String(v ?? "").trim(); }
function lower(v) { return norm(v).toLowerCase(); }
function compact(v) { return lower(v).replace(/[^a-z0-9]/g, ""); }
function emailNorm(v) { return lower(v); }
function domainFromEmail(v) { const e = emailNorm(v); const at = e.lastIndexOf("@"); return at > 0 ? e.slice(at + 1) : ""; }

function parseCsvLine(line) {
  const values = []; let current = ""; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) { values.push(current); current = ""; }
    else current += ch;
  }
  values.push(current); return values;
}

function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(x => x.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(x => x.trim());
  return lines.slice(1).map(line => {
    const vals = parseCsvLine(line); const row = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
    return row;
  });
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function writeCsv(file, rows, headers) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = [headers.join(","), ...rows.map(r => headers.map(h => csvEscape(r[h])).join(","))].join("\n");
  fs.writeFileSync(file, text, "utf8");
}

function first(row, names, fallback = "") {
  for (const n of names) {
    if (Object.prototype.hasOwnProperty.call(row, n) && norm(row[n])) return row[n];
    const found = Object.keys(row).find(k => lower(k) === lower(n));
    if (found && norm(row[found])) return row[found];
  }
  return fallback;
}

function recordEmail(row) { return emailNorm(first(row, ["email", "email_address", "Email", "Email Address", "contact_email", "business_email"])); }
function recordUei(row) { return compact(first(row, ["uei", "UEI", "unique_entity_id", "Unique Entity ID"])); }
function recordCompanyId(row) { return compact(first(row, ["company_id", "Company ID", "companyid", "entity_id"])); }
function recordCompany(row) { return norm(first(row, ["legal_name", "Legal Name", "company_name", "Company Name", "business_name", "name"])); }
function recordDomain(row) { return lower(first(row, ["domain", "website_domain", "Website Domain"], domainFromEmail(recordEmail(row)))); }
function recordContact(row) { return norm(first(row, ["contact_name", "Contact Name", "name", "first_name", "First Name"])); }
function recordTitle(row) { return norm(first(row, ["contact_title", "Contact Title", "title", "job_title"])); }
function recordPhone(row) { return norm(first(row, ["phone", "Phone", "phone_number"])); }
function recordWebsite(row) { return norm(first(row, ["website", "Website", "url"])); }

function verificationStatus(row, sourceFile) {
  const raw = lower(first(row, ["verification_status", "Verification Status", "email_status", "Email Status", "status", "result", "millionverifier_status"]));
  if (REJECTED_VERIFICATION.has(raw)) return "REJECTED";
  if (/valid|verified|ok|deliverable/.test(raw)) return "VALID";
  if (/accept.?all/.test(raw)) return "ACCEPT_ALL";
  if (/unknown/.test(raw)) return "UNKNOWN";
  if (APPROVED_VERIFIED_FILE_PATTERNS.some(p => p.test(path.basename(sourceFile)))) return "VALID_FILE_ASSERTED";
  return "UNVERIFIED";
}

function isApprovedVerified(status) {
  return ["VALID", "VALID_FILE_ASSERTED", "ACCEPT_ALL", "UNKNOWN"].includes(status);
}

function segmentPriority(name) {
  const s = lower(name).replace(/[^a-z0-9]+/g, " ");
  if (s.includes("expired everything")) return 1;
  if (s.includes("expiring") && /\b6\b/.test(s)) return 2;
  if (s.includes("expiring") && /\b12\b/.test(s)) return 3;
  if (s.includes("gsa") && /no sales|no_sales/.test(lower(name))) return 4;
  if ((s.includes("va") || s.includes("fss")) && /no sales|no_sales/.test(lower(name))) return 5;
  if (s.includes("gsa") && /low|0 500|500k|1m|3m/.test(s)) return 6;
  if ((s.includes("va") || s.includes("fss")) && /low|0 500|500k|1m|3m/.test(s)) return 7;
  if (s.includes("sam") && /no sales|no_sales/.test(lower(name))) return 8;
  if (s.includes("sam") && /low/.test(s)) return 9;
  if (/growth|high growth|10m|5m|3m/.test(s)) return 10;
  if (/hubzone|wosb|sdvosb|vosb|\b8a\b|8 a|eight a/.test(s)) return 11;
  if (s.includes("sbs")) return 12;
  if (s.includes("state") || s.includes("sled")) return 13;
  if (s.includes("gsa")) return 6;
  if (s.includes("va") || s.includes("fss")) return 7;
  if (s.includes("sam")) return 9;
  return 50;
}

function companyKey(row) {
  const uei = recordUei(row); if (uei) return `UEI:${uei}`;
  const cid = recordCompanyId(row); if (cid) return `CID:${cid}`;
  const domain = recordDomain(row); if (domain) return `DOMAIN:${domain}`;
  const company = compact(recordCompany(row)); if (company) return `NAME:${company}`;
  const email = recordEmail(row); return email ? `EMAIL:${email}` : "";
}

function classifyFamily(file, explicit = "") {
  const s = lower(`${explicit} ${path.basename(file)}`);
  if (s.includes("state") || s.includes("sled")) return "SLED";
  return "FEDERAL";
}

function discoverFiles(roots, maxFiles = 15000) {
  const out = []; const seen = new Set();
  const skip = /node_modules|\.git|queue_backups|queue_archives|recovery|backup/i;
  function walk(dir, depth) {
    if (out.length >= maxFiles || depth > 7 || !fs.existsSync(dir)) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= maxFiles) break;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!skip.test(full)) walk(full, depth + 1); }
      else if (/\.csv$/i.test(e.name)) {
        const key = lower(full); if (!seen.has(key)) { seen.add(key); out.push(full); }
      }
    }
  }
  roots.filter(Boolean).forEach(root => walk(root, 0));
  return out;
}

function approvedVerifiedFile(file) { return APPROVED_VERIFIED_FILE_PATTERNS.some(p => p.test(path.basename(file))); }
function masterFile(file) { return MASTER_PATTERNS.some(p => p.test(path.basename(file))); }
function segmentFile(file) { return SEGMENT_PATTERNS.some(p => p.test(path.basename(file))); }

class OutboundLeadGovernanceConvergenceService {
  constructor(options = {}) {
    this.root = options.rootDir || DEFAULT_ROOT;
    this.scanRoots = options.scanRoots || [
      path.join(this.root, "DATA"),
      "C:\\P2GC_Intelligence",
      "D:\\P2GC_Intelligence",
      path.join(process.env.USERPROFILE || "C:\\Users\\lifes", "Downloads")
    ];
    this.outputDir = options.outputDir || path.join(this.root, "DATA", "OUTBOUND", "GOVERNED_LEAD_REPOSITORY");
  }

  run() {
    const files = discoverFiles(this.scanRoots);
    const masters = files.filter(masterFile);
    const verifiedFiles = files.filter(approvedVerifiedFile);
    const segmentFiles = files.filter(segmentFile).filter(f => !/SEGMENT_INVENTORY_MASTER/i.test(f));

    const verifiedByEmail = new Map();
    let rejectedEmails = 0; let rawVerifiedRows = 0;
    for (const file of verifiedFiles) {
      const rows = readCsv(file); rawVerifiedRows += rows.length;
      for (const row of rows) {
        const email = recordEmail(row); if (!email) continue;
        const status = verificationStatus(row, file);
        if (!isApprovedVerified(status)) { rejectedEmails += 1; continue; }
        const existing = verifiedByEmail.get(email);
        const verificationDate = norm(first(row, ["verification_date", "Verification Date", "last_verification_date", "verified_at"]));
        if (!existing || verificationDate >= existing.verificationDate) {
          verifiedByEmail.set(email, { row, sourceFile: file, status, verificationDate });
        }
      }
    }

    const membershipByEmail = new Map();
    const membershipByCompany = new Map();
    for (const file of segmentFiles) {
      const segment = path.basename(file, path.extname(file));
      const priority = segmentPriority(segment);
      const family = classifyFamily(file, segment);
      for (const row of readCsv(file)) {
        const membership = { segment, priority, family, sourceFile: file };
        const email = recordEmail(row);
        const ckey = companyKey(row);
        if (email) {
          const arr = membershipByEmail.get(email) || []; arr.push(membership); membershipByEmail.set(email, arr);
        }
        if (ckey) {
          const arr = membershipByCompany.get(ckey) || []; arr.push(membership); membershipByCompany.set(ckey, arr);
        }
      }
    }

    const routed = []; const emailSeen = new Set(); const duplicateEmails = []; const companies = new Map();
    for (const [email, v] of verifiedByEmail.entries()) {
      if (emailSeen.has(email)) { duplicateEmails.push(email); continue; }
      emailSeen.add(email);
      const ckey = companyKey(v.row) || `EMAIL:${email}`;
      const memberships = [...(membershipByEmail.get(email) || []), ...(membershipByCompany.get(ckey) || [])];
      const uniqueMemberships = [...new Map(memberships.map(m => [`${m.segment}|${m.family}`, m])).values()]
        .sort((a, b) => a.priority - b.priority || a.segment.localeCompare(b.segment));
      const chosen = uniqueMemberships[0] || { segment: "UNASSIGNED", priority: 99, family: "UNKNOWN", sourceFile: "" };

      const record = {
        company_key: ckey,
        uei: recordUei(v.row),
        company_id: recordCompanyId(v.row),
        company_name: recordCompany(v.row),
        contact_name: recordContact(v.row),
        contact_title: recordTitle(v.row),
        email,
        phone: recordPhone(v.row),
        website: recordWebsite(v.row),
        domain: recordDomain(v.row),
        verification_status: v.status,
        verification_date: v.verificationDate,
        verification_source: v.sourceFile,
        assigned_family: chosen.family,
        assigned_segment: chosen.segment,
        segment_priority: chosen.priority,
        assigned_campaign: "",
        assigned_mailbox: "",
        assigned_owner: "MILES",
        campaign_status: chosen.segment === "UNASSIGNED" ? "NEEDS_SEGMENT_ASSIGNMENT" : "READY_FOR_CAMPAIGN_MAPPING",
        all_segment_memberships: uniqueMemberships.map(m => m.segment).join(" | "),
        lead_status: "Ready"
      };
      routed.push(record);
      const carr = companies.get(ckey) || []; carr.push(record); companies.set(ckey, carr);
    }

    // One company -> one assigned segment; preserve all distinct verified contacts at that company.
    for (const [, contacts] of companies.entries()) {
      const best = contacts.slice().sort((a, b) => Number(a.segment_priority) - Number(b.segment_priority))[0];
      for (const contact of contacts) {
        contact.assigned_family = best.assigned_family;
        contact.assigned_segment = best.assigned_segment;
        contact.segment_priority = best.segment_priority;
        contact.campaign_status = best.campaign_status;
      }
    }

    const segmentSummary = new Map();
    for (const row of routed) {
      const key = `${row.assigned_family}|${row.assigned_segment}`;
      const x = segmentSummary.get(key) || { Family: row.assigned_family, Segment_Name: row.assigned_segment, Verified_Email_Count: 0, Unique_Companies: new Set(), Priority: row.segment_priority };
      x.Verified_Email_Count += 1; x.Unique_Companies.add(row.company_key); segmentSummary.set(key, x);
    }
    const summaryRows = [...segmentSummary.values()].map(x => ({
      Family: x.Family,
      Segment_Name: x.Segment_Name,
      Verified_Email_Count: x.Verified_Email_Count,
      Unique_Companies: x.Unique_Companies.size,
      Priority: x.Priority,
      Needs_Upload: x.Segment_Name === "UNASSIGNED" ? "false" : "true",
      Governance_Status: x.Segment_Name === "UNASSIGNED" ? "BLOCKED_UNASSIGNED" : "VERIFIED_DEDUPED_READY_FOR_CAMPAIGN_MAPPING"
    })).sort((a,b) => Number(a.Priority)-Number(b.Priority) || a.Segment_Name.localeCompare(b.Segment_Name));

    fs.mkdirSync(this.outputDir, { recursive: true });
    const headers = ["company_key","uei","company_id","company_name","contact_name","contact_title","email","phone","website","domain","verification_status","verification_date","verification_source","assigned_family","assigned_segment","segment_priority","assigned_campaign","assigned_mailbox","assigned_owner","campaign_status","all_segment_memberships","lead_status"];
    const routedFile = path.join(this.outputDir, "MASTER_GOVERNED_VERIFIED_ROUTING.csv");
    writeCsv(routedFile, routed, headers);
    const summaryFile = path.join(this.outputDir, "VERIFIED_SEGMENT_INVENTORY.csv");
    writeCsv(summaryFile, summaryRows, ["Family","Segment_Name","Verified_Email_Count","Unique_Companies","Priority","Needs_Upload","Governance_Status"]);

    const refreshRegistry = ["GSA","VA_FSS","SAM","SBA_CERTIFICATIONS","SBS_DSBS","FEDERAL_AWARDS","SLED_STATE_LOCAL"].map(source => ({
      source,
      refresh_frequency_days: 30,
      last_refresh: "",
      next_due: "",
      status: "REQUIRES_SOURCE_DATE_DISCOVERY",
      owner: "MILES",
      stale_is_production_failure: true
    }));
    fs.writeFileSync(path.join(this.outputDir, "MONTHLY_REFRESH_REGISTRY.json"), JSON.stringify({ generatedAt: now(), sources: refreshRegistry }, null, 2), "utf8");

    const governance = {
      generatedAt: now(),
      sourceOfTruthHierarchy: ["MASTER_DEDUPED_ALL_SEGMENTS.csv", "VERIFIED_EMAIL_DATABASE", "SEGMENT_FILES", "CAMPAIGN_LISTS", "INSTANTLY"],
      priorityOrder: ["Expired Everything","Expiring 6 Months","Expiring 12 Months","GSA No Sales","VA No Sales","GSA Low Sales","VA Low Sales","SAM No Sales","SAM Low Sales","Growth Segments","Certification Segments","SBS Segments","SLED/State Segments"],
      oneCompanyOneActiveCampaign: true,
      oneEmailOneActiveCampaign: true,
      preserveMultipleVerifiedContactsPerCompany: true,
      liveCampaignsMutated: false,
      inboxPolicy: {
        kevinReceivesOnly: ["HOT_LEADS","MEETING_REQUESTS","QUALIFIED_OPPORTUNITIES","CEO_APPROVAL_ESCALATIONS"],
        autoClassify: ["OOO","HARD_BOUNCE","SOFT_BOUNCE","SPAM_CHALLENGE","UNSUBSCRIBE","GENERIC_AUTOMATED","NURTURE"],
        protectedInboxes: ["kevin@pathways2gc.com","info@pathways2gc.com"]
      }
    };
    fs.writeFileSync(path.join(this.outputDir, "OUTBOUND_GOVERNANCE_MANIFEST.json"), JSON.stringify(governance, null, 2), "utf8");

    const federal = routed.filter(r => r.assigned_family === "FEDERAL");
    const sled = routed.filter(r => r.assigned_family === "SLED");
    const unassigned = routed.filter(r => r.assigned_segment === "UNASSIGNED");
    const result = {
      ok: routed.length > 0,
      gate: "OUTBOUND_LEAD_GOVERNANCE_CONVERGENCE",
      generatedAt: now(),
      scanRoots: this.scanRoots,
      discovered: { csvFiles: files.length, masterFiles: masters, verifiedFiles, segmentFiles: segmentFiles.length },
      counts: { rawVerifiedRows, uniqueApprovedVerifiedEmails: verifiedByEmail.size, rejectedEmails, governedContacts: routed.length, uniqueCompanies: companies.size, federalContacts: federal.length, sledContacts: sled.length, unassignedContacts: unassigned.length, duplicateEmailsSuppressed: duplicateEmails.length },
      outputs: { routedFile, summaryFile, refreshRegistry: path.join(this.outputDir, "MONTHLY_REFRESH_REGISTRY.json"), governanceManifest: path.join(this.outputDir, "OUTBOUND_GOVERNANCE_MANIFEST.json") },
      liveCampaignsMutated: false,
      authoritativeEnoughForCampaignMapping: routed.length > 0 && unassigned.length < routed.length,
      nextAction: routed.length === 0 ? "LOCATE_APPROVED_VERIFIED_EMAIL_FILES" : unassigned.length ? "REVIEW_UNASSIGNED_THEN_MAP_CAMPAIGNS_AND_MAILBOXES" : "MAP_CAMPAIGNS_AND_MAILBOXES_THEN_RUN_INSTANTLY_WRITE_GATE"
    };
    fs.writeFileSync(path.join(this.outputDir, "LATEST_GOVERNANCE_CONVERGENCE.json"), JSON.stringify(result, null, 2), "utf8");
    return result;
  }
}

module.exports = OutboundLeadGovernanceConvergenceService;
module.exports.run = options => new OutboundLeadGovernanceConvergenceService(options).run();
