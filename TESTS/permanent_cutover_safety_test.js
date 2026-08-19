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
assert(/\$protectedTopLevel\s*=\s*@\('DATA','CONFIG','\.env'\)/i.test(script), "Cutover must protect DATA, CONFIG, and .env in place");
assert(/PARK_OLD_SOURCE/i.test(script), "Cutover must park old source before promotion");
assert(/PROMOTE_VALIDATED_SOURCE/i.test(script), "Cutover must promote validated source in place");
assert(/Move-Item\s+-LiteralPath\s+\$liveItem\s+-Destination\s+\$rollbackItem/i.test(script), "Cutover must snapshot replaced live source");
assert(/Move-Item\s+-LiteralPath\s+\$candidateItem\s+-Destination\s+\$liveItem/i.test(script), "Cutover must move validated candidate source into canonical live paths");
assert(/root_rename_performed=\$false/i.test(script), "Cutover must certify canonical root was not renamed");
assert(/live_env_preserved_in_place=\$true/i.test(script), "Cutover must preserve live .env in place");
assert(/live_data_preserved_in_place=\$true/i.test(script), "Cutover must preserve live DATA in place");
assert(/config_overlay_performed=\$false/i.test(script), "Cutover must not overlay deferred CONFIG");
assert(/Automatic source rollback starting/i.test(script), "Cutover must contain automatic source rollback");
assert(/ready_for_daily_use/i.test(script), "Cutover must require production acceptance readiness");
assert(/AUDIT_MILES_PRODUCTION_ACCEPTANCE\.ps1/i.test(script), "Cutover must run production acceptance after switching");
assert(!/Rename-Item\s+-LiteralPath\s+\$LiveRoot/i.test(script), "Permanent cutover must never rename the canonical live root");
assert(!/(?:^|\n)\s*(?:&\s*)?robocopy\b/im.test(script), "Permanent cutover must not invoke robocopy");
assert(!/\bgit\s+(?:reset|clean|rebase|push)\b/i.test(script), "Permanent cutover must not use destructive Git operations");
assert(!/\bpm2\s+(?:delete|kill|save)\b/i.test(script), "Permanent cutover must not delete/kill/save PM2 definitions");
assert(!/INSTANTLY_WRITE_ENABLED\s*=\s*["']true["']/i.test(script), "Cutover must not enable Instantly writes itself");
assert(!/MILES_CONTROLLED_WRITE_ENABLED\s*=\s*["']true["']/i.test(script), "Cutover must not enable controlled writes itself");

console.log("PASS permanent_cutover_safety_test");
