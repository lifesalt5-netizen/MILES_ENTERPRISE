"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Service = require(
  "../SERVICES/UsaspendingAwardHistoryStagingService"
);
const cli = require(
  "../SCRIPTS/RefreshUsaspendingAwardHistory"
);

function jsonResponse(value) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(value);
    }
  };
}

function zipResponse() {
  const bytes = Buffer.from([
    0x50, 0x4b, 0x03, 0x04, 0x00, 0x00
  ]);
  return {
    ok: true,
    status: 200,
    body: null,
    async arrayBuffer() {
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      );
    }
  };
}

async function run() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "usaspending-awards-")
  );
  const requests = [];
  let statusCalls = 0;
  const fakeFetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (
      String(url) ===
      "https://api.usaspending.gov/api/v2/download/search/"
    ) {
      return jsonResponse({
        status_url:
          "https://api.usaspending.gov/api/v2/download/status/" +
          "?file_name=TEST.zip",
        file_name: "TEST.zip",
        file_url: "/csv_downloads/TEST.zip"
      });
    }
    if (String(url).includes("/api/v2/download/status/")) {
      statusCalls += 1;
      return jsonResponse(statusCalls === 1
        ? { status: "running", file_name: "TEST.zip" }
        : {
            status: "finished",
            file_name: "TEST.zip",
            file_url: "/csv_downloads/TEST.zip",
            total_rows: 42,
            total_size: 6
          });
    }
    if (String(url).includes("/csv_downloads/TEST.zip")) {
      return zipResponse();
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  const service = new Service({
    root,
    fetch: fakeFetch,
    sleep: async () => {},
    pollIntervalMs: 1,
    maxWaitMs: 1000
  });
  const plan = service.plan({
    startDate: "2026-02-01",
    endDate: "2026-07-28"
  });
  assert.strictEqual(plan.mode, "PLAN_ONLY");
  assert.strictEqual(plan.scope.primeAwards, true);
  assert.strictEqual(plan.scope.subawards, true);
  assert.strictEqual(plan.scope.assistanceAwards, false);
  assert.deepStrictEqual(
    plan.request.spending_level,
    ["awards", "subawards"]
  );
  assert(
    plan.request.filters.award_type_codes.includes("IDV_C")
  );
  assert.strictEqual(
    plan.safety.operationalWritesAllowed,
    false
  );

  const result = await service.refresh({
    startDate: "2026-02-01",
    endDate: "2026-07-28",
    runId: "TEST"
  });
  assert.strictEqual(result.status, "COMPLETED");
  assert.strictEqual(result.download.reportedRows, 42);
  assert.strictEqual(result.download.polls, 2);
  assert.strictEqual(
    result.nextGate.operationalAuthorization,
    false
  );
  const request = JSON.parse(
    fs.readFileSync(
      result.artifacts.find(item =>
        item.filePath.endsWith("download_request.json")
      ).filePath,
      "utf8"
    )
  ).request;
  assert.deepStrictEqual(request.filters.time_period, [
    {
      start_date: "2026-02-01",
      end_date: "2026-07-28"
    }
  ]);
  assert.deepStrictEqual(
    request.spending_level,
    ["awards", "subawards"]
  );
  const mergePlan = JSON.parse(
    fs.readFileSync(
      result.artifacts.find(item =>
        item.filePath.endsWith(
          "award_dataset_merge_plan.json"
        )
      ).filePath,
      "utf8"
    )
  );
  assert.strictEqual(
    mergePlan.operationalWriteAuthorized,
    false
  );
  assert.strictEqual(
    mergePlan.deduplication.newestAuthoritativeRecordWins,
    true
  );
  assert(
    requests.some(item => item.options.method === "POST")
  );
  assert.deepStrictEqual(
    cli.parseArgs([
      "--apply",
      "--start=2026-02-01",
      "--end=2026-07-28",
      "--run-id=RUN"
    ]),
    {
      apply: true,
      startDate: "2026-02-01",
      endDate: "2026-07-28",
      runId: "RUN",
      help: false
    }
  );
  assert.throws(
    () => service.resolveOfficialUrl("https://example.com/file.zip"),
    /non-official/
  );
  console.log(
    "USASPENDING_AWARD_HISTORY_STAGING_TEST_PASS 18/18"
  );
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
