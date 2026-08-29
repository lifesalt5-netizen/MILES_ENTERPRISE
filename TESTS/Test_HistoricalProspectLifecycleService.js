"use strict";

const assert = require("assert");
const Lifecycle = require("../SERVICES/revenue/HistoricalProspectLifecycleService");

function row(overrides = {}) {
  return {
    email: "person@example.com",
    full_name: "Example Person",
    eligible: true,
    blockers: [],
    ...overrides
  };
}

assert.deepStrictEqual(
  Lifecycle.classify(row({ crm_status: "OPEN_OPPORTUNITY", relationship_status: "PRIOR_CONVERSATION", blockers:["ACTIVE_PIPELINE_REVIEW:OPEN_OPPORTUNITY"] })),
  { bucket:"HOT", protectedFromWinBack:true, reason:"ACTIVE_PIPELINE_SIGNAL" }
);
assert.deepStrictEqual(
  Lifecycle.classify(row({ crm_status: "UNSUBSCRIBED", relationship_status: "PRIOR_CONVERSATION", blockers:["SUPPRESSED_STATUS:UNSUBSCRIBED"] })),
  { bucket:"SUPPRESS", protectedFromWinBack:true, reason:"SUPPRESSION_SIGNAL" }
);
assert.deepStrictEqual(
  Lifecycle.classify(row({ relationship_status: "NO_SHOW", track:"REACTIVATION" })),
  { bucket:"REACTIVATION", protectedFromWinBack:false, reason:"REACTIVATION_RELATIONSHIP" }
);
assert.deepStrictEqual(
  Lifecycle.classify(row({ relationship_status: "COMPLETED", track:"PRIOR_CONVERSATION" })),
  { bucket:"NURTURE", protectedFromWinBack:false, reason:"PRIOR_CONVERSATION_NO_ACTIVE_SIGNAL" }
);
assert.deepStrictEqual(
  Lifecycle.classify(row({ relationship_status: "UNKNOWN", track:"BLOCKED", eligible:false, blockers:["CONTACT_MATCH_REQUIRED"] })),
  { bucket:"REVIEW", protectedFromWinBack:true, reason:"INSUFFICIENT_LIFECYCLE_EVIDENCE" }
);

const reconstruction = {
  priorConversationCandidates: [
    row({ email:"nurture@example.com", relationship_status:"PRIOR_CONVERSATION", track:"PRIOR_CONVERSATION" })
  ],
  reactivationCandidates: [
    row({ email:"reactivate@example.com", relationship_status:"NO_SHOW", track:"REACTIVATION" })
  ],
  blocked: [
    row({ email:"hot@example.com", crm_status:"NEGOTIATION", relationship_status:"PRIOR_CONVERSATION", track:"PRIOR_CONVERSATION", eligible:false, blockers:["ACTIVE_PIPELINE_REVIEW:NEGOTIATION"] }),
    row({ email:"suppress@example.com", crm_status:"DO_NOT_CONTACT", relationship_status:"PRIOR_CONVERSATION", track:"PRIOR_CONVERSATION", eligible:false, blockers:["SUPPRESSED_STATUS:DO_NOT_CONTACT"] }),
    row({ email:"review@example.com", relationship_status:"AMBIGUOUS", track:"BLOCKED", eligible:false, blockers:["AMBIGUOUS_CONTACT_MATCH"] })
  ]
};

const applied = Lifecycle.applyToReconstruction(reconstruction);
assert.deepStrictEqual(applied.counts, { HOT:1, REACTIVATION:1, NURTURE:1, SUPPRESS:1, REVIEW:1 });
assert.equal(applied.campaignEligible.NURTURE.length, 1);
assert.equal(applied.campaignEligible.REACTIVATION.length, 1);
assert.equal(applied.byBucket.HOT[0].protected_from_winback, true);
assert.equal(applied.byBucket.SUPPRESS[0].protected_from_winback, true);
assert.equal(applied.rules.hotNeverAutoEnrolledInWinBack, true);
assert.equal(applied.rules.suppressNeverAutoEnrolledInWinBack, true);

console.log("HISTORICAL_PROSPECT_LIFECYCLE_TEST=PASS");
