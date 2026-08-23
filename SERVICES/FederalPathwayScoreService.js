"use strict";

const DEFAULT_WEIGHTS = Object.freeze({
  registration: 10,
  vehicleAccess: 10,
  federalSalesSignal: 10,
  agencyAlignment: 15,
  buyerTargeting: 10,
  opportunityFit: 15,
  teamingPath: 10,
  recompeteTiming: 10,
  certificationAlignment: 5,
  captureProcess: 5
});

function normalizeSignal(signal) {
  if (typeof signal === "boolean") {
    return { value: signal, verified: false, source: null };
  }

  if (!signal || typeof signal !== "object") {
    return { value: false, verified: false, source: null };
  }

  return {
    value: Boolean(signal.value),
    verified: Boolean(signal.verified),
    source: signal.source ? String(signal.source) : null
  };
}

class FederalPathwayScoreService {
  constructor(options = {}) {
    this.weights = Object.freeze({
      ...DEFAULT_WEIGHTS,
      ...(options.weights || {})
    });
  }

  evaluate(input = {}) {
    const companyName = String(input.companyName || "Company").trim() || "Company";
    const rawSignals = input.signals && typeof input.signals === "object"
      ? input.signals
      : {};

    const signals = {};
    const evidence = [];
    const warnings = [];
    let score = 0;

    for (const [key, weight] of Object.entries(this.weights)) {
      const signal = normalizeSignal(rawSignals[key]);
      signals[key] = signal;

      if (signal.value && signal.verified) {
        score += Number(weight) || 0;
        evidence.push({ key, source: signal.source || "verified source retained" });
      } else if (signal.value && !signal.verified) {
        warnings.push(`${key} was supplied as positive but is not verified, so it did not increase the score.`);
      }
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const verifiedCount = evidence.length;

    let pathwayStatus;
    if (verifiedCount < 3) {
      pathwayStatus = "NEEDS_VALIDATION";
    } else if (score >= 80) {
      pathwayStatus = "READY";
    } else if (score >= 55) {
      pathwayStatus = "PARTIALLY_POSITIONED";
    } else {
      pathwayStatus = "BLOCKED";
    }

    const actions = this._recommendActions(signals).slice(0, 3);

    return {
      ok: true,
      type: "FEDERAL_PATHWAY_SCORE",
      version: "1.0.0",
      companyName,
      score,
      pathwayStatus,
      verifiedEvidenceCount: verifiedCount,
      topActions: actions,
      evidence,
      warnings,
      disclaimer: "This is an evidence-backed positioning diagnostic, not a guarantee, award forecast, or win probability."
    };
  }

  _recommendActions(signals) {
    const recommendations = [];
    const missing = key => !(signals[key]?.value && signals[key]?.verified);

    if (missing("registration")) {
      recommendations.push("Validate and correct the company's federal registration/foundation before scaling outreach or bidding.");
    }
    if (missing("agencyAlignment") || missing("buyerTargeting")) {
      recommendations.push("Map verified agency demand and buyer targets before expanding opportunity volume.");
    }
    if (missing("opportunityFit")) {
      recommendations.push("Establish a strict opportunity-fit gate so the company pursues fewer, higher-probability paths.");
    }
    if (missing("vehicleAccess")) {
      recommendations.push("Determine whether a contract vehicle, partner vehicle, or alternate acquisition path is required for realistic access.");
    }
    if (missing("teamingPath")) {
      recommendations.push("Evaluate prime-versus-teaming strategy and identify realistic partner pathways.");
    }
    if (missing("recompeteTiming")) {
      recommendations.push("Add recompete/forecast timing intelligence so capture begins before solicitations become last-minute bids.");
    }
    if (missing("captureProcess")) {
      recommendations.push("Install a repeatable capture process connecting targeting, outreach, qualification, and bid/no-bid decisions.");
    }
    if (missing("certificationAlignment")) {
      recommendations.push("Validate whether current or potential certifications materially improve access to real demand before investing further.");
    }
    if (missing("federalSalesSignal")) {
      recommendations.push("Diagnose the gap between current market access and measurable federal sales before adding more activity.");
    }

    return recommendations.length
      ? recommendations
      : ["Maintain current positioning and focus on verified capture execution against the best-fit revenue paths."];
  }
}

module.exports = FederalPathwayScoreService;
