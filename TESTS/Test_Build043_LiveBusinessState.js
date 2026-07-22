"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const LiveBusinessStateService = require("../SERVICES/LiveBusinessStateService");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "miles-build043-"));
const dataDir = path.join(root, "DATA", "instantly");
fs.mkdirSync(dataDir, { recursive: true });

fs.writeFileSync(
  path.join(dataDir, "latest_campaigns.json"),
  JSON.stringify({
    campaigns: [
      { id: "C-1", status: "active" },
      { id: "C-2", status: "paused" }
    ]
  })
);

fs.writeFileSync(
  path.join(dataDir, "latest_replies.json"),
  JSON.stringify({
    replies: [
      { id: "R-1", classification: "Positive" }
    ]
  })
);

fs.writeFileSync(
  path.join(dataDir, "segment_inventory.json"),
  JSON.stringify({
    segments: [
      { id: "S-1", name: "GSA No Sales", verifiedEmailCount: 250 }
    ]
  })
);

const service = new LiveBusinessStateService({
  root,
  maxAgeDays: 3650
});

const result = service.enrich({
  business: {
    campaigns: [
      { id: "C-1", status: "active" }
    ],
    deals: [
      { id: "D-1", stage: "warm" }
    ]
  }
});

assert.strictEqual(result.snapshot.counts.campaigns, 2);
assert.strictEqual(result.snapshot.counts.replies, 1);
assert.strictEqual(result.snapshot.counts.segments, 1);
assert.strictEqual(result.executiveState.business.campaigns.length, 2);
assert.strictEqual(result.executiveState.business.deals.length, 1);
assert.ok(
  fs.existsSync(
    path.join(root, "DATA", "runtime", "latest_live_business_state.json")
  )
);

console.log("BUILD043 Live Business State test PASSED");
console.log(JSON.stringify(result.snapshot, null, 2));
