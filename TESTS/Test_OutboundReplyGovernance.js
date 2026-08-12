"use strict";

const { classify } = require("../SERVICES/OutboundReplyGovernanceService");

const cases = [
  ["meeting", { subject: "Re: P2GC", body: "Can we schedule a call next week?" }, "MEETING_REQUEST"],
  ["positive", { body: "Interested. Please send me more information." }, "QUALIFIED_LEAD"],
  ["ooo", { subject: "Automatic reply", body: "I am out of office until Monday." }, "OUT_OF_OFFICE"],
  ["hard bounce", { body: "550 5.1.1 recipient not found" }, "HARD_BOUNCE"],
  ["soft bounce", { body: "Mailbox full, try again later" }, "SOFT_BOUNCE"],
  ["spam", { body: "Proofpoint email security verification required" }, "SPAM_CHALLENGE"],
  ["unsubscribe", { body: "Please remove me from your list" }, "UNSUBSCRIBE"],
  ["nurture", { body: "Not now, circle back next quarter" }, "NURTURE"]
];

const results = cases.map(([name,input,expected]) => ({ name, expected, actual: classify(input).category }));
const failed = results.filter(x => x.expected !== x.actual);
console.log(JSON.stringify({ ok: failed.length === 0, gate: "OUTBOUND_REPLY_GOVERNANCE_TEST", results, failed }, null, 2));
process.exitCode = failed.length ? 1 : 0;
