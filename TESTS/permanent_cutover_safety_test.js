"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "SCRIPTS", "RUN_MILES_PERMANENT_PRODUCTION_CUTOVER_PM2_WINDOWS.ps1"), "utf8");

assert([...Buffer.from(script,"utf8")].every(b => b < 0x80), "Permanent cutover script must remain ASCII-only for Windows PowerShell safety");
assert(/Candidate HEAD mismatch/i.test(script), "Cutover must enforce exact candidate commit");
assert(/Candidate node_modules missing/i.test(script), "Cutover must require installed dependencies");
assert(/Candidate source\/control files changed/i.test(script), "Cutover must reject source drift after rehearsal");
assert(/pm2\s+stop\s+\$app\.pm_id/i.test(script), "Cutover must stop resolved PM2 entries by exact id");
assert(/pm2\s+restart\s+\$app\.pm_id/i.test(script), "Cutover must restart resolved PM2 entries by exact id");
assert(/\$liveEnv\s*=\s*Join-Path\s+\$LiveRoot\s+'\.env'/i.test(script), "Cutover must resolve live .env explicitly");
assert(/\$rollbackEnv\s*=\s*Join-Path\s+\$rollbackRoot\s+'\.env'/i.test(script), "Cutover must resolve rollback .env explicitly");
assert(/Copy-Item\s+-LiteralPath\s+\$rollbackEnv\s+-Destination\s+\$newLiveEnv\s+-Force/i.test(script), "Cutover must preserve live .env after promotion");
assert(/MIGRATE_STATE_ATOMIC/i.test(script), "Cutover must use the atomic state migration phase");
assert(/Move-Item\s+-LiteralPath\s+\$rollbackData\s+-Destination\s+\$newLiveData/i.test(script), "Cutover must move authoritative live DATA intact into new production");
assert(/Move-Item\s+-LiteralPath\s+\$currentLiveData\s+-Destination\s+\$rollbackData/i.test(script), "Rollback must restore authoritative DATA to the prior installation");
assert(/candidateDataPark/i.test(script), "Candidate baseline DATA must be parked rather than destroyed");
assert(!/\brobocopy\b/i.test(script), "Permanent cutover must not use robocopy for DATA migration");
assert(/config_overlay_performed=\$false/i.test(script), "Cutover must certify deferred CONFIG is not overlaid");
assert(/Rename-Item[^\n]+\$LiveRoot/i.test(script), "Cutover must preserve old live installation via rename");
assert(/automatic rollback starting/i.test(script), "Cutover must contain automatic rollback path");
assert(/ready_for_daily_use/i.test(script), "Cutover must require production acceptance readiness");
assert(/AUDIT_MILES_PRODUCTION_ACCEPTANCE\.ps1/i.test(script), "Cutover must run production acceptance after switching");
assert(!/\bgit\s+(?:reset|clean|rebase|push)\b/i.test(script), "Permanent cutover must not use destructive Git operations");
assert(!/\bpm2\s+(?:delete|kill|save)\b/i.test(script), "Permanent cutover must not delete/kill/save PM2 definitions");
assert(!/INSTANTLY_WRITE_ENABLED\s*=\s*["']true["']/i.test(script), "Cutover must not enable Instantly writes itself");
assert(!/MILES_CONTROLLED_WRITE_ENABLED\s*=\s*["']true["']/i.test(script), "Cutover must not enable controlled writes itself");

console.log("PASS permanent_cutover_safety_test");
