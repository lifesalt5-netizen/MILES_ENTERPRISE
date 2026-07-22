"use strict";

const fs = require("fs");
const path = require("path");

const runtime = require("../../CORE/CANONICAL/Runtime");
const taskQueue = require("../../CORE/CANONICAL/TaskQueue");
const logger = require("../../CORE/CANONICAL/Logger");

const ROOT = process.env.MILES_ENTERPRISE_ROOT || process.cwd();

const PATHS = {
  out: path.join(ROOT, "DATA", "marketing_coo"),
  segmentRoots: [
    "D:\\P2GC_Intelligence\\SAM_Registry\\SAM_PUBLIC_MONTHLY_V2_20260301\\OUT_FILTERED",
    "D:\\P2GC_Intelligence\\SAM_Registry\\SAM_PUBLIC_MONTHLY_V2_20260301\\OUT_FILTERED\\SEGMENTS",
    "D:\\P2GC_Intelligence\\SAM_Registry"
  ]
};

const MAX_HEADER_BYTES = 32768;
const MAX_FULL_READ_BYTES = 25 * 1024 * 1024;

function now() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function safeStat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function readCsvMetadata(file) {
  try {
    const stat = fs.statSync(file);

    const fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(Math.min(MAX_HEADER_BYTES, stat.size || MAX_HEADER_BYTES));
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);

    const sample = buffer
      .toString("utf8", 0, bytes)
      .replace(/^\uFEFF/, "");

    const firstLine = sample.split(/\r?\n/)[0] || "";

    const headers = firstLine
      .split(",")
      .map(h => h.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);

    let exactRows = null;

    if (stat.size <= MAX_FULL_READ_BYTES) {
      const text = fs.readFileSync(file, "utf8").trim();
      exactRows = text ? Math.max(0, text.split(/\r?\n/).length - 1) : 0;
    }

    return {
      ok: true,
      headers,
      exactRows,
      estimatedRows: exactRows,
      sizeBytes: stat.size,
      largeFile: stat.size > MAX_FULL_READ_BYTES,
      modifiedAt: stat.mtime.toISOString()
    };

  } catch (err) {
    return {
      ok: false,
      headers: [],
      exactRows: 0,
      estimatedRows: 0,
      sizeBytes: 0,
      largeFile: false,
      modifiedAt: null,
      error: err.message
    };
  }
}

function classifySegment(file, name, headers) {
  const text = `${file} ${name} ${headers.join(" ")}`.toLowerCase();

  let category = "GENERAL";

  if (/gsa/.test(text)) category = "GSA";
  else if (/\bsam\b/.test(text)) category = "SAM";
  else if (/\bsbs\b/.test(text)) category = "SBS";
  else if (/\bva\b|fss/.test(text)) category = "VA";
  else if (/opportunit|rfi|forecast|live/.test(text)) category = "OPPORTUNITY";
  else if (/segment/.test(text)) category = "SEGMENT";

  const hasEmailColumn = headers.some(h => /email/i.test(h));

  const verified =
    /verified|validated|millionverify|million|email_ready|ok_only/i.test(file) ||
    /verified|validated|email_ready/i.test(name);

  return {
    category,
    hasEmailColumn,
    verified,
    readyForUpload: hasEmailColumn && verified
  };
}

function shouldIncludeCsv(file) {
  const lower = file.toLowerCase();

  return (
    lower.includes("segment") ||
    lower.includes("gsa") ||
    lower.includes("sam") ||
    lower.includes("sbs") ||
    lower.includes("va") ||
    lower.includes("email") ||
    lower.includes("verified") ||
    lower.includes("validated") ||
    lower.includes("million") ||
    lower.includes("outreach") ||
    lower.includes("target") ||
    lower.includes("prospect") ||
    lower.includes("lead")
  );
}

function scanSegments() {
  const results = [];
  const seen = new Set();

  for (const root of PATHS.segmentRoots) {
    if (!fs.existsSync(root)) continue;

    const stack = [root];

    while (stack.length) {
      const dir = stack.pop();

      let items = [];

      try {
        items = fs.readdirSync(dir);
      } catch {
        continue;
      }

      for (const item of items) {
        const full = path.join(dir, item);

        const stat = safeStat(full);
        if (!stat) continue;

        if (stat.isDirectory()) {
          stack.push(full);
          continue;
        }

        if (!item.toLowerCase().endsWith(".csv")) continue;
        if (!shouldIncludeCsv(full)) continue;
        if (seen.has(full.toLowerCase())) continue;

        seen.add(full.toLowerCase());

        const name = item.replace(/\.csv$/i, "");
        const meta = readCsvMetadata(full);

        if (!meta.ok) continue;

        const classification = classifySegment(full, name, meta.headers);

        results.push({
          id: name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 80),
          name,
          file: full,
          root,
          sizeBytes: meta.sizeBytes,
          sizeMB: Math.round((meta.sizeBytes / 1024 / 1024) * 100) / 100,
          modifiedAt: meta.modifiedAt,
          exactRows: meta.exactRows,
          estimatedRows: meta.estimatedRows,
          largeFile: meta.largeFile,
          headers: meta.headers,
          category: classification.category,
          hasEmailColumn: classification.hasEmailColumn,
          verified: classification.verified,
          readyForUpload: classification.readyForUpload,
          assignedCampaign: null,
          assignedCampaignId: null,
          status: classification.readyForUpload ? "READY_FOR_CAMPAIGN" : "NEEDS_REVIEW",
          scannedAt: now()
        });
      }
    }
  }

  return results.sort((a, b) => {
    const aRows = a.exactRows ?? 0;
    const bRows = b.exactRows ?? 0;
    return bRows - aRows || b.sizeBytes - a.sizeBytes;
  });
}

