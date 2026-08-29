"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "StartMiles.js"), "utf8");

assert(source.includes("state', 'business_operations_queue.json"), "StartMiles must read the canonical business operations queue");
assert(source.includes("canonicalApprovals()"), "StartMiles must derive approvals from canonical operations");
assert(source.includes("/api/operations/${encodeURIComponent(id)}/${normalizedDecision}"), "Desktop approval decisions must forward to Command Center canonical endpoints");
assert(!source.includes("id:'WEB-001'"), "Legacy hard-coded website approval must be removed");
assert(!source.includes("id:'OUT-001'"), "Legacy hard-coded outbound approval must be removed");

console.log("start_miles_canonical_approval_source.test.js: PASS");
