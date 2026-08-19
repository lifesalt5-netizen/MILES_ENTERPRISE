"use strict";

const fs = require("fs");
const path = require("path");
const InstantlyCOOService = require("./digital_coo/InstantlyCOOService");

const ROOT = process.env.MILES_ROOT || process.cwd();
const INVENTORY_FILE = path.join(ROOT, "DATA", "OUTBOUND", "SEGMENT_INVENTORY_MASTER.csv");
const OUTPUT_DIR = path.join(ROOT, "DATA", "revenue_gap_analysis");

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function readCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

function first(row, names, fallback = "") {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name) && String(row[name]).trim() !== "") {
      return row[name];
    }
  }
  return fallback;
}

function number(row, names) {
  const value = Number(String(first(row, names, "0")).replace(/[,$%]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value) {
  return new Set(normalize(value).split(/\s+/).filter(Boolean));
}

function overlapScore(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.max(left.size, right.size);
}

function segmentPriority(name) {
  const text = normalize(name);
  if (text.includes("expired")) return 1;
  if (text.includes("expiring") && text.includes("6")) return 2;
  if (text.includes("expiring") && text.includes("12")) return 3;
  if (text.includes("gsa")) return 4;
  if (text.startsWith("va") || text.includes(" va ")) return 5;
  if (text.includes("sam")) return 6;
  if (/8a|8 a|hubzone|wosb|sdvosb|vosb/.test(text)) return 7;
  if (text.includes("sbs")) return 8;
  return 99;
}

class RevenueCampaignSegmentGapService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || ROOT;
    this.inventoryFile = options.inventoryFile || INVENTORY_FILE;
    this.instantlyCOO = options.instantlyCOO || new InstantlyCOOService({ rootDir: this.rootDir });
  }

  async run() {
    const rows = readCsv(this.inventoryFile);
    const snapshot = await this.instantlyCOO.generateSnapshot();
    const campaigns = Array.isArray(snapshot.campaigns) ? snapshot.campaigns : [];

    const segments = rows.map(row => {
      const name = first(row, ["Segment_Name", "Segment", "segment_name", "Name", "name"], "Unknown");
      const leadCount = number(row, ["Lead_Count", "Total_Leads", "Companies", "company_count", "rows"]);
      const verifiedEmailCount = number(row, ["Verified_Email_Count", "Verified_Emails", "verified_emails", "Email_Ready_Count"]);
      return {
        name,
        leadCount,
        verifiedEmailCount,
        priority: segmentPriority(name),
        sourceFile: first(row, ["Source_File", "SourceFile", "source_file"], null)
      };
    });

    const campaignViews = campaigns.map(campaign => ({
      id: campaign.id || campaign.campaignId || null,
      name: campaign.name || campaign.campaignName || "Unnamed campaign",
      status: campaign.status || campaign.statusLabel || null,
      leadCount: Number(campaign.leadCount || campaign.leads || campaign.totalLeads || 0) || 0,
      health: campaign.health || campaign.healthStatus || null
    }));

    const coverage = segments.map(segment => {
      const ranked = campaignViews
        .map(campaign => ({ campaign, score: overlapScore(segment.name, campaign.name) }))
        .filter(match => match.score > 0)
        .sort((a, b) => b.score - a.score);
      const best = ranked[0] || null;
      const covered = Boolean(best && best.score >= 0.5);
      return {
        ...segment,
        covered,
        matchedCampaign: covered ? best.campaign : null,
        matchScore: covered ? Number(best.score.toFixed(3)) : 0,
        sendReady: segment.verifiedEmailCount > 0,
        blocker: segment.verifiedEmailCount <= 0
          ? "NO_VERIFIED_EMAIL_INVENTORY"
          : covered
            ? null
            : "NO_MATCHING_LIVE_CAMPAIGN"
      };
    });

    const coveredSegments = coverage.filter(x => x.covered);
    const uncoveredSegments = coverage.filter(x => !x.covered);
    const notSendReady = coverage.filter(x => !x.sendReady);

    const orphanCampaigns = campaignViews.filter(campaign => {
      return !coverage.some(segment => {
        const score = overlapScore(segment.name, campaign.name);
        return score >= 0.5;
      });
    });

    const prioritizedGaps = coverage
      .filter(x => x.blocker)
      .sort((a, b) => a.priority - b.priority || b.leadCount - a.leadCount)
      .map(x => ({
        segment: x.name,
        priority: x.priority,
        leadCount: x.leadCount,
        verifiedEmailCount: x.verifiedEmailCount,
        covered: x.covered,
        blocker: x.blocker,
        matchedCampaign: x.matchedCampaign?.name || null
      }));

    const result = {
      ok: true,
      gate: "REVENUE_CAMPAIGN_SEGMENT_GAP_ANALYSIS",
      generatedAt: new Date().toISOString(),
      readOnly: true,
      liveCampaignsMutated: false,
      source: {
        segmentInventoryFile: this.inventoryFile,
        instantlyStatus: snapshot.status || null
      },
      summary: {
        liveCampaigns: campaignViews.length,
        segments: coverage.length,
        coveredSegments: coveredSegments.length,
        uncoveredSegments: uncoveredSegments.length,
        sendReadySegments: coverage.filter(x => x.sendReady).length,
        notSendReadySegments: notSendReady.length,
        orphanCampaigns: orphanCampaigns.length,
        totalSegmentLeads: coverage.reduce((sum, x) => sum + x.leadCount, 0),
        totalVerifiedEmails: coverage.reduce((sum, x) => sum + x.verifiedEmailCount, 0)
      },
      prioritizedGaps,
      coverage,
      orphanCampaigns,
      nextAction: notSendReady.length
        ? "RESTORE_VERIFIED_EMAIL_INVENTORY_AND_MAP_TO_SEGMENTS"
        : uncoveredSegments.length
          ? "BUILD_OR_MAP_MISSING_CAMPAIGNS"
          : "PROCEED_TO_SENDER_CAPACITY_AND_LAUNCH_READINESS"
    };

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const outFile = path.join(OUTPUT_DIR, "latest_revenue_campaign_segment_gap.json");
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");
    result.outFile = outFile;

    return result;
  }
}

module.exports = RevenueCampaignSegmentGapService;
module.exports.run = async options => new RevenueCampaignSegmentGapService(options).run();
