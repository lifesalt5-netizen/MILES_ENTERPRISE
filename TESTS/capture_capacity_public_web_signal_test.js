"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const CaptureCapacityPublicWebSignalService = require("../SERVICES/revenue/CaptureCapacityPublicWebSignalService");
const { CaptureCapacityRevenueDiscovery } = require("../SERVICES/Discovery/CaptureCapacityRevenueDiscovery");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-public-signal-"));
  try {
    const contacts = path.join(root, "contacts.csv");
    fs.writeFileSync(contacts, [
      "company,website,email",
      "Human Capital Resources and Concepts,https://hcrconcepts.com,info@hcrconcepts.com"
    ].join("\n"));

    const fetched = [];
    const fakeFetch = async (url, request = {}) => {
      const target = String(url);
      fetched.push(target);
      assert.strictEqual(request.method, "GET");
      assert.ok(/MILES-P2GC-Public-Signal-Monitor/.test(request.headers["User-Agent"]));

      if (target === "https://hcrconcepts.com" || target === "https://hcrconcepts.com/") {
        return { ok: true, status: 200, async text() { return '<html><a href="https://humancapitalresourcesandconcepts.applytojob.com/apply">Careers</a></html>'; } };
      }
      if (target === "https://hcrconcepts.com/careers" || target === "https://hcrconcepts.com/jobs") {
        return { ok: true, status: 200, async text() { return "<html>No direct jobs here.</html>"; } };
      }
      if (target === "https://humancapitalresourcesandconcepts.applytojob.com/apply") {
        return {
          ok: true,
          status: 200,
          async text() {
            return '<html><a href="/apply/7QH9tUAawk/Capture-Manager">Capture Manager</a><a href="/apply/x/Software-Engineer">Software Engineer</a></html>';
          }
        };
      }
      throw new Error(`Unexpected fetch ${url}`);
    };

    const service = new CaptureCapacityPublicWebSignalService({
      rootDir: root,
      fetchImpl: fakeFetch,
      contactSources: [contacts],
      useOrion: false,
      maxCompanies: 5,
      cacheMs: 0
    });

    const report = await service.runOnce();
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.status, "PUBLIC_JOB_SIGNALS_REFRESHED");
    assert.strictEqual(report.provider, "PUBLIC_ATS_AND_CAREERS");
    assert.strictEqual(report.companiesChecked, 1);
    assert.strictEqual(report.atsSources, 1);
    assert.strictEqual(report.usableSignals, 1);
    assert.ok(fetched.includes("https://humancapitalresourcesandconcepts.applytojob.com/apply"));

    const output = JSON.parse(fs.readFileSync(report.outputFile, "utf8"));
    assert.strictEqual(output.records.length, 1);
    const hcrc = output.records[0];
    assert.strictEqual(hcrc.company, "Human Capital Resources and Concepts");
    assert.strictEqual(hcrc.trigger_type, "CAPTURE_HIRING");
    assert.strictEqual(hcrc.source_provider, "APPLYTOJOB");
    assert.strictEqual(hcrc.source_type, "PUBLIC_CAREER_OR_ATS");
    assert.strictEqual(hcrc.universe_source, "CONTACT_SOURCES");
    assert.ok(hcrc.source_url.includes("Capture-Manager"));
    assert.ok(/capture manager/i.test(hcrc.evidence));

    const fakeOrion = {
      initialize() { return { ok: true, status: "INITIALIZED" }; },
      query(sql, params = []) {
        if (/PRAGMA table_info\(contractors\)/i.test(sql)) {
          return ["id", "company", "company_norm", "uei", "website"].map((name, i) => ({ cid: i, name }));
        }
        if (/COUNT\(\*\)/i.test(sql)) return [{ count: 2 }];
        if (/FROM contractors/i.test(sql)) {
          assert.deepStrictEqual(params, [2, 0]);
          return [
            { company: "Net New Federal Contractor", uei: "NETNEW123", website: "netnewfed.example" },
            { company: "Other Federal Contractor", uei: "OTHER123", website: "otherfed.example" }
          ];
        }
        throw new Error(`Unexpected ORION SQL: ${sql}`);
      }
    };

    const netNewFetched = [];
    const netNewFetch = async (url, request = {}) => {
      const target = String(url);
      netNewFetched.push(target);
      assert.strictEqual(request.method, "GET");
      if (target === "https://netnewfed.example" || target === "https://netnewfed.example/") {
        return { ok: true, status: 200, async text() { return '<html><a href="https://jobs.lever.co/netnewfed">Careers</a></html>'; } };
      }
      if (target === "https://netnewfed.example/careers" || target === "https://netnewfed.example/jobs") {
        return { ok: true, status: 200, async text() { return "<html></html>"; } };
      }
      if (target === "https://api.lever.co/v0/postings/netnewfed?mode=json") {
        return {
          ok: true,
          status: 200,
          async json() {
            return [{
              text: "Capture Director",
              descriptionPlain: "Lead federal capture strategy, customer engagement, teaming and win planning.",
              hostedUrl: "https://jobs.lever.co/netnewfed/capture-director"
            }];
          }
        };
      }
      if (/otherfed\.example/.test(target)) return { ok: true, status: 200, async text() { return "<html></html>"; } };
      throw new Error(`Unexpected net-new fetch ${target}`);
    };

    const netNewRoot = path.join(root, "net-new");
    const netNewService = new CaptureCapacityPublicWebSignalService({
      rootDir: netNewRoot,
      fetchImpl: netNewFetch,
      contactSources: [],
      careerUrls: [],
      orion: fakeOrion,
      useOrion: true,
      maxCompanies: 2,
      cacheMs: 0
    });
    const netNewReport = await netNewService.runOnce();
    assert.strictEqual(netNewReport.ok, true);
    assert.strictEqual(netNewReport.status, "PUBLIC_JOB_SIGNALS_REFRESHED");
    assert.strictEqual(netNewReport.universe.orionStatus, "ORION_CONTRACTOR_UNIVERSE_READY");
    assert.strictEqual(netNewReport.universe.orionCandidates, 2);
    assert.strictEqual(netNewReport.universe.orionTotalWithWebsite, 2);
    assert.strictEqual(netNewReport.usableSignals, 1);
    const netNewOutput = JSON.parse(fs.readFileSync(netNewReport.outputFile, "utf8"));
    assert.strictEqual(netNewOutput.records[0].company, "Net New Federal Contractor");
    assert.strictEqual(netNewOutput.records[0].trigger_type, "CAPTURE_HIRING");
    assert.strictEqual(netNewOutput.records[0].universe_source, "ORION_CONTRACTORS");
    assert.ok(netNewFetched.includes("https://api.lever.co/v0/postings/netnewfed?mode=json"));

    const noSources = new CaptureCapacityPublicWebSignalService({
      rootDir: path.join(root, "empty"),
      fetchImpl: fakeFetch,
      contactSources: [],
      careerUrls: [],
      useOrion: false,
      cacheMs: 0
    });
    const unavailable = await noSources.runOnce();
    assert.strictEqual(unavailable.ok, true);
    assert.strictEqual(unavailable.status, "PUBLIC_JOB_SOURCE_UNAVAILABLE");
    assert.strictEqual(unavailable.companiesChecked, 0);

    let publicRan = false;
    const discovery = new CaptureCapacityRevenueDiscovery({
      sourceBootstrap: { apply: () => ({ ok: true, status: "CONTACT_SOURCES_BOOTSTRAPPED", selectedCount: 1 }) },
      signalBridge: { apply: () => ({ ok: true, status: "ORION_SIGNALS_READY", verifiedSignalCount: 0, validationQueueCount: 0 }) },
      publicWebSignals: {
        async runOnce() {
          publicRan = true;
          return { ok: true, status: "PUBLIC_JOB_SIGNALS_REFRESHED", usableSignals: 1, artifact: "public.json" };
        }
      },
      service: {
        discover() {
          assert.strictEqual(publicRan, true, "public job refresh must run before canonical discovery scan");
          return {
            sourceCounts: { contactRows: 10, signalRows: 1, enrichedRows: 0, qualifiedRows: 0, blockedByCampaignGate: 1 },
            campaignGate: { ok: true },
            nextAction: "RESOLVE_ENRICHMENT_GAPS",
            artifact: "capture.json"
          };
        }
      }
    });

    const integrated = await discovery.discover();
    assert.strictEqual(integrated.ok, true);
    assert.strictEqual(integrated.feed.publicWebSignals.status, "PUBLIC_JOB_SIGNALS_REFRESHED");
    assert.strictEqual(integrated.feed.publicWebSignals.usableSignals, 1);
    assert.strictEqual(integrated.work[0].metadata.publicWebSignalStatus, "PUBLIC_JOB_SIGNALS_REFRESHED");

    console.log("PASS capture_capacity_public_web_signal_test");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
