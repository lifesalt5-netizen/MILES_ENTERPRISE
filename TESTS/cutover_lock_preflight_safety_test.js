"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "SCRIPTS", "PREFLIGHT_MILES_INPLACE_CUTOVER_LOCKS_WINDOWS.ps1"), "utf8");

assert([...Buffer.from(script, "utf8")].every(b => b < 0x80), "Lock preflight must remain ASCII-only");
assert(/No candidate source will be promoted/i.test(script), "Preflight must explicitly remain non-promoting");
assert(/Protected in place: \.env, DATA, CONFIG/i.test(script), "Preflight must protect runtime/config state");
assert(/Rename-Item\s+-LiteralPath\s+\$liveItem\s+-NewName\s+\$probeName/i.test(script), "Preflight must test rename semantics on the live item");
assert(/Rename-Item\s+-LiteralPath\s+\$probePath\s+-NewName\s+\$name/i.test(script), "Preflight must immediately restore each tested item");
assert(/locked_items/i.test(script), "Preflight must report exact locked items");
assert(/Canonical ports restored/i.test(script), "Preflight must report runtime restoration");
assert(/candidate_source_promoted=\$false/i.test(script), "Preflight report must certify no candidate promotion");
assert(/env_touched=\$false/i.test(script), "Preflight report must certify .env untouched");
assert(/data_touched=\$false/i.test(script), "Preflight report must certify DATA untouched");
assert(/config_touched=\$false/i.test(script), "Preflight report must certify CONFIG untouched");
assert(!/Move-Item/i.test(script), "Lock preflight must not move source trees");
assert(!/\bgit\s+(?:reset|clean|rebase|push)\b/i.test(script), "Lock preflight must not use destructive Git operations");
assert(!/\bpm2\s+(?:delete|kill|save)\b/i.test(script), "Lock preflight must not delete/kill/save PM2 definitions");
assert(!/INSTANTLY_WRITE_ENABLED\s*=\s*["']true["']/i.test(script), "Lock preflight must not enable Instantly writes");
assert(!/MILES_CONTROLLED_WRITE_ENABLED\s*=\s*["']true["']/i.test(script), "Lock preflight must not enable controlled writes");

console.log("PASS cutover_lock_preflight_safety_test");
