"use strict";

const fs = require("fs");
const path = require("path");
const CaptureCapacityCampaignService = require("./SERVICES/revenue/CaptureCapacityCampaignService");
const CaptureCapacityProspectDiscoveryService = require("./SERVICES/revenue/CaptureCapacityProspectDiscoveryService");

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find(value => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function loadJson(filePath) {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`Candidate file not found: ${resolved}`);
  const parsed = JSON.parse(fs.readFileSync(resolved, "utf8").replace(/^\uFEFF/, ""));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.candidates)) return parsed.candidates;
  if (Array.isArray(parsed.leads)) return parsed.leads;
  throw new Error("Candidate JSON must be an array or contain candidates[]/leads[].");
}

async function main() {
  const candidateFile = arg("candidates") || process.env.CAPTURE_CAPACITY_CANDIDATES;
  const maxAudience = Number(arg("max-audience") || process.env.CAPTURE_CAPACITY_MAX_AUDIENCE || 2000);
  let candidates = loadJson(candidateFile);
  let discovery = null;

  if (!candidates) {
    const discoveryService = new CaptureCapacityProspectDiscoveryService();
    discovery = discoveryService.discover({ maxAudience });
    candidates = discovery.candidates;
  }

  const service = new CaptureCapacityCampaignService();
  const result = await service.execute({
    candidates,
    apply: hasFlag("apply"),
    activate: hasFlag("activate"),
    activationApproval: arg("approval") || process.env.CAPTURE_CAPACITY_ACTIVATION_APPROVAL || "",
    dailyLimit: Number(arg("daily-limit") || process.env.CAPTURE_CAPACITY_DAILY_LIMIT || 50),
    maxAudience
  });

  console.log(JSON.stringify({
    ...result,
    candidateSource: candidateFile ? "EXPLICIT_CANDIDATE_FILE" : "AUTO_DISCOVERY_FEED",
    discovery: discovery ? {
      artifact: discovery.artifact,
      sourceCounts: discovery.sourceCounts,
      campaignGate: discovery.campaignGate,
      nextAction: discovery.nextAction
    } : null
  }, null, 2));

  if (!result.ok) process.exitCode = 2;
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, status: "CAPTURE_CAPACITY_RUN_FAILED", error: error.message }, null, 2));
  process.exitCode = 1;
});
