"use strict";

const fs = require("fs");
const path = require("path");
const refresh = require("../SERVICES/AcceptedOrionSegmentInventoryRefreshService");

const ROOT = process.env.MILES_ROOT || process.cwd();
const inventoryFile = path.join(ROOT, "DATA", "OUTBOUND", "SEGMENT_INVENTORY_MASTER.csv");

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      values.push(current);
      current = "";
    } else current += c;
  }
  values.push(current);
  return values;
}

const refreshResult = refresh.run();
const lines = fs.readFileSync(inventoryFile, "utf8")
  .replace(/^\uFEFF/, "")
  .split(/\r?\n/)
  .filter(Boolean);
const headers = parseCsvLine(lines[0]);
const rows = lines.slice(1).map(line => {
  const values = parseCsvLine(line);
  return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
});

const totalLeads = rows.reduce((sum, row) => sum + Number(row.Lead_Count || 0), 0);
const gsa = rows.filter(row => row.Segment_Name.startsWith("GSA_"));
const va = rows.filter(row => row.Segment_Name.startsWith("VA_FSS_"));

const result = {
  ok: Boolean(
    refreshResult.ok &&
    rows.length === 10 &&
    gsa.length === 5 &&
    va.length === 5 &&
    totalLeads > 0 &&
    refreshResult.liveCampaignsMutated === false
  ),
  gate: "ACCEPTED_ORION_SEGMENT_INVENTORY_REFRESH",
  refresh: refreshResult,
  inventory: {
    rows: rows.length,
    gsaSegments: gsa.length,
    vaSegments: va.length,
    totalLeads,
    verifiedEmails: rows.reduce((sum, row) => sum + Number(row.Verified_Email_Count || 0), 0)
  }
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
