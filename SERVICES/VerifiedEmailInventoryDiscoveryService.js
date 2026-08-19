"use strict";

const fs = require("fs");
const path = require("path");

const ROOTS = [
  "D:\\P2GC_Intelligence",
  "C:\\P2GC_Intelligence",
  process.cwd()
];

const PREFERRED_NAMES = [
  "MASTER_DEDUPED_ALL_SEGMENTS.csv",
  "SBS_VALIDATED_EMAIL_TARGETS.csv",
  "SBS_FILTERED_TARGETS_OK_ONLY_MILLIONVERIFIER.csv",
  "SBS_SEGMENTED_TARGETS.csv"
];

function norm(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (ch === "," && !quoted) {
      out.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  out.push(current);
  return out;
}

function walk(dir, depth = 0, maxDepth = 7, found = []) {
  if (depth > maxDepth || !fs.existsSync(dir)) return found;

  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/node_modules|\.git|queue_backups|backup/i.test(entry.name)) continue;
      walk(full, depth + 1, maxDepth, found);
      continue;
    }

    if (!entry.isFile() || !/\.csv$/i.test(entry.name)) continue;

    const preferred = PREFERRED_NAMES.some(name => name.toLowerCase() === entry.name.toLowerCase());
    const likely = /segment|target|email|million|verified|lead/i.test(entry.name);

    if (preferred || likely) found.push(full);
  }

  return found;
}

function inspectCsv(filePath) {
  const stat = fs.statSync(filePath);
  const fd = fs.openSync(filePath, "r");
  const maxBytes = Math.min(stat.size, 1024 * 1024);
  const buffer = Buffer.alloc(maxBytes);
  fs.readSync(fd, buffer, 0, maxBytes, 0);
  fs.closeSync(fd);

  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return null;

  const headers = parseCsvLine(lines[0]);
  const normalized = headers.map(norm);

  const ueiIndex = normalized.findIndex(h =>
    h === "uei" ||
    h === "sam_uei" ||
    h === "unique_entity_identifier" ||
    /uei.*unique.*entity|unique.*entity.*identifier/.test(h)
  );

  const emailIndex = normalized.findIndex(h =>
    h === "email" || h === "email_address" || /(^|_)email($|_)/.test(h)
  );

  const verificationIndexes = normalized
    .map((h, index) => ({ h, index }))
    .filter(item => /million|verify|validation|email_status|status/.test(item.h))
    .map(item => item.index);

  const segmentIndexes = normalized
    .map((h, index) => ({ h, index }))
    .filter(item => /segment|tier|primary_segment|revenue_tier/.test(item.h))
    .map(item => item.index);

  let sampledRows = 0;
  let sampledEmail = 0;
  let sampledVerifiedLike = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    sampledRows += 1;

    const email = emailIndex >= 0 ? String(row[emailIndex] || "").trim() : "";
    if (email && /@/.test(email)) sampledEmail += 1;

    if (verificationIndexes.length) {
      const statusText = verificationIndexes
        .map(index => String(row[index] || ""))
        .join(" ")
        .toLowerCase();

      if (/\bok\b|valid|verified|deliverable|good/.test(statusText)) {
        sampledVerifiedLike += 1;
      }
    }
  }

  const preferredRank = PREFERRED_NAMES.findIndex(
    name => name.toLowerCase() === path.basename(filePath).toLowerCase()
  );

  let score = 0;
  if (preferredRank >= 0) score += 100 - preferredRank * 5;
  if (ueiIndex >= 0) score += 30;
  if (emailIndex >= 0) score += 30;
  if (verificationIndexes.length) score += 20;
  if (segmentIndexes.length) score += 10;
  if (sampledEmail > 0) score += 10;
  if (sampledVerifiedLike > 0) score += 10;

  return {
    path: filePath,
    fileName: path.basename(filePath),
    bytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    headers,
    normalizedHeaders: normalized,
    hasUei: ueiIndex >= 0,
    hasEmail: emailIndex >= 0,
    verificationColumns: verificationIndexes.map(index => headers[index]),
    segmentColumns: segmentIndexes.map(index => headers[index]),
    sampledRows,
    sampledEmail,
    sampledVerifiedLike,
    score
  };
}

function run() {
  const candidates = [];
  const seen = new Set();

  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const key = file.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      try {
        const inspected = inspectCsv(file);
        if (inspected) candidates.push(inspected);
      } catch (error) {
        candidates.push({
          path: file,
          error: error.message,
          score: -1
        });
      }
    }
  }

  candidates.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

  const usable = candidates.filter(item =>
    item &&
    !item.error &&
    item.hasEmail &&
    (item.hasUei || (item.segmentColumns || []).length > 0)
  );

  const result = {
    ok: usable.length > 0,
    gate: "VERIFIED_EMAIL_INVENTORY_DISCOVERY",
    scannedRoots: ROOTS,
    candidateCount: candidates.length,
    usableCount: usable.length,
    best: usable[0] || null,
    usable: usable.slice(0, 20),
    candidates: candidates.slice(0, 40),
    liveCampaignsMutated: false,
    canonicalInventoryMutated: false,
    nextAction: usable.length
      ? "VALIDATE_AND_MAP_VERIFIED_EMAILS_TO_ACCEPTED_SEGMENTS"
      : "LOCATE_OR_RESTORE_VERIFIED_EMAIL_SOURCE_FILES"
  };

  const outDir = path.join(process.cwd(), "DATA", "revenue_email_inventory");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "verified_email_inventory_discovery.json");
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");
  result.outFile = outFile;

  return result;
}

module.exports = { run };
