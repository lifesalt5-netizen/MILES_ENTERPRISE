"use strict";

const fs = require("fs");
const path = require("path");
const store = require("../../CORE/CANONICAL/EnterpriseStore");

const ROOT = process.env.MILES_ENTERPRISE_ROOT || process.cwd();

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

function readHeaders(file, sizeBytes) {
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

function scanSegments() {
  const segments = [];
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
        const headers = readHeaders(full, stat.size);
        const exactRows = countRowsIfSmall(full, stat.size);
        const meta = classify(full, name, headers);

        segments.push({
          id: name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 80),
          name,
          category: meta.category,
          file: full,
          exactRows: exactRows || 0,
          verified: meta.verified,
          readyForUpload: meta.readyForUpload,
          assignedCampaign: null,
          uploadStatus: meta.readyForUpload ? "READY_FOR_ASSIGNMENT" : "NOT_VERIFIED",
          nextAction: meta.readyForUpload
            ? "Assign campaign and prepare upload"
            : "Verify email list before upload",
          hasEmailColumn: meta.hasEmailColumn,
          sizeBytes: stat.size,
          sizeMB: Math.round((stat.size / 1024 / 1024) * 100) / 100,
          largeFile: stat.size > MAX_FULL_READ_BYTES,
          headers,
          modifiedAt: stat.mtime.toISOString(),
          scannedAt: now()
        });
      }
    }
  }

  return segments.sort((a, b) => b.exactRows - a.exactRows || b.sizeBytes - a.sizeBytes);
}

function importSegments() {
  const segments = scanSegments();

  for (const segment of segments) {
    store.upsertSegment(segment);
  }

  store.insertEvent("SEGMENTS_IMPORTED", "Marketing", {
    imported: segments.length,
    readyForUpload: segments.filter(s => s.readyForUpload).length,
    needsVerification: segments.filter(s => !s.readyForUpload).length
  });

  return {
    generatedAt: now(),
    imported: segments.length,
    readyForUpload: segments.filter(s => s.readyForUpload).length,
    needsVerification: segments.filter(s => !s.readyForUpload).length,
    largeFilesIndexedOnly: segments.filter(s => s.largeFile).length,
    exactRowsKnown: segments.reduce((n, s) => n + (s.exactRows || 0), 0),
    topSegments: segments.slice(0, 10).map(s => ({
      name: s.name,
      category: s.category,
      exactRows: s.exactRows,
      sizeMB: s.sizeMB,
      hasEmailColumn: s.hasEmailColumn,
      verified: s.verified,
      readyForUpload: s.readyForUpload,
      nextAction: s.nextAction
    })),
    storeStats: store.stats()
  };
}

module.exports = {
  importSegments
};
