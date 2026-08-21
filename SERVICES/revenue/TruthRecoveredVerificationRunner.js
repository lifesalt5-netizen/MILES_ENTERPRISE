"use strict";

const fs = require("fs");
const path = require("path");
const ReconciliationService = require("./RevenueVerificationReconciliationService");
const { parseCsv } = require("./RevenueVerificationReconciliationService");

function clean(value) { return String(value == null ? "" : value).trim(); }
function csv(value) {
  const text = clean(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

class TruthRecoveredVerificationRunner {
  constructor(options = {}) {
    this.service = "TRUTH_RECOVERED_VERIFICATION_RUNNER";
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", ".."));
    this.rulesPath = options.rulesPath || path.join(this.rootDir, "CONFIG", "truth_recovered_verification_rules.json");
    this.batchRoot = options.batchRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "email_verification_batch");
    this.batchPath = options.batchPath || path.join(this.batchRoot, "millionverifier_batch.csv");
    this.batchManifestPath = options.batchManifestPath || path.join(this.batchRoot, "manifest.json");
    this.outputRoot = options.outputRoot || path.join(this.rootDir, "DATA", "runtime", "revenue", "truth_recovered_verification_run");
    this.verifyProvider = options.verifyProvider || null;
    this.reconciliationFactory = options.reconciliationFactory || (args => new ReconciliationService(args));
    this.generatedAt = options.generatedAt || (() => new Date().toISOString());
    this.env = options.env || process.env;
  }

  rules() {
    if (!fs.existsSync(this.rulesPath)) throw new Error("Truth verification rules are missing.");
    return JSON.parse(fs.readFileSync(this.rulesPath, "utf8").replace(/^\uFEFF/, ""));
  }

  plan(input = {}) {
    const rules = this.rules();
    return {
      ok: true,
      service: this.service,
      mode: "PLAN_ONLY",
      status: "PLANNED",
      requestedCreditBudget: Number(input.creditBudget || 0),
      authorizationRequired: true,
      authorizationEnv: rules.authorizationEnv,
      creditsUsed: 0,
      externalVerificationRequested: false,
      providerWritesAuthorized: false,
      leadsUploaded: false,
      emailsSent: false,
      campaignsChanged: false
    };
  }

  apiKey(rules) {
    for (const name of rules.apiKeyEnvNames || []) {
      if (this.env[name]) return { name, value: this.env[name] };
    }
    return null;
  }

  providerRules(rules) {
    const apiBaseUrl = clean(this.env[rules.apiBaseUrlEnv]);
    if (!apiBaseUrl) throw new Error(`${rules.apiBaseUrlEnv} is required before verification credit spend.`);
    return {
      verification: {
        apiBaseUrl,
        timeoutSeconds: Number(rules.timeoutSeconds || 10),
        acceptedResults: rules.acceptedResults || ["ok"],
        rejectedResults: rules.rejectedResults || ["invalid"]
      }
    };
  }

  provider() {
    if (this.verifyProvider) return this.verifyProvider;
    return require("../StateSledEmailDiscoveryService").verifyEmail;
  }

  loadBatch() {
    if (!fs.existsSync(this.batchManifestPath)) throw new Error("Verification batch manifest is missing.");
    if (!fs.existsSync(this.batchPath)) throw new Error("Verification batch CSV is missing.");
    const manifest = JSON.parse(fs.readFileSync(this.batchManifestPath, "utf8").replace(/^\uFEFF/, ""));
    if (manifest.ok !== true || manifest.status !== "BATCH_PREPARED" || manifest.conservation?.ok !== true) {
      throw new Error("Verification batch evidence is unhealthy.");
    }
    const rows = parseCsv(fs.readFileSync(this.batchPath, "utf8"));
    if (rows.length < 2) throw new Error("Verification batch contains no data rows.");
    const headers = rows[0].map(value => clean(value).toLowerCase());
    const batch = rows.slice(1).map(values => Object.fromEntries(headers.map((header, i) => [header, clean(values[i])])));
    if (batch.length !== Number(manifest.summary.selectedForVerification)) throw new Error("Verification batch count does not match manifest.");
    const emails = batch.map(row => row.email.toLowerCase());
    if (new Set(emails).size !== emails.length) throw new Error("Verification batch contains duplicate emails.");
    return { manifest, batch };
  }

  async mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    async function runOne() {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, limit) }, runOne));
    return results;
  }

  async run(input = {}) {
    if (input.apply !== true) return this.plan(input);
    const rules = this.rules();
    if (this.env[rules.authorizationEnv] !== rules.authorizationToken) {
      return {
        ok: false,
        service: this.service,
        mode: "APPLY",
        status: "AWAITING_APPROVAL",
        requiredAuthorization: rules.authorizationToken,
        authorizationEnv: rules.authorizationEnv,
        creditsUsed: 0,
        externalVerificationRequested: false,
        leadsUploaded: false,
        emailsSent: false,
        campaignsChanged: false
      };
    }
    const budget = Number(input.creditBudget);
    if (!Number.isInteger(budget) || budget <= 0) throw new Error("A positive integer --credit-budget is required.");
    if (budget > Number(rules.maxCreditBudget || 500)) throw new Error("Requested verification credit budget exceeds the governed maximum.");
    const { manifest: batchManifest, batch } = this.loadBatch();
    if (batch.length > budget) throw new Error("Authorized verification batch exceeds the explicit credit budget.");
    const apiKey = this.apiKey(rules);
    if (!apiKey) throw new Error("MillionVerifier API key is not configured.");
    const providerRules = this.providerRules(rules);
    const verifyProvider = this.provider();

    const verified = await this.mapLimit(batch, Number(rules.concurrency || 4), async row => {
      const result = await verifyProvider(row.email, providerRules, apiKey);
      if (result.status !== "COMPLETE") throw new Error(`MillionVerifier did not complete for ${row.email}: ${result.reason || result.error || result.status}`);
      return {
        email: row.email,
        quality: clean(result.quality).toLowerCase(),
        result: clean(result.result).toLowerCase(),
        free: clean(result.free).toLowerCase(),
        role: clean(result.role).toLowerCase()
      };
    });

    fs.mkdirSync(this.outputRoot, { recursive: true });
    const reportPath = path.join(this.outputRoot, "millionverifier_report.csv");
    const reportText = "email,quality,result,free,role\n" + verified.map(row => [row.email, row.quality, row.result, row.free, row.role].map(csv).join(",")).join("\n") + "\n";
    fs.writeFileSync(reportPath, reportText, "utf8");

    const reconciliation = this.reconciliationFactory({
      rootDir: this.rootDir,
      batchRoot: this.batchRoot,
      outputRoot: path.join(this.rootDir, "DATA", "runtime", "revenue", "email_verification_results"),
      generatedAt: this.generatedAt
    }).reconcile({ apply: true, reportPath });

    const summary = {
      ok: reconciliation.ok === true,
      service: this.service,
      mode: "APPLY",
      status: reconciliation.ok === true ? "VERIFICATION_AND_RECONCILIATION_COMPLETED" : "FAILED",
      generatedAt: this.generatedAt(),
      batchFingerprint: batchManifest.batchFingerprint,
      truthIntakeFingerprint: batchManifest.sourceTruthIntakeFingerprint || null,
      creditBudget: budget,
      creditsUsed: batch.length,
      creditsRemaining: budget - batch.length,
      verifiedRows: batch.length,
      reconciliationFingerprint: reconciliation.reconciliationFingerprint,
      reconciliationSummary: reconciliation.summary,
      externalVerificationRequested: true,
      providerWritesAuthorized: true,
      providerWriteScope: "MILLIONVERIFIER_VERIFY_ONLY",
      leadsUploaded: false,
      emailsSent: false,
      campaignsChanged: false,
      reportPath
    };
    const summaryPath = path.join(this.outputRoot, "manifest.json");
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");
    summary.manifestPath = summaryPath;
    return summary;
  }
}

module.exports = TruthRecoveredVerificationRunner;
module.exports.TruthRecoveredVerificationRunner = TruthRecoveredVerificationRunner;
