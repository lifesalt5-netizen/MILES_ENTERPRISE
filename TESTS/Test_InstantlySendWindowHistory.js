"use strict";

const { isInsideP2gcSendWindow, sentTimestamp, unwrap } = require("../SCRIPTS/AuditInstantlySendWindowHistory");

let passed = 0;
function check(condition, label) { if (!condition) throw new Error(`[FAIL] ${label}`); passed += 1; console.log(`[PASS] ${label}`); }

// August 20, 2026 is Thursday. 13:00Z = 09:00 ET (EDT).
check(isInsideP2gcSendWindow("2026-08-20T13:00:00Z").inside === true, "weekday 09:00 ET is allowed");
check(isInsideP2gcSendWindow("2026-08-20T12:00:00Z").inside === true, "weekday 08:00 ET boundary is allowed");
check(isInsideP2gcSendWindow("2026-08-20T22:00:00Z").inside === true, "weekday 18:00 ET boundary is allowed");
check(isInsideP2gcSendWindow("2026-08-20T11:59:00Z").inside === false, "weekday before 08:00 ET is blocked");
check(isInsideP2gcSendWindow("2026-08-20T22:01:00Z").inside === false, "weekday after 18:00 ET is blocked");
check(isInsideP2gcSendWindow("2026-08-23T12:05:48Z").inside === false, "Sunday 08:05 ET is blocked");
check(isInsideP2gcSendWindow("2026-08-22T14:00:00Z").inside === false, "Saturday is blocked");
check(isInsideP2gcSendWindow("not-a-time").validTimestamp === false, "invalid timestamp fails closed");
check(sentTimestamp({ timestamp_email:"2026-08-20T13:00:00Z", timestamp_created:"2026-08-23T13:00:00Z" }).value === "2026-08-20T13:00:00Z", "actual email timestamp wins over ingestion timestamp");
check(sentTimestamp({ timestamp_created:"2026-08-23T13:00:00Z" }).value === null, "database ingestion timestamp is never send-time evidence");
check(unwrap({ items:[{id:1}] }).length === 1, "Instantly items envelope unwraps");
check(unwrap({ data:[{id:1},{id:2}] }).length === 2, "Instantly data envelope unwraps");

console.log(`INSTANTLY_SEND_WINDOW_HISTORY_TEST_PASS ${passed}/${passed}`);
