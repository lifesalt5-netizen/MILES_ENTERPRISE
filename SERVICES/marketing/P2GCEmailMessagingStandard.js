"use strict";

const STANDARD_VERSION = "2026-08-18-cross-generational-v1";

const PRINCIPLES = Object.freeze({
  TRUST_AND_CONSISTENCY: {
    rule: "Sound like the same credible human across every touch. Preserve context from prior interactions and follow through on what was promised.",
    required: true
  },
  STRAIGHTFORWARD_VALUE: {
    rule: "Lead with the buyer's practical problem and the value of resolving it. Remove hype, jargon, gimmicks and unnecessary feature lists.",
    required: true
  },
  PROOF: {
    rule: "Use verifiable proof: live company data, named deliverables, evidence-backed findings, real case studies/testimonials when approved, or side-by-side before/after facts. Never invent proof.",
    required: true
  },
  PERSONALIZATION: {
    rule: "Personalize to the prospect's company, prior conversation, observed need, market, vehicle or pursuit. Personalization must be factual, not inferred demographic stereotyping.",
    required: true
  },
  CONVENIENCE: {
    rule: "Make the next step easy: one question, one reply word, or a short meeting. Do not require the prospect to prepare research for P2GC.",
    required: true
  },
  AUTHENTICITY: {
    rule: "Write in Kevin's natural business voice. Acknowledge prior history accurately. Never pretend a meeting happened, imply urgency that is not real, or use fake familiarity.",
    required: true
  },
  SPEED_AND_CLARITY: {
    rule: "Make the value understandable in the first screen. Prefer short paragraphs, concrete language and one CTA.",
    required: true
  },
  CONSISTENT_FOLLOW_UP: {
    rule: "Follow up consistently without becoming pushy. Each touch should add a new reason to respond, then close the loop respectfully.",
    required: true
  }
});

const PROHIBITED = Object.freeze([
  "AGE_OR_GENERATION_GUESSING",
  "GENERATIONAL_STEREOTYPE_PERSONALIZATION",
  "UNVERIFIED_TESTIMONIALS_OR_RESULTS",
  "FAKE_URGENCY",
  "GENERIC_AI_FLUFF",
  "MULTIPLE_COMPETING_CTAS",
  "LONG_FEATURE_DUMPS_BEFORE_VALUE",
  "FALSE_PRIOR_RELATIONSHIP_CLAIMS"
]);

function compact(text) {
  return String(text ?? "").replace(/\r/g, "").trim();
}

function assessMessage(message = {}) {
  const subject = compact(message.subject);
  const body = compact(message.body);
  const findings = [];

  if (!subject) findings.push("SUBJECT_REQUIRED");
  if (!body) findings.push("BODY_REQUIRED");
  if (subject.length > 70) findings.push("SUBJECT_TOO_LONG");
  if (body.length > 2200) findings.push("BODY_TOO_LONG");

  const ctaMatches = body.match(/\?|reply\s+[\"“']?\w+[\"”']?/gi) || [];
  if (ctaMatches.length > 3) findings.push("TOO_MANY_CTA_SIGNALS");

  if (/guaranteed|guarantee(?:d)? results|double your|10x|act now|limited time/i.test(body)) {
    findings.push("HYPE_OR_UNVERIFIED_URGENCY_REVIEW");
  }

  if (/\b(boomer|millennial|gen[ -]?x|gen[ -]?z|generation z|generation x)\b/i.test(body)) {
    findings.push("GENERATION_LABEL_IN_PROSPECT_COPY");
  }

  return {
    ok: findings.length === 0,
    findings,
    version: STANDARD_VERSION
  };
}

function getStandard() {
  return {
    version: STANDARD_VERSION,
    sourcePrinciples: "Cross-generational synthesis: trust/consistency + straightforward value/proof + personalization/convenience + authenticity/speed.",
    buyerRule: "Do not infer or target age/generation unless the buyer explicitly supplied it for a legitimate use. Use the universal principles instead.",
    principles: PRINCIPLES,
    prohibited: PROHIBITED
  };
}

module.exports = {
  STANDARD_VERSION,
  PRINCIPLES,
  PROHIBITED,
  assessMessage,
  getStandard
};
