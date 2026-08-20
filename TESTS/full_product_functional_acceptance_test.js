"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function section(name, fn) {
  try {
    const value = fn();
    if (value && typeof value.then === "function") {
      return value.then(() => console.log(`PASS ${name}`));
    }
    console.log(`PASS ${name}`);
    return value;
  } catch (error) {
    console.error(`FAIL ${name}: ${error.stack || error.message}`);
    throw error;
  }
}

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "miles-product-acceptance-"));
}

async function main() {
  await section("production source closure graph resolves every critical module", () => {
    const graphPath = path.join(ROOT, "CONFIG", "PRODUCTION_SYSTEM_GRAPH.json");
    assert.ok(fs.existsSync(graphPath), "production graph must exist");
    const graph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
    assert.ok(Array.isArray(graph.criticalModules) && graph.criticalModules.length >= 10);
    const missing = graph.criticalModules.filter(file => !fs.existsSync(path.join(ROOT, file)));
    assert.deepStrictEqual(missing, [], `missing critical modules: ${missing.join(", ")}`);
  });

  await section("capture discovery accepts explicit file arrays and returns matched evidence", () => {
    const CaptureCapacityProspectDiscoveryService = require("../SERVICES/revenue/CaptureCapacityProspectDiscoveryService");
    const dir = tempRoot();
    const contactPath = path.join(dir, "contacts.json");
    const signalPath = path.join(dir, "capture_signals.json");
    fs.writeFileSync(contactPath, JSON.stringify([
      { company: "Acceptance Test Federal LLC", first_name: "Avery", email: "avery@example.com", website: "example.com" }
    ]));
    fs.writeFileSync(signalPath, JSON.stringify([
      { company: "Acceptance Test Federal LLC", website: "example.com", trigger_type: "CAPTURE_HIRING", evidence: "Hiring a federal capture manager to expand capture capacity.", source_url: "https://example.com/jobs/capture", posted_date: "2026-08-20" }
    ]));

    const campaignService = {
      prepareAudience(rows) {
        return {
          eligible: rows.map(lead => ({ lead })),
          blocked: [],
          evaluated: rows.length,
          eligibleCount: rows.length,
          blockedCount: 0,
          capped: false,
          cap: 2000
        };
      }
    };
    const service = new CaptureCapacityProspectDiscoveryService({ rootDir: dir, campaignService });
    const result = service.discover({ contactFiles: [contactPath], signalFiles: [signalPath], writeReport: false });
    assert.equal(result.ok, true);
    assert.equal(result.sourceCounts.qualifiedRows, 1);
    assert.equal(result.candidates[0].company, "Acceptance Test Federal LLC");
    assert.match(result.candidates[0].specific_current_need, /capture manager/i);
    assert.equal(result.candidates[0].triggers[0].source, "https://example.com/jobs/capture");
  });

  await section("capture discovery fails closed when company signal does not match contact", () => {
    const CaptureCapacityProspectDiscoveryService = require("../SERVICES/revenue/CaptureCapacityProspectDiscoveryService");
    const campaignService = {
      prepareAudience(rows) {
        return { eligible: rows.map(lead => ({ lead })), blocked: [], evaluated: rows.length, eligibleCount: rows.length, blockedCount: 0, capped: false, cap: 2000 };
      }
    };
    const service = new CaptureCapacityProspectDiscoveryService({ rootDir: tempRoot(), campaignService });
    const result = service.discover({
      contacts: [{ company: "Company A", email: "a@example.com", website: "a.example" }],
      signals: [{ company: "Company B", website: "b.example", trigger_type: "CAPTURE_HIRING", evidence: "Hiring capture director", source: "https://example.com/b" }],
      writeReport: false
    });
    assert.equal(result.ok, false);
    assert.equal(result.sourceCounts.qualifiedRows, 0);
    assert.equal(result.nextAction, "REFRESH_CAPTURE_CAPACITY_CONTACT_AND_SIGNAL_SOURCES");
  });

  await section("CEO capture mission routes to governed capture-capacity execution", async () => {
    const planner = require("../SERVICES/BusinessWorkPlannerService");
    const result = await planner.plan({ objective: "Discover CURRENTLY_LOOKING_FOR_HELP GovCon companies, including HCRC, and move qualified prospects toward a meeting." });
    assert.equal(result.ok, true);
    assert.equal(result.captureMission, true);
    assert.equal(result.mode, "CAPTURE_REVENUE_EXECUTION");
    assert.equal(result.workPackages.length, 1);
    const work = result.workPackages[0];
    assert.equal(work.provider, "MILES");
    assert.equal(work.connector, "MILES");
    assert.equal(work.action, "CAPTURE_CAPACITY_DISCOVERY");
    assert.equal(work.capability, "revenue.capture_capacity_handoff");
    assert.equal(work.requiresKevin, false);
    assert.equal(work.activationPolicy, "NEVER_AUTO_ACTIVATE");
    assert.equal(result.connectorContract.campaignAutoActivationAllowed, false);
  });

  await section("read-only CEO review creates no external work", async () => {
    const planner = require("../SERVICES/BusinessWorkPlannerService");
    const result = await planner.plan({ objective: "Review current P2GC revenue operations read-only. Do not send or modify anything." });
    assert.equal(result.readOnly, true);
    assert.equal(result.workPackages.length, 0);
  });

  await section("MILES connector contract owns capture discovery", async () => {
    const contracts = require("../CORE/ExecutionActionContracts");
    const connector = require("../CONNECTORS/MILES/connector");
    const resolved = contracts.resolveConnectorAction("MILES", "CAPTURE_CAPACITY_DISCOVERY");
    assert.equal(resolved.supported, true);
    assert.equal(resolved.canonicalAction, "CAPTURE_CAPACITY_DISCOVERY");
    assert.equal(connector.canExecuteAction("CAPTURE_CAPACITY_DISCOVERY"), true);
    assert.equal(connector.contractIntegrity().ok, true);
  });

  await section("CEO preflight passes with complete source closure and healthy worker", () => {
    const CommandPreflightService = require("../SERVICES/governance/CommandPreflightService");
    const dir = tempRoot();
    fs.mkdirSync(path.join(dir, "CONFIG"), { recursive: true });
    fs.mkdirSync(path.join(dir, "DATA", "runtime"), { recursive: true });
    fs.writeFileSync(path.join(dir, "CONFIG", "PRODUCTION_SYSTEM_GRAPH.json"), JSON.stringify({ criticalModules: [] }));
    fs.writeFileSync(path.join(dir, "DATA", "runtime", "task_queue.json"), "[]");
    fs.writeFileSync(path.join(dir, "DATA", "runtime", "worker_runtime_status.json"), JSON.stringify({
      generatedAt: new Date().toISOString(),
      pid: 123,
      lifecycle: { started: true, shuttingDown: false },
      memory: { rssMb: 100 },
      queue: { total: 0 }
    }));
    const preflight = new CommandPreflightService({
      rootDir: dir,
      providerAuthority: { run: () => ({ providers: [] }) },
      actionCapability: { evaluate: () => ({ ok: true, code: "TEST_ACTION_READY", route: { mode: "CONNECTOR", connector: "MILES", action: "CAPTURE_CAPACITY_DISCOVERY" } }) }
    });
    const operation = { id: "op_test", source: "MILES_COMMAND_CENTER", provider: "MILES", connector: "MILES", action: "CAPTURE_CAPACITY_DISCOVERY", command: "Discover capture prospects" };
    const result = preflight.evaluate({ operation, task: { type: "CAPTURE_CAPACITY_DISCOVERY", payload: operation } });
    assert.equal(result.ok, true);
    assert.equal(result.allowedToQueue, true);
  });

  await section("CEO preflight fails closed when source closure is missing", () => {
    const CommandPreflightService = require("../SERVICES/governance/CommandPreflightService");
    const dir = tempRoot();
    fs.mkdirSync(path.join(dir, "DATA", "runtime"), { recursive: true });
    fs.writeFileSync(path.join(dir, "DATA", "runtime", "task_queue.json"), "[]");
    fs.writeFileSync(path.join(dir, "DATA", "runtime", "worker_runtime_status.json"), JSON.stringify({ generatedAt: new Date().toISOString(), lifecycle: { started: true, shuttingDown: false } }));
    const preflight = new CommandPreflightService({
      rootDir: dir,
      providerAuthority: { run: () => ({ providers: [] }) },
      actionCapability: { evaluate: () => ({ ok: true, code: "TEST_ACTION_READY", route: {} }) }
    });
    const operation = { id: "op_test", source: "MILES_COMMAND_CENTER", provider: "MILES", connector: "MILES", action: "BUSINESS_EXECUTION", command: "Execute revenue mission" };
    const result = preflight.evaluate({ operation, task: { type: "BUSINESS_EXECUTION", payload: operation } });
    assert.equal(result.ok, false);
    assert.ok(result.blockers.some(item => item.code === "PRODUCTION_GRAPH_MISSING"));
  });

  await section("Opportunity Vehicle and Recompete products return requested semantic fields and fail closed", () => {
    const P2GCFocusedIntelligenceService = require("../SERVICES/demo/P2GCFocusedIntelligenceService");
    const focused = new P2GCFocusedIntelligenceService();
    const model = {
      ok: true,
      generatedAt: new Date().toISOString(),
      profile: { companyName: "Semantic Federal LLC", uei: "UEI123", cage: "1ABC2", naicsCodes: ["541512"], certifications: ["SDVOSB"], samStatus: "ACTIVE", gsaStatus: "ACTIVE" },
      readiness: { overall: 80, categories: { contractVehicles: { score: 75 } } },
      evidence: { source: "TEST_EVIDENCE" },
      safety: { readOnly: true, writesEnabled: false },
      opportunities: {
        liveAndForecast: [{ id: "OPP-1", title: "Cyber support", agency: "Agency A", source: "https://example.com/opp" }],
        recompetes: [{ id: "REC-1", agency: "Agency B", source: "https://example.com/rec" }]
      },
      agencyAlignment: { agencies: [{ agency: "Agency A" }] },
      recommendations: { opportunity: ["Qualify OPP-1"], immediate: ["Validate due date"], partner: ["Validate partner"] },
      vehicles: { status: "CURRENT_VEHICLES_IDENTIFIED", current: ["GSA MAS"], recommendations: ["Validate HACS eligibility"] },
      gaps: { items: ["HACS vehicle/SIN gap"] },
      pathway: { type: "GROWTH_PATHWAY" }
    };
    const opp = focused.build("opportunities", model);
    assert.equal(opp.type, "opportunities");
    assert.equal(opp.prospect.companyName, "Semantic Federal LLC");
    assert.equal(opp.records[0].title, "Cyber support");
    assert.ok(opp.disclosure.includes("validated before bid action"));

    const vehicles = focused.build("vehicles", model);
    assert.deepStrictEqual(vehicles.currentVehicles, ["GSA MAS"]);
    assert.ok(vehicles.vehicleGaps.some(x => /HACS/i.test(x)));

    const recompetes = focused.build("recompetes", model);
    assert.equal(recompetes.records[0].id, "REC-1");
    assert.equal(recompetes.currentCapability.incumbentIdentity, false);

    const noSignals = focused.build("opportunities", { ...model, opportunities: { liveAndForecast: [], recompetes: [] } });
    assert.equal(noSignals.status, "NO_CURRENT_MATCHED_OPPORTUNITY_SIGNAL");
    assert.deepStrictEqual(noSignals.records, []);
  });

  await section("Sub2Prime preserves evidence and never invents contacts", () => {
    const P2GCPrimeSubTeamingService = require("../SERVICES/teaming/P2GCPrimeSubTeamingService");
    const fakeBlueprint = {
      build: () => ({
        ok: true,
        profile: { companyName: "Semantic Federal LLC", uei: "UEI123", cage: "1ABC2", naicsCodes: ["541512"], certifications: ["SDVOSB"], contractVehicles: ["GSA MAS"] },
        readiness: { overall: 82 },
        pathway: { type: "GROWTH_PATHWAY" },
        primePartners: { records: [{ company: "Prime One", uei: "PRIME1", vehicle: "GSA MAS", agencies: ["Agency A"], federalRevenue: 10000000, awardCount: 10, basis: "shared NAICS", confidence: "MODELED_CANDIDATE" }], strategy: ["Validate Prime One"] },
        subcontracting: { status: "ORION_TEAMING_SIGNALS_AVAILABLE", records: [{ prime: "Prime One" }] },
        agencyAlignment: { agencies: [{ agency: "Agency A", fitScore: 90, historicalSpend: 1000000, awardCount: 5 }] },
        competitors: { status: "ORION_MARKET_PEER_MODEL" },
        evidence: { disclosure: "Validate modeled signals." }
      })
    };
    const service = new P2GCPrimeSubTeamingService({ blueprintService: fakeBlueprint });
    const result = service.build("Semantic Federal LLC");
    assert.equal(result.ok, true);
    assert.equal(result.prospect.companyName, "Semantic Federal LLC");
    assert.equal(result.primeCandidates[0].company, "Prime One");
    assert.equal(result.targetAgencies[0].agency, "Agency A");
    assert.equal(result.primeCandidates[0].contact.status, "UNAVAILABLE_IN_CURRENT_ORION_RECORD");
    assert.equal(result.primeCandidates[0].contact.email, null);
    assert.equal(result.safety.contactsInvented, false);
  });

  await section("Command Center browser preserves backend blocker details", () => {
    const app = fs.readFileSync(path.join(ROOT, "SERVICES", "digital_coo", "public", "app.js"), "utf8");
    assert.match(app, /error\.data/);
    assert.match(app, /showTechnicalDetails\(details\)/);
    assert.match(app, /Command blocked or failed/);
  });

  console.log("FULL_PRODUCT_FUNCTIONAL_ACCEPTANCE_TEST: GREEN");
}

main().catch(error => {
  console.error("FULL_PRODUCT_FUNCTIONAL_ACCEPTANCE_TEST: RED");
  console.error(error.stack || error.message);
  process.exit(1);
});
