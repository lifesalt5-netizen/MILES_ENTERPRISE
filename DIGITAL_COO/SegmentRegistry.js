"use strict";

const fs = require("fs");
const path = require("path");
const logger = require("../../CORE/CANONICAL/Logger");

const ROOT = process.env.MILES_ENTERPRISE_ROOT || process.cwd();

const OUT_DIR = path.join(ROOT, "DATA", "marketing_coo");
const OUT_FILE = path.join(OUT_DIR, "segment_registry_v1.json");

const SEGMENT_ROOTS = [
  "D:\\P2GC_Intelligence\\SAM_Registry\\SAM_PUBLIC_MONTHLY_V2_20260301\\OUT_FILTERED",
  "D:\\P2GC_Intelligence\\SAM_Registry\\SAM_PUBLIC_MONTHLY_V2_20260301\\OUT_FILTERED\\SEGMENTS",
  "D:\\P2GC_Intelligence\\SAM_Registry"
];

const MAX_HEADER_BYTES = 32768;
const MAX_FULL_READ_BYTES = 25 * 1024 * 1024;

function now() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeStat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

function shouldIncludeCsv(file) {
  const t = file.toLowerCase();

  return (
    t.includes("segment") ||
    t.includes("gsa") ||
    t.includes("sam") ||
    t.includes("sbs") ||
    t.includes("va") ||
    t.includes("email") ||
    t.includes("verified") ||
    t.includes("validated") ||
    t.includes("million") ||
    t.includes("outreach") ||
    t.includes("target") ||
    t.includes("prospect") ||
    t.includes("lead")
  );
}

function readHeader(file, sizeBytes) {
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(Math.min(MAX_HEADER_BYTES, sizeBytes || MAX_HEADER_BYTES));
  const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);

  const sample = buffer.toString("utf8", 0, bytes).replace(/^\uFEFF/, "");
  const firstLine = sample.split(/\r?\n/)[0] || "";

  return firstLine
    .split(",")
    .map(h => h.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function countRowsIfSmall(file, sizeBytes) {
  if (sizeBytes > MAX_FULL_READ_BYTES) return null;

  try {
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) return 0;
    return Math.max(0, text.split(/\r?\n/).length - 1);
  } catch {
    return null;
  }
}

function classify(file, name, headers) {
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
    /verified|validated|email_ready|ok_only/i.test(name);

  return {
    category,
    hasEmailColumn,
    verified,
    readyForUpload: hasEmailColumn && verified
  };
}

function scanFiles() {
  const found = [];
  const seen = new Set();

  for (const root of SEGMENT_ROOTS) {
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

        const key = full.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        const name = item.replace(/\.csv$/i, "");
        const headers = readHeader(full, stat.size);
        const exactRows = countRowsIfSmall(full, stat.size);
        const meta = classify(full, name, headers);

        found.push({
          id: name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 80),
          name,
          file: full,
          root,
          category: meta.category,
          headers,
          hasEmailColumn: meta.hasEmailColumn,
          verified: meta.verified,
          readyForUpload: meta.readyForUpload,
          exactRows,
          largeFile: stat.size > MAX_FULL_READ_BYTES,
          sizeBytes: stat.size,
          sizeMB: Math.round((stat.size / 1024 / 1024) * 100) / 100,
          modifiedAt: stat.mtime.toISOString(),
          assignedCampaign: null,
          assignedCampaignId: null,
          uploadStatus: meta.readyForUpload ? "READY_FOR_ASSIGNMENT" : "NOT_VERIFIED",
          nextAction: meta.readyForUpload
            ? "Assign campaign and prepare upload"
            : "Verify email list before upload",
          scannedAt: now()
        });
      }
    }
  }

  return found.sort((a, b) => {
    const ar = a.exactRows || 0;
    const br = b.exactRows || 0;
    return br - ar || b.sizeBytes - a.sizeBytes;
  });
}

function buildSegmentRegistry() {
  ensureDir(OUT_DIR);

  const segments = scanFiles();

  const registry = {
    generatedAt: now(),
    source: "MILES_ENTERPRISE_MARKETING_COO",
    segmentRoots: SEGMENT_ROOTS,
    totals: {
      segments: segments.length,
      readyForUpload: segments.filter(s => s.readyForUpload).length,
      needsVerification: segments.filter(s => !s.readyForUpload).length,
      largeFilesIndexedOnly: segments.filter(s => s.largeFile).length,
      exactRowsKnown: segments.reduce((n, s) => n + (s.exactRows || 0), 0),
      indexedSizeMB: Math.round(
        segments.reduce((n, s) => n + (s.sizeBytes || 0), 0) / 1024 / 1024
      )
    },
    segments
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(registry, null, 2), "utf8");

  logger.info("SEGMENT_REGISTRY_BUILT", registry.totals);

  return registry;
}

module.exports = {
  buildSegmentRegistry
};