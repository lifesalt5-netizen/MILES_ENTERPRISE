"use strict";

const fs = require("fs");
const path = require("path");

function first(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return null;
}

function unwrap(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.emails)) return value.emails;
  return [];
}

function sentTimestamp(item) {
  return first(item, [
    "timestamp_sent", "sent_at", "sentAt", "timestamp_created", "created_at", "createdAt", "timestamp", "date"
  ]);
}

function easternParts(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return { weekday: map.weekday, hour, minute: Number(map.minute), iso: date.toISOString() };
}

function isInsideP2gcSendWindow(value) {
  const p = easternParts(value);
  if (!p) return { validTimestamp: false, inside: false, reason: "INVALID_TIMESTAMP" };
  const weekday = ["Mon","Tue","Wed","Thu","Fri"].includes(p.weekday);
  const minutes = p.hour * 60 + p.minute;
  const insideClock = minutes >= 8 * 60 && minutes <= 18 * 60;
  return {
    validTimestamp: true,
    inside: weekday && insideClock,
    reason: !weekday ? "WEEKEND" : !insideClock ? "OUTSIDE_0800_1800_ET" : "INSIDE_WINDOW",
    eastern: p
  };
}

async function fetchSentEmails(connector, sinceIso, maxPages = 20) {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < maxPages; page += 1) {
    const payload = { limit: 100, email_type: "sent", min_timestamp_created: sinceIso };
    if (cursor) payload.starting_after = cursor;
    const result = await connector.execute({ action: "listEmails", payload });
    if (!result?.ok) throw new Error(result?.error || "Instantly sent-email history read failed.");
    const envelope = result.emails || result.result || {};
    const items = unwrap(envelope);
    rows.push(...items);
    cursor = envelope?.next_starting_after || envelope?.nextStartingAfter || null;
    if (!cursor || items.length === 0) break;
  }
  return rows;
}

async function run(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, ".."));
  const sinceIso = options.sinceIso || new Date(Date.now() - 24 * 3600000).toISOString();
  const connector = options.connector || require(path.join(rootDir, "CONNECTORS", "INSTANTLY", "connector"));
  const sent = await fetchSentEmails(connector, sinceIso, Number(options.maxPages || 20));
  const evaluated = sent.map(item => {
    const timestamp = sentTimestamp(item);
    const check = isInsideP2gcSendWindow(timestamp);
    return {
      id: String(first(item, ["id","email_uuid","uuid","message_id"]) || ""),
      campaignId: String(first(item, ["campaign_id","campaignId","campaign"]) || ""),
      timestamp: timestamp || null,
      timestampSource: first(item, ["timestamp_sent"]) ? "timestamp_sent" : first(item, ["sent_at","sentAt"]) ? "sent_at" : "fallback_created_or_generic",
      ...check
    };
  });
  const invalidTimestamps = evaluated.filter(row => !row.validTimestamp);
  const violations = evaluated.filter(row => row.validTimestamp && !row.inside);
  const result = {
    ok: invalidTimestamps.length === 0 && violations.length === 0,
    gate: "P2GC_LIVE_SEND_WINDOW_HISTORY",
    generatedAt: new Date().toISOString(),
    sinceIso,
    timeZone: "America/New_York",
    allowedWindow: "Mon-Fri 08:00-18:00",
    sentMessagesInspected: evaluated.length,
    violations: violations.length,
    invalidTimestamps: invalidTimestamps.length,
    violationEvidence: violations.slice(0, 100),
    invalidTimestampEvidence: invalidTimestamps.slice(0, 100),
    readOnly: true,
    instantlyMutated: false
  };
  const outDir = options.outputDir || path.join(rootDir, "DATA", "operational_acceptance", "send_window_history");
  fs.mkdirSync(outDir, { recursive: true });
  result.outputFile = path.join(outDir, "INSTANTLY_SEND_WINDOW_HISTORY_LATEST.json");
  fs.writeFileSync(result.outputFile, JSON.stringify(result, null, 2), "utf8");
  return result;
}

function parse(argv) {
  const since = argv.find(v => v.startsWith("--since="));
  const root = argv.find(v => v.startsWith("--root="));
  return { sinceIso: since ? since.slice(8) : undefined, rootDir: root ? root.slice(7) : undefined };
}

async function main() {
  const result = await run(parse(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { run, fetchSentEmails, sentTimestamp, easternParts, isInsideP2gcSendWindow, unwrap };
