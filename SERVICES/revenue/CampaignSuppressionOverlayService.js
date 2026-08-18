"use strict";

const path = require("path");
const GlobalSuppressionService = require("./GlobalSuppressionService");

function clean(value) {
  return String(value ?? "").trim();
}

class CampaignSuppressionOverlayService {
  constructor(options = {}) {
    this.rootDir = path.resolve(
      options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", "..")
    );
    this.suppression = options.suppression || new GlobalSuppressionService({ rootDir: this.rootDir });
  }

  evaluate(candidate = {}) {
    const email = clean(candidate.email || candidate.contact).toLowerCase();
    if (!email) return { suppressed: false, email, entry: null };
    const entry = this.suppression.get(email);
    return { suppressed: Boolean(entry), email, entry };
  }

  filter(candidates = []) {
    const kept = [];
    const blocked = [];

    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      const evaluation = this.evaluate(candidate);
      if (!evaluation.suppressed) {
        kept.push(candidate);
        continue;
      }

      const reason = clean(evaluation.entry?.reason || evaluation.entry?.category || "GLOBAL_SUPPRESSION");
      blocked.push({
        ...candidate,
        eligible: false,
        track: candidate.track || "BLOCKED",
        blockers: [
          ...(Array.isArray(candidate.blockers) ? candidate.blockers : []),
          `GLOBAL_SUPPRESSION:${reason}`
        ],
        global_suppression: evaluation.entry
      });
    }

    return {
      total: kept.length + blocked.length,
      kept,
      blocked,
      suppressedCount: blocked.length,
      suppressionFile: this.suppression.filePath
    };
  }
}

module.exports = CampaignSuppressionOverlayService;
module.exports.CampaignSuppressionOverlayService = CampaignSuppressionOverlayService;
module.exports.helpers = { clean };
