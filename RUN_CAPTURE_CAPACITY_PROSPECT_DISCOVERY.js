"use strict";

const fs = require("fs");
const path = require("path");
const CaptureCapacityProspectDiscoveryService = require("./SERVICES/revenue/CaptureCapacityProspectDiscoveryService");

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find(value => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function splitFiles(value) {
  return String(value || "").split(path.delimiter).map(v => v.trim()).filter(Boolean).map(v => path.resolve(v));
}

function ensureFiles(files, label) {
  for (const file of files) if (!fs.existsSync(file)) throw new Error(`${label} source not found: ${file}`);
  return files;
}

async function main() {
  const contactFiles = ensureFiles(splitFiles(arg("contacts") || process.env.CAPTURE_CAPACITY_CONTACT_SOURCES), "Contact");
  const signalFiles = ensureFiles(splitFiles(arg("signals") || process.env.CAPTURE_CAPACITY_SIGNAL_SOURCES), "Signal");
  const service = new CaptureCapacityProspectDiscoveryService();
  const result = await service.discoverAndHandoff({
    contactFiles,
    signalFiles,
    handoff: !hasFlag("discovery-only"),
    apply: hasFlag("apply"),
    activate: hasFlag("activate"),
    activationApproval: arg("approval") || process.env.CAPTURE_CAPACITY_ACTIVATION_APPROVAL || "",
    dailyLimit: Number(arg("daily-limit") || process.env.CAPTURE_CAPACITY_DAILY_LIMIT || 50),
    maxAudience: Number(arg("max-audience") || process.env.CAPTURE_CAPACITY_MAX_AUDIENCE || 2000)
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, status: "CAPTURE_CAPACITY_PROSPECT_DISCOVERY_FAILED", error: error.message }, null, 2));
  process.exitCode = 1;
});
