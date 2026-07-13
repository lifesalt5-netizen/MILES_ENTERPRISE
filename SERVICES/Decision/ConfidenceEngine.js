"use strict";

class ConfidenceEngine {
  score(input = {}) {
    let score = 70;

    if (input.providerResult?.ok) score += 15;
    if ((input.exceptions || []).length === 0) score += 10;
    if ((input.recommendations || []).length > 0) score += 5;

    if (input.risk?.risk === "MEDIUM") score -= 20;
    if (input.risk?.risk === "HIGH") score -= 45;
    if (input.authority?.approvalRequired) score -= 30;

    score = Math.max(0, Math.min(100, score));

    return {
      ok: true,
      confidenceScore: score,
      confidence:
        score >= 85 ? "HIGH" :
        score >= 60 ? "MEDIUM" :
        "LOW"
    };
  }
}

module.exports = new ConfidenceEngine();