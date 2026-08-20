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
    const fakeFetch = async (_url, request = {}) => {
      assert.strictEqual(request.method, "POST");
      assert.strictEqual(request.headers.Authorization, "Bearer test-tavily-key");
      const body = JSON.parse(request.body);
      assert.strictEqual(body.search_depth, "basic");
      assert.strictEqual(body.time_range, "month");
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            results: [
              {
                title: "Capture Manager - Human Capital Resources and Concepts - Career Page",
                url: "https://humancapitalresourcesandconcepts.applytojob.com/apply/example/Capture-Manager",
                content: "Human Capital Resources and Concepts is seeking an experienced Capture Manager to drive federal growth, capture plans, teaming, price-to-win, customer engagement, gate reviews, and proposal strategy."
              },
              {
                title: "Unrelated Software Engineer - Example - Careers",
                url: "https://example.com/jobs/engineer",
                content: "Software engineering role."
              }
            ]
          };
        }
      };
    };

    const service = new CaptureCapacityPublicWebSignalService({
      rootDir: root,
      apiKey: "test-tavily-key",
      fetchImpl: fakeFetch,
      queries: ['"capture manager" federal contractor hiring'],
      maxResults: 5,
      timeRange: "month"
    });

    const report = await service.runOnce();
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.status, "PUBLIC_WEB_SIGNALS_REFRESHED");
    assert.strictEqual(report.rawResults, 2);
    assert.strictEqual(report.usableSignals, 1);

    const output = JSON.parse(fs.readFileSync(report.outputFile, "utf8"));
    assert.strictEqual(output.records.length, 1);
    const hcrc = output.records[0];
    assert.strictEqual(hcrc.company, "Human Capital Resources and Concepts");
    assert.strictEqual(hcrc.trigger_type, "CAPTURE_HIRING");
    assert.strictEqual(hcrc.source_provider, "TAVILY");
    assert.strictEqual(hcrc.source_type, "PUBLIC_WEB_SEARCH");
    assert.ok(hcrc.source_url.includes("applytojob.com"));
    assert.ok(/capture plans/i.test(hcrc.evidence));

    const unconfigured = new CaptureCapacityPublicWebSignalService({
      rootDir: root,
      apiKey: "",
      fetchImpl: fakeFetch,
      queries: ["should not execute"]
    });
    const noKey = await unconfigured.runOnce();
    assert.strictEqual(noKey.ok, true);
    assert.strictEqual(noKey.status, "PUBLIC_WEB_SEARCH_NOT_CONFIGURED");
    assert.strictEqual(noKey.queriesAttempted, 0);

    let publicRan = false;
    const discovery = new CaptureCapacityRevenueDiscovery({
      sourceBootstrap: { apply: () => ({ ok: true, status: "CONTACT_SOURCES_BOOTSTRAPPED", selectedCount: 1 }) },
      signalBridge: { apply: () => ({ ok: true, status: "ORION_SIGNALS_READY", verifiedSignalCount: 0, validationQueueCount: 0 }) },
      publicWebSignals: {
        async runOnce() {
          publicRan = true;
          return { ok: true, status: "PUBLIC_WEB_SIGNALS_REFRESHED", usableSignals: 1, artifact: "public.json" };
        }
      },
      service: {
        discover() {
          assert.strictEqual(publicRan, true, "public web refresh must run before canonical discovery scan");
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
    assert.strictEqual(integrated.feed.publicWebSignals.status, "PUBLIC_WEB_SIGNALS_REFRESHED");
    assert.strictEqual(integrated.feed.publicWebSignals.usableSignals, 1);
    assert.strictEqual(integrated.work[0].metadata.publicWebSignalStatus, "PUBLIC_WEB_SIGNALS_REFRESHED");

    console.log("PASS capture_capacity_public_web_signal_test");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
