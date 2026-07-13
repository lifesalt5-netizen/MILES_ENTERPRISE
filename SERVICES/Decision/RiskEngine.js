"use strict";

class RiskEngine {
  evaluate(input = {}) {
    const exceptions = input.exceptions || [];
    const critical = exceptions.filter(e =>
      String(e.severity || "").toLowerCase() === "critical"
    );

    const warning = exceptions.filter(e =>
      String(e.severity || "").toLowerCase() === "warning"
    );

    let risk = "LOW";
    if (critical.length > 0) risk = "HIGH";
    else if (warning.length > 0) risk = "MEDIUM";

    return {
      ok: risk !== "HIGH",
      risk,
      criticalCount: critical.length,
      warningCount: warning.length,
      reason:
        risk === "HIGH"
          ? "Critical provider exceptions detected."
          : risk === "MEDIUM"
            ? "Provider warnings detected."
            : "No material provider risk detected."
    };
  }
}

module.exports = new RiskEngine();