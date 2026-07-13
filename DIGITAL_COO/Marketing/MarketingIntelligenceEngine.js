"use strict";

const fs = require("fs");
const store = require("../../CORE/CANONICAL/EnterpriseStore");

const SAMPLE_BYTES = 512 * 1024;

function parsePayload(row) {
  try { return JSON.parse(row.payload || "{}"); } catch { return {}; }
}

function getSegments() {
  return store.db.prepare("SELECT * FROM segments").all();
}

function readSample(file) {
  try {
    const stat = fs.statSync(file);
    const fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(Math.min(SAMPLE_BYTES, stat.size));
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    return buffer.toString("utf8", 0, bytes).replace(/^\uFEFF/, "");
  } catch {
    return "";
  }
}

function detectColumns(headers) {
  const lower = headers.map(h => String(h || "").toLowerCase());

  return {
    email: headers[lower.findIndex(h => h.includes("email"))] || null,
    status: headers[lower.findIndex(h =>
      h.includes("status") ||
      h.includes("result") ||
      h.includes("verification") ||
      h.includes("valid")
    )] || null,
    company: headers[lower.findIndex(h =>
      h.includes("company") ||
      h.includes("legal") ||
      h.includes("organization")
    )] || null
  };
}

function analyzeSegment(row) {
  const payload = parsePayload(row);
  const file = row.file || payload.file;
  const headers = Array.isArray(payload.headers) ? payload.headers : [];
  const sample = readSample(file);
  const lines = sample.split(/\r?\n/).filter(Boolean).slice(1, 501);
  const cols = detectColumns(headers);

  let emailLike = 0;
  let validLike = 0;
  let invalidLike = 0;

  for (const line of lines) {
    if (/@/.test(line)) emailLike++;

    const t = line.toLowerCase();

    if (
      /\bvalid\b/.test(t) ||
      /\bok\b/.test(t) ||
      /\bdeliverable\b/.test(t) ||
      /\bverified\b/.test(t)
    ) validLike++;

    if (
      /\binvalid\b/.test(t) ||
      /\bbounce\b/.test(t) ||
      /\bundeliverable\b/.test(t) ||
      /\brisky\b/.test(t)
    ) invalidLike++;
  }

  const hasEmailEvidence = Boolean(cols.email) || emailLike > 0;
  const verifiedEvidence =
    Boolean(cols.status) ||
    /verified|validated|millionverify|million|email_ready|ok_only/i.test(file || "") ||
    validLike > 0;

  let readiness = "NEEDS_VERIFICATION";
  let confidence = 30;
  let nextAction = "Verify email list before upload";

  if (!hasEmailEvidence) {
    readiness = "NO_EMAILS";
    confidence = 10;
    nextAction = "Find or enrich email addresses";
  } else if (verifiedEvidence && invalidLike === 0) {
    readiness = "READY_FOR_REVIEW";
    confidence = 70;
    nextAction = "Review sample and approve campaign assignment";
  } else if (verifiedEvidence && invalidLike > 0) {
    readiness = "READY_AFTER_DEDUPE_OR_CLEANUP";
    confidence = 55;
    nextAction = "Clean risky/invalid emails, then prepare upload";
  }

  return {
    id: row.id,
    name: row.name,
    file,
    readiness,
    confidence,
    hasEmailEvidence,
    verifiedEvidence,
    emailColumn: cols.email,
    statusColumn: cols.status,
    sampleRowsChecked: lines.length,
    emailLikeRows: emailLike,
    validSignals: validLike,
    invalidSignals: invalidLike,
    nextAction
  };
}

function updateSegment(analysis) {
  store.db.prepare(`
    UPDATE segments
    SET uploadStatus = ?,
        nextAction = ?,
        verified = ?,
        readyForUpload = ?,
        payload = json_set(
          COALESCE(payload, '{}'),
          '$.marketingIntelligence',
          json(?)
        ),
        updatedAt = ?
    WHERE id = ?
  `).run(
    analysis.readiness,
    analysis.nextAction,
    analysis.verifiedEvidence ? 1 : 0,
    analysis.readiness === "READY_FOR_REVIEW" ? 1 : 0,
    JSON.stringify(analysis),
    new Date().toISOString(),
    analysis.id
  );
}

function runMarketingIntelligence() {
  const segments = getSegments();
  const analyses = segments.map(analyzeSegment);

  for (const a of analyses) updateSegment(a);

  const summary = {
    generatedAt: new Date().toISOString(),
    analyzed: analyses.length,
    readyForReview: analyses.filter(a => a.readiness === "READY_FOR_REVIEW").length,
    readyAfterCleanup: analyses.filter(a => a.readiness === "READY_AFTER_DEDUPE_OR_CLEANUP").length,
    needsVerification: analyses.filter(a => a.readiness === "NEEDS_VERIFICATION").length,
    noEmails: analyses.filter(a => a.readiness === "NO_EMAILS").length,
    topReady: analyses
      .filter(a => a.readiness === "READY_FOR_REVIEW" || a.readiness === "READY_AFTER_DEDUPE_OR_CLEANUP")
      .slice(0, 10),
    storeStats: store.stats()
  };

  store.insertEvent("MARKETING_INTELLIGENCE_RUN", "Marketing", summary);

  return summary;
}

module.exports = { runMarketingIntelligence };
