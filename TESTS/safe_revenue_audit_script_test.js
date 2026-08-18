"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "SCRIPTS", "RUN_P2GC_SAFE_REVENUE_AUDIT.ps1");
const source = fs.readFileSync(file, "utf8");

assert(source.includes("git worktree add --detach"), "audit must use a detached worktree");
assert(source.includes('$env:MILES_DRY_RUN = "true"'), "audit must force dry-run mode");
assert(source.includes('$env:MILES_ALLOW_INSTANTLY_MUTATIONS = "false"'), "audit must disable Instantly mutations");
assert(source.includes('$env:MILES_AUTONOMOUS_EXECUTE = "false"'), "audit must disable autonomous execution");
assert(source.includes('$env:CAPTURE_CAPACITY_AUTO_STAGE = "false"'), "audit must disable auto-stage");

for (const runner of [
  "RUN_P2GC_WINBACK_CAMPAIGN.js",
  "RUN_P2GC_REPLY_INTELLIGENCE.js",
  "RUN_CAPTURE_CAPACITY_PROSPECT_DISCOVERY.js",
  "RUN_CAPTURE_CAPACITY_CAMPAIGN.js"
]) {
  assert(source.includes(runner), `missing revenue runner: ${runner}`);
}

const invokeLines = source.split(/\r?\n/).filter(line => line.includes("Invoke-RevenueStep"));
assert(invokeLines.length >= 4, "expected four revenue execution steps");
for (const line of invokeLines) {
  assert(!line.includes("--apply"), "audit execution step may not use --apply");
  assert(!line.includes("--activate"), "audit execution step may not use --activate");
}

assert(!/git\s+reset\s+--hard/i.test(source), "audit may not hard reset production checkout");
assert(!/git\s+rebase/i.test(source), "audit may not rebase production checkout");
assert(!/git\s+merge/i.test(source), "audit may not merge production checkout");
assert(source.includes("Copy-Item") && source.includes(".env"), "audit should safely copy local environment into worktree");
assert(source.includes("Worktree retained for review"), "audit should preserve output worktree for review");

console.log("PASS safe_revenue_audit_script_test");
