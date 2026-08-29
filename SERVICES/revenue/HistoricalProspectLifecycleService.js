"use strict";

const SUPPRESS_PATTERNS = [
  /\bCLIENT\b/i, /\bCUSTOMER\b/i, /ACTIVE[_ -]?CLIENT/i, /PAID[_ -]?CLIENT/i,
  /CURRENT[_ -]?CLIENT/i, /CLOSED[_ -]?WON/i, /\bWON\b/i, /UNSUBSCRIB/i,
  /DO[_ -]?NOT[_ -]?CONTACT/i, /\bDNC\b/i, /BOUNC/i, /NEGATIVE/i, /DISQUALIF/i
];
const HOT_PATTERNS = [
  /ACTIVE[_ -]?PROSPECT/i, /OPEN[_ -]?OPPORTUNITY/i, /MEETING[_ -]?BOOKED/i,
  /CALL[_ -]?SCHEDULED/i, /PROPOSAL[_ -]?(SENT|PENDING|OPEN)?/i, /\bENGAGED\b/i, /NEGOTIAT/i
];
const REACTIVATION_RELATIONSHIPS = new Set(["NO_SHOW", "RESCHEDULED_UNCONFIRMED"]);
const NURTURE_RELATIONSHIPS = new Set(["PRIOR_CONVERSATION", "COMPLETED"]);
const BUCKETS = Object.freeze({ HOT:"HOT", REACTIVATION:"REACTIVATION", NURTURE:"NURTURE", SUPPRESS:"SUPPRESS", REVIEW:"REVIEW" });

function clean(v) { return String(v ?? "").trim(); }
function matches(value, patterns) { return patterns.some(pattern => pattern.test(clean(value))); }

function classify(candidate = {}) {
  const status = clean(candidate.crm_status || candidate.status || candidate.lead_status).toUpperCase();
  const relationship = clean(candidate.relationship_status || candidate.meeting_status).toUpperCase();
  const blockers = Array.isArray(candidate.blockers) ? candidate.blockers.map(clean).filter(Boolean) : [];

  if (candidate.unsubscribed === true || candidate.do_not_contact === true || matches(status, SUPPRESS_PATTERNS) || blockers.some(x => /^SUPPRESSED_STATUS:/i.test(x) || x === "DO_NOT_CONTACT")) {
    return { bucket: BUCKETS.SUPPRESS, protectedFromWinBack: true, reason: "SUPPRESSION_SIGNAL" };
  }
  if (matches(status, HOT_PATTERNS) || blockers.some(x => /^ACTIVE_PIPELINE_REVIEW:/i.test(x))) {
    return { bucket: BUCKETS.HOT, protectedFromWinBack: true, reason: "ACTIVE_PIPELINE_SIGNAL" };
  }
  if (REACTIVATION_RELATIONSHIPS.has(relationship) || clean(candidate.track).toUpperCase() === "REACTIVATION") {
    return { bucket: BUCKETS.REACTIVATION, protectedFromWinBack: false, reason: "REACTIVATION_RELATIONSHIP" };
  }
  if (NURTURE_RELATIONSHIPS.has(relationship) || clean(candidate.track).toUpperCase() === "PRIOR_CONVERSATION") {
    return { bucket: BUCKETS.NURTURE, protectedFromWinBack: false, reason: "PRIOR_CONVERSATION_NO_ACTIVE_SIGNAL" };
  }
  return { bucket: BUCKETS.REVIEW, protectedFromWinBack: true, reason: "INSUFFICIENT_LIFECYCLE_EVIDENCE" };
}

function applyToReconstruction(reconstruction = {}) {
  const all = [
    ...(reconstruction.priorConversationCandidates || []),
    ...(reconstruction.reactivationCandidates || []),
    ...(reconstruction.blocked || [])
  ];
  const seen = new Set();
  const records = [];
  for (const candidate of all) {
    const key = clean(candidate.email).toLowerCase() || `${clean(candidate.full_name).toUpperCase()}|${clean(candidate.meeting_date)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lifecycle = classify(candidate);
    records.push({ ...candidate, lifecycle_bucket: lifecycle.bucket, lifecycle_reason: lifecycle.reason, protected_from_winback: lifecycle.protectedFromWinBack });
  }
  const byBucket = Object.fromEntries(Object.values(BUCKETS).map(bucket => [bucket, records.filter(x => x.lifecycle_bucket === bucket)]));
  return {
    records,
    byBucket,
    counts: Object.fromEntries(Object.entries(byBucket).map(([bucket, rows]) => [bucket, rows.length])),
    campaignEligible: {
      NURTURE: byBucket.NURTURE.filter(x => x.eligible === true),
      REACTIVATION: byBucket.REACTIVATION.filter(x => x.eligible === true)
    },
    rules: {
      hotNeverAutoEnrolledInWinBack: true,
      suppressNeverAutoEnrolledInWinBack: true,
      reviewNeverAutoEnrolledInWinBack: true,
      lifecycleTaxonomy: ["HOT", "REACTIVATION", "NURTURE", "SUPPRESS", "REVIEW"]
    }
  };
}

module.exports = { BUCKETS, classify, applyToReconstruction, SUPPRESS_PATTERNS, HOT_PATTERNS };
