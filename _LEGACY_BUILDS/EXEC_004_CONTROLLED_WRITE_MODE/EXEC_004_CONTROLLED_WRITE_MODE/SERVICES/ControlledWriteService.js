"use strict";

const fs = require("fs");
const path = require("path");
const policyService = require("./ControlledWritePolicyService");
const audit = require("./ControlledWriteAuditService");
const instantly = require("./InstantlyControlledWriteService");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "controlled_write");
const LATEST_FILE = path.join(OUT_DIR, "latest_controlled_write.json");
const REPORT_FILE = path.join(OUT_DIR, "controlled_write_report.md");

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function writeJson(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8"); }

class ControlledWriteService {
  async run(input = {}) {
    const startedAt = Date.now();
    const provider = String(input.provider || "instantly").toLowerCase();
    const operation = String(input.operation || "CREATE_TEST_CAMPAIGN").toUpperCase();
    let result;

    if (input.mode === "POLICY" || operation === "POLICY") {
      result = policyService.run(input);
    } else if (input.mode === "AUDIT" || operation === "AUDIT") {
      result = audit.run(input);
    } else if (provider === "instantly") {
      result = await instantly.execute({ ...input, operation });
    } else {
      result = { ok: false, action: "CONTROLLED_WRITE", status: "UNKNOWN_PROVIDER", provider, operation, executed: false, verified: false };
    }

    const record = {
      ok: Boolean(result.ok),
      action: "CONTROLLED_WRITE",
      type: "MILES_CONTROLLED_WRITE_RESULT",
      build: "EXEC_004",
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      provider,
      operation,
      result,
      summary: {
        status: result.status || "UNKNOWN",
        executed: Boolean(result.executed),
        verified: Boolean(result.verified),
        dryRun: Boolean(result.dryRun)
      },
      outDir: OUT_DIR
    };

    ensureDir(OUT_DIR);
    writeJson(LATEST_FILE, record);
    fs.writeFileSync(REPORT_FILE, this.renderReport(record), "utf8");
    return record;
  }

  renderReport(record) {
    return `# EXEC_004 Controlled Write Report\n\nGenerated: ${record.generatedAt}\n\nProvider: ${record.provider}\nOperation: ${record.operation}\nStatus: ${record.summary.status}\nExecuted: ${record.summary.executed}\nVerified: ${record.summary.verified}\nDry Run: ${record.summary.dryRun}\n\nOutput Directory: ${record.outDir}\n`;
  }
}
module.exports = new ControlledWriteService();
