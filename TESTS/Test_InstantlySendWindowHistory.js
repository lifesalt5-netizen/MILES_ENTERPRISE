"use strict";

const {
  isInsideP2gcSendWindow,
  sentTimestamp,
  createdTimestamp,
  isCampaignSentEmail,
  isOnOrAfter,
  unwrap
} = require("../SCRIPTS/AuditInstantlySendWindowHistory");

let passed = 0;
function check(condition, label) { if (!condition) throw new Error(`[FAIL] ${label}`); passed += 1; console.log(`[PASS] ${label}`); }

// August 20, 2026 is Thursday. 13:00Z = 09:00 ET (EDT).
check(isInsideP2gcSendWindow("2026-08-20T13:00:00Z").inside === true, "weekday 09:00 ET is allowed");
check(isInsideP2gcSendWindow("2026-08-20T12:00:00Z").inside === true, "weekday 08:00 ET boundary is allowed");
check(isInsideP2gcSendWindow("2026-08-20T22:00:00Z").inside === true, "weekday 18:00 ET boundary is allowed");
check(isInsideP2gcSendWindow("2026-08-20T11:59:00Z").inside === false, "weekday before 08:00 ET is blocked");
check(isInsideP2gcSendWindow("2026-08-20T22:01:00Z").inside === false, "weekday after 18:00 ET is blocked");
check(isInsideP2gcSendWindow("2026-08-22T14:00:00Z").inside === false, "Saturday is blocked");
check(isInsideP2gcSendWindow("2026-08-23T14:00:00Z").inside === false, "Sunday is blocked");
check(isInsideP2gcSendWindow("not-a-time").validTimestamp === false, "invalid timestamp fails closed");

check(sentTimestamp({ timestamp_email:"2026-08-20T13:00:00Z", timestamp_created:"2026-08-23T13:00:00Z" }) === "2026-08-20T13:00:00Z", "timestamp_email wins over database creation time");
check(sentTimestamp({ sent_at:"2026-08-20T13:00:00Z" }) === "2026-08-20T13:00:00Z", "legacy send timestamp alias resolves");
check(sentTimestamp({ timestamp_created:"2026-08-23T13:00:00Z" }) === null, "timestamp_created alone is never treated as send time");
check(createdTimestamp({ timestamp_created:"2026-08-23T13:00:00Z" }) === "2026-08-23T13:00:00Z", "database creation timestamp remains available as metadata");

check(isCampaignSentEmail({ campaign_id:"campaign-1" }) === true, "campaign_id identifies campaign email");
check(isCampaignSentEmail({ ue_type:1 }) === true, "ue_type 1 identifies campaign email");
check(isCampaignSentEmail({ ue_type:3 }) === false, "manual sent email is outside campaign schedule gate");

check(isOnOrAfter("2026-08-22T22:24:47Z", "2026-08-22T22:24:46Z") === true, "actual email after soak start is in observation window");
check(isOnOrAfter("2026-08-22T22:24:45Z", "2026-08-22T22:24:46Z") === false, "late-ingested pre-soak email is excluded from observation window");

check(unwrap({ items:[{id:1}] }).length === 1, "Instantly items envelope unwraps");
check(unwrap({ data:[{id:1},{id:2}] }).length === 2, "Instantly data envelope unwraps");

console.log(`INSTANTLY_SEND_WINDOW_HISTORY_TEST_PASS ${passed}/${passed}`);
