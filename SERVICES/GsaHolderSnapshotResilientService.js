"use strict";

const fs = require("fs");
const LegacyGsaHolderSnapshotService = require("./GsaHolderSnapshotService");

class GsaHolderSnapshotResilientService extends LegacyGsaHolderSnapshotService {
  constructor(options = {}) {
    super(options);
    this.samEnrichmentWarning = null;
  }

  async loadMonthlyAwards(apiKey, resolved) {
    try {
      const result = await super.loadMonthlyAwards(apiKey, resolved);
      this.samEnrichmentWarning = null;
      return result;
    } catch (error) {
      this.samEnrichmentWarning = {
        code: "SAM_ENRICHMENT_UNAVAILABLE",
        message: String(error && error.message ? error.message : error),
        effect: "Current GSA holder truth remains authoritative from GSA eLibrary; current-month new-holder and SAM-confirmed first-award enrichment are unavailable for this run.",
        nonBlockingForCurrentHolderSnapshot: true
      };
      return {
        awards: [],
        totalRecords: 0,
        degraded: true,
        warning: this.samEnrichmentWarning
      };
    }
  }

  async refresh(options = {}) {
    const result = await super.refresh(options);
    if (!this.samEnrichmentWarning) return result;

    const patched = {
      ...result,
      status: "COMPLETED_WITH_LIMITATION",
      warnings: [
        ...(Array.isArray(result.warnings) ? result.warnings : []),
        this.samEnrichmentWarning
      ],
      counts: {
        ...(result.counts || {}),
        monthlyBaseFssAwardsReturned: null,
        monthlyBaseFssAwardsReported: null,
        newCurrentMasHolders: null,
        currentHoldersWithSamConfirmedFirstAwardDate: null
      },
      rules: {
        ...(result.rules || {}),
        firstAwardDateConfirmedBySAMContractAwards: false,
        samEnrichmentAvailable: false,
        currentHolderConfirmedByELibrary: true
      },
      nextGate: {
        ...(result.nextGate || {}),
        samAwardEnrichmentRetryRequired: true
      }
    };

    if (result.manifestPath) {
      fs.writeFileSync(result.manifestPath, JSON.stringify(patched, null, 2), "utf8");
    }

    return patched;
  }
}

module.exports = GsaHolderSnapshotResilientService;
