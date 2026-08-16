"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const servicePath = path.join(repoRoot, "SERVICES", "ProviderAuthorityRegistryService.js");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "miles-provider-env-"));

function run(extraEnv = {}) {
  const code = `
    const authority = require(${JSON.stringify(servicePath)});
    const result = authority.run({ source: "provider-env-regression" });
    const instantly = result.providers.find(p => p.key === "instantly");
    process.stdout.write(JSON.stringify({
      ok: result.ok,
      credentialsPresent: instantly && instantly.credentialsPresent,
      missingEnv: instantly && instantly.credentials && instantly.credentials.missingEnv,
      status: instantly && instantly.status
    }));
  `;

  return spawnSync(process.execPath, ["-e", code], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      MILES_ROOT: tempRoot,
      INSTANTLY_API_KEY: "",
      ...extraEnv
    }
  });
}

try {
  fs.writeFileSync(path.join(tempRoot, ".env"), "INSTANTLY_API_KEY=FROM_DOTENV\n", "utf8");

  const fromDotenv = run();
  if (fromDotenv.status !== 0) {
    throw new Error(`Provider authority child failed: ${fromDotenv.stderr || fromDotenv.stdout}`);
  }
  const dotenvResult = JSON.parse(fromDotenv.stdout || "{}");
  if (!dotenvResult.ok || dotenvResult.credentialsPresent !== true || dotenvResult.status !== "READY_READ_ONLY") {
    throw new Error(`Provider authority did not load production .env truth: ${fromDotenv.stdout}`);
  }

  const fromProcess = run({ INSTANTLY_API_KEY: "FROM_PROCESS_ENV" });
  if (fromProcess.status !== 0) {
    throw new Error(`Provider authority override child failed: ${fromProcess.stderr || fromProcess.stdout}`);
  }
  const processResult = JSON.parse(fromProcess.stdout || "{}");
  if (!processResult.ok || processResult.credentialsPresent !== true) {
    throw new Error(`Provider authority lost exported process environment: ${fromProcess.stdout}`);
  }

  console.log("=== PROVIDER AUTHORITY ENVIRONMENT P0 PASS ===");
  console.log(JSON.stringify({
    ok: true,
    dotenvStatus: dotenvResult.status,
    processEnvironmentPreserved: true
  }, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