async function readInstantly() {
  try {
    const instantly = require("../../CONNECTORS/INSTANTLY/instantly");
    const response = await instantly.listCampaigns();
    const campaigns = response.items || [];

    return {
      ok: true,
      total: campaigns.length,
      active: campaigns.filter(c => c.status === 1).length,
      paused: campaigns.filter(c => c.status !== 1).length,
      campaigns: campaigns.map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        dailyLimit: c.daily_limit || 0,
        created: c.timestamp_created,
        updated: c.timestamp_updated
      }))
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      total: 0,
      active: 0,
      paused: 0,
      campaigns: []
    };
  }
}

function matchSegmentsToCampaigns(segments, campaigns) {
  return segments.map(seg => {
    const segText = seg.name.toLowerCase();

    const match = campaigns.find(c => {
      const cText = String(c.name || "").toLowerCase();

      return (
        (segText.includes("gsa") && cText.includes("gsa")) ||
        (segText.includes("sam") && cText.includes("sam")) ||
        (segText.includes("sbs") && cText.includes("sbs")) ||
        (segText.includes("va") && cText.includes("va")) ||
        cText.includes(segText.slice(0, 12))
      );
    });

    return {
      ...seg,
      assignedCampaign: match ? match.name : null,
      assignedCampaignId: match ? match.id : null
    };
  });
}

function createMarketingWork({ instantly, segments }) {
  const work = [];

  if (!instantly.ok) {
    work.push({
      department: "Marketing",
      priority: 1,
      title: "Fix Instantly API connection",
      requiresKevin: false,
      payload: { error: instantly.error }
    });
  }

  if (instantly.paused > instantly.active) {
    work.push({
      department: "Marketing",
      priority: 1,
      title: "Review paused Instantly campaigns",
      requiresKevin: true,
      payload: {
        activeCampaigns: instantly.active,
        pausedCampaigns: instantly.paused
      }
    });
  }

  const ready = segments.filter(s => s.readyForUpload);
  const unmatchedReady = ready.filter(s => !s.assignedCampaign);

  for (const seg of unmatchedReady.slice(0, 10)) {
    work.push({
      department: "Marketing",
      priority: 2,
      title: `Assign campaign for segment: ${seg.name}`,
      requiresKevin: false,
      payload: {
        segment: seg.name,
        exactRows: seg.exactRows,
        estimatedRows: seg.estimatedRows,
        sizeMB: seg.sizeMB,
        file: seg.file,
        category: seg.category
      }
    });
  }

  for (const seg of ready.filter(s => s.assignedCampaign).slice(0, 10)) {
    work.push({
      department: "Marketing",
      priority: 2,
      title: `Prepare upload: ${seg.name} → ${seg.assignedCampaign}`,
      requiresKevin: false,
      payload: {
        segment: seg.name,
        campaign: seg.assignedCampaign,
        campaignId: seg.assignedCampaignId,
        exactRows: seg.exactRows,
        estimatedRows: seg.estimatedRows,
        sizeMB: seg.sizeMB,
        file: seg.file
      }
    });
  }

  return work;
}

async function runMarketingCOO() {
  runtime.start();

  const instantly = await readInstantly();
  const rawSegments = scanSegments();
  const segments = matchSegmentsToCampaigns(rawSegments, instantly.campaigns);
  const work = createMarketingWork({ instantly, segments });

  for (const item of work) {

    taskQueue.add(
      "WORKFORCE_STEP",
      {
        provider: "MarketingProvider",
        connector: "WORKFORCE",
        department: item.department,
        action: "executeMarketingWork",
        title: item.title,
        requiresKevin: item.requiresKevin,
        ...item.payload
      },
      item.priority || 3
    );

  }

  const brief = {
    generatedAt: now(),
    department: "Marketing COO",
    status: instantly.ok ? "OPERATIONAL" : "DEGRADED",
    instantly: {
      ok: instantly.ok,
      totalCampaigns: instantly.total,
      activeCampaigns: instantly.active,
      pausedCampaigns: instantly.paused,
      error: instantly.error || null
    },
    segments: {
      totalSegments: segments.length,
      readyForUpload: segments.filter(s => s.readyForUpload).length,
      assignedToCampaign: segments.filter(s => s.assignedCampaign).length,
      needsReview: segments.filter(s => s.status === "NEEDS_REVIEW").length,
      largeFilesIndexedOnly: segments.filter(s => s.largeFile).length,
      totalExactRows: segments.reduce((n, s) => n + (s.exactRows || 0), 0),
      totalIndexedSizeMB: Math.round(
        segments.reduce((n, s) => n + (s.sizeBytes || 0), 0) / 1024 / 1024
      )
    },
    workGenerated: {
      total: work.length,
      requiresKevin: work.filter(w => w.requiresKevin).length,
      autonomous: work.filter(w => !w.requiresKevin).length
    },
    topSegments: segments.slice(0, 10).map(s => ({
      name: s.name,
      exactRows: s.exactRows,
      estimatedRows: s.estimatedRows,
      sizeMB: s.sizeMB,
      largeFile: s.largeFile,
      category: s.category,
      hasEmailColumn: s.hasEmailColumn,
      verified: s.verified,
      readyForUpload: s.readyForUpload,
      assignedCampaign: s.assignedCampaign
    })),
    topWork: work.slice(0, 10)
  };

  writeJson(path.join(PATHS.out, "instantly_registry.json"), instantly);
  writeJson(path.join(PATHS.out, "segment_registry.json"), segments);
  writeJson(path.join(PATHS.out, "marketing_work_generated.json"), work);
  writeJson(path.join(PATHS.out, "marketing_executive_brief.json"), brief);

  logger.info("MARKETING_COO_RUN_COMPLETE", brief);

  return brief;
}

module.exports = {
  runMarketingCOO
};
