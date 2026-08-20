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
      "Human Capital Resources and Concepts,https://hcrconcepts.com,info@hcrconcepts.com",
      "Bad Free Mail Contractor,,person@gmail.com"
    ].join("\n"));

    const fetched = [];
    const fakeFetch = async (url, request = {}) => {
      const target = String(url);
      fetched.push(target);
      assert.strictEqual(request.method, "GET");
      assert.ok(/MILES-P2GC-Public-Signal-Monitor/.test(request.headers["User-Agent"]));

      if (target === "https://hcrconcepts.com" || target === "https://hcrconcepts.com/") {
        return { ok: true, status: 200, async text() { return '<html><a href="/company/careers">Join Our Team</a></html>'; } };
      }
      if (target === "https://hcrconcepts.com/company/careers") {
        return { ok: true, status: 200, async text() { return '<html><a href="https://humancapitalresourcesandconcepts.applytojob.com/apply">Open Positions</a></html>'; } };
      }
      if (/https:\/\/hcrconcepts\.com\/(careers|jobs)$/.test(target)) {
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
      cacheMs: 0,
      concurrency: 1
    });

    const report = await service.runOnce();
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.engineVersion, CaptureCapacityPublicWebSignalService.ENGINE_VERSION);
    assert.strictEqual(report.status, "PUBLIC_JOB_SIGNALS_REFRESHED");
    assert.strictEqual(report.provider, "PUBLIC_ATS_AND_CAREERS");
    assert.strictEqual(report.companiesChecked, 1, "free-mail-only company must not enter public crawl universe");
    assert.ok(report.universe.contactRejectedDomains >= 1);
    assert.ok(report.careerPagesDiscovered >= 1, "internal career links must be followed");
    assert.strictEqual(report.atsSources, 1);
    assert.strictEqual(report.usableSignals, 1);
    assert.ok(fetched.includes("https://hcrconcepts.com/company/careers"));
    assert.ok(fetched.includes("https://humancapitalresourcesandconcepts.applytojob.com/apply"));
    assert.ok(!fetched.some(url => /gmail\.com/.test(url)), "consumer email domains must never be crawled as company websites");

    const output = JSON.parse(fs.readFileSync(report.outputFile, "utf8"));
    assert.strictEqual(output.engineVersion, CaptureCapacityPublicWebSignalService.ENGINE_VERSION);
    assert.strictEqual(output.records.length, 1);
    const hcrc = output.records[0];
    assert.strictEqual(hcrc.company, "Human Capital Resources and Concepts");
    assert.strictEqual(hcrc.trigger_type, "CAPTURE_HIRING");
    assert.strictEqual(hcrc.source_provider, "APPLYTOJOB");
    assert.strictEqual(hcrc.source_type, "PUBLIC_CAREER_OR_ATS");
    assert.strictEqual(hcrc.universe_source, "CONTACT_SOURCES");
    assert.ok(hcrc.source_url.includes("Capture-Manager"));

    // A report written by an older engine must never survive a deployment as a valid cache hit.
    fs.writeFileSync(service.reportFile, JSON.stringify({
      engineVersion: "PUBLIC_JOB_DISCOVERY_V2",
      status: "PUBLIC_JOB_SIGNALS_NO_USABLE_SIGNALS",
      generatedAt: new Date().toISOString(),
      universe: { nextOrionOffset: 999 }
    }));
    const cacheUpgradeService = new CaptureCapacityPublicWebSignalService({
      rootDir: root,
      fetchImpl: fakeFetch,
      contactSources: [contacts],
      useOrion: false,
      maxCompanies: 5,
      cacheMs: 24 * 60 * 60 * 1000,
      concurrency: 1
    });
    const cacheUpgrade = await cacheUpgradeService.runOnce();
    assert.strictEqual(cacheUpgrade.engineVersion, CaptureCapacityPublicWebSignalService.ENGINE_VERSION);
    assert.notStrictEqual(cacheUpgrade.status, "PUBLIC_JOB_SIGNALS_CACHED", "old-engine cache must be invalidated");
    assert.strictEqual(cacheUpgrade.usableSignals, 1);

    const fakeOrion = {
      initialize() { return { ok: true, status: "INITIALIZED" }; },
      query(sql, params = []) {
        if (/PRAGMA table_info\(contractors\)/i.test(sql)) {
          return ["id", "company", "company_norm", "uei", "website"].map((name, i) => ({ cid: i, name }));
        }
        if (/PRAGMA table_info\(recompetes\)/i.test(sql)) {
          return ["id", "company_id", "recompete_date"].map((name, i) => ({ cid: i, name }));
        }
        if (/COUNT\(\*\)/i.test(sql) && /FROM contractors/i.test(sql)) return [{ count: 3 }];
        if (/FROM contractors c/i.test(sql)) {
          assert.deepStrictEqual(params, [3, 0]);
          assert.ok(/recompetes/i.test(sql), "ORION universe should rank contractors using recompete activity when schema supports it");
          return [
            { company: "Bad Consumer Domain", uei: "BAD123", website: "gmail.com", recompete_count: 50 },
            { company: "Net New Federal Contractor", uei: "NETNEW123", website: "netnewfed.example", recompete_count: 7 },
            { company: "Other Federal Contractor", uei: "OTHER123", website: "otherfed.example", recompete_count: 1 }
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
      if (/https:\/\/netnewfed\.example\/(careers|jobs)$/.test(target)) return { ok: true, status: 200, async text() { return "<html></html>"; } };
      if (target === "https://api.lever.co/v0/postings/netnewfed?mode=json") {
        return { ok: true, status: 200, async json() { return [{ text: "Capture Director", descriptionPlain: "Lead federal capture strategy, customer engagement, teaming and win planning.", hostedUrl: "https://jobs.lever.co/netnewfed/capture-director" }]; } };
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
      cacheMs: 0,
      concurrency: 1
    });
    const netNewReport = await netNewService.runOnce();
    assert.strictEqual(netNewReport.ok, true);
    assert.strictEqual(netNewReport.status, "PUBLIC_JOB_SIGNALS_REFRESHED");
    assert.strictEqual(netNewReport.universe.orionStatus, "ORION_CONTRACTOR_UNIVERSE_READY");
    assert.strictEqual(netNewReport.universe.orionCandidates, 2);
    assert.strictEqual(netNewReport.universe.orionRejectedDomains, 1);
    assert.strictEqual(netNewReport.universe.orionTotalWithWebsite, 3);
    assert.strictEqual(netNewReport.usableSignals, 1);
    assert.ok(!netNewFetched.some(url => /gmail\.com/.test(url)));
    const netNewOutput = JSON.parse(fs.readFileSync(netNewReport.outputFile, "utf8"));
    assert.strictEqual(netNewOutput.records[0].company, "Net New Federal Contractor");
    assert.strictEqual(netNewOutput.records[0].trigger_type, "CAPTURE_HIRING");
    assert.strictEqual(netNewOutput.records[0].universe_source, "ORION_CONTRACTORS");
    assert.ok(netNewFetched.includes("https://api.lever.co/v0/postings/netnewfed?mode=json"));

    // JSON-LD JobPosting is a free first-party signal even when the page has no visible job link text.
    const jsonLdRoot = path.join(root, "jsonld");
    const jsonLdService = new CaptureCapacityPublicWebSignalService({
      rootDir: jsonLdRoot,
      useOrion: false,
      contactSources: [],
      careerUrls: ["https://jsonld.example/careers"],
      cacheMs: 0,
      concurrency: 1,
      fetchImpl: async url => ({ ok: true, status: 200, async text() { return `<html><script type="application/ld+json">${JSON.stringify({"@type":"JobPosting",title:"Proposal Manager",description:"Federal proposal development and capture support",datePosted:"2026-08-20",url:String(url)+"/proposal-manager"})}</script></html>`; } })
    });
    const jsonLdReport = await jsonLdService.runOnce();
    assert.strictEqual(jsonLdReport.usableSignals, 1);
    const jsonLdOutput = JSON.parse(fs.readFileSync(jsonLdReport.outputFile, "utf8"));
    assert.strictEqual(jsonLdOutput.records[0].source_provider, "COMPANY_JSONLD");

    const noSources = new CaptureCapacityPublicWebSignalService({ rootDir: path.join(root, "empty"), fetchImpl: fakeFetch, contactSources: [], careerUrls: [], useOrion: false, cacheMs: 0 });
    const unavailable = await noSources.runOnce();
    assert.strictEqual(unavailable.ok, true);
    assert.strictEqual(unavailable.status, "PUBLIC_JOB_SOURCE_UNAVAILABLE");
    assert.strictEqual(unavailable.companiesChecked, 0);

    let publicRan = false;
    const discovery = new CaptureCapacityRevenueDiscovery({
      sourceBootstrap: { apply: () => ({ ok: true, status: "CONTACT_SOURCES_BOOTSTRAPPED", selectedCount: 1 }) },
      signalBridge: { apply: () => ({ ok: true, status: "ORION_SIGNALS_READY", verifiedSignalCount: 0, validationQueueCount: 0 }) },
      publicWebSignals: { async runOnce() { publicRan = true; return { ok: true, status: "PUBLIC_JOB_SIGNALS_REFRESHED", usableSignals: 1, artifact: "public.json" }; } },
      service: { discover() { assert.strictEqual(publicRan, true); return { sourceCounts: { contactRows: 10, signalRows: 1, enrichedRows: 0, qualifiedRows: 0, blockedByCampaignGate: 1 }, campaignGate: { ok: true }, nextAction: "RESOLVE_ENRICHMENT_GAPS", artifact: "capture.json" }; } }
    });
    const integrated = await discovery.discover();
    assert.strictEqual(integrated.ok, true);
    assert.strictEqual(integrated.feed.publicWebSignals.status, "PUBLIC_JOB_SIGNALS_REFRESHED");
    assert.strictEqual(integrated.work[0].metadata.publicWebSignalStatus, "PUBLIC_JOB_SIGNALS_REFRESHED");

    console.log("PASS capture_capacity_public_web_signal_test");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
