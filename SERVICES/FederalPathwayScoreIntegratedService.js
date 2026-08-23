"use strict";

const ProspectDemoTruthService = require("./digital_coo/ProspectDemoTruthService");
const FederalPathwayScoreService = require("./FederalPathwayScoreService");

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function verifiedSignal(value, source) {
  return { value: Boolean(value), verified: true, source };
}

function unverifiedSignal(value, source) {
  return { value: Boolean(value), verified: false, source };
}

function supplementalSignal(value) {
  if (!value || typeof value !== "object") return null;
  return {
    value: Boolean(value.value),
    verified: Boolean(value.verified),
    source: value.source ? String(value.source) : null
  };
}

class FederalPathwayScoreIntegratedService {
  constructor(options = {}) {
    this.truthService = options.truthService || new ProspectDemoTruthService(options.truthOptions || {});
    this.scoreService = options.scoreService || new FederalPathwayScoreService(options.scoreOptions || {});
  }

  buildSignals(truth = {}, supplemental = {}) {
    const authoritativeAwards = truth.awardHistory || {};
    const awardSummary = authoritativeAwards.summary || {};
    const authoritativeIdentity = authoritativeAwards.authoritativeForPersistence === true;
    const identityConfirmed = authoritativeIdentity && Boolean(truth.identity?.uei);

    const registrationActive = identityConfirmed && (() => {
      const status = String(truth.identity?.entityStatus || "").trim().toUpperCase();
      if (!status) return true;
      return !["INACTIVE", "EXPIRED", "DEACTIVATED", "INACTIVE REGISTRATION"].includes(status);
    })();

    const vehicleAvailable = Boolean(truth.vehicle?.current);
    const federalSales = authoritativeAwards.available === true && authoritativeIdentity && (
      positiveNumber(awardSummary.federalRevenue) || positiveNumber(awardSummary.awardCount)
    );

    const agencies = list(truth.agencyAlignment?.agencies);
    const buyerRecommendations = list(truth.recommendations?.buyer);
    const opportunities = list(truth.opportunities?.records);
    const partnerRecommendations = list(truth.recommendations?.partner);
    const recompetes = list(truth.recompetes?.records);
    const certificationRecommendations = list(truth.recommendations?.certification);

    const signals = {
      registration: verifiedSignal(
        registrationActive,
        authoritativeIdentity
          ? `Authoritative UEI identity: ${authoritativeAwards.source?.identityAuthority || authoritativeAwards.source?.name || "SAM.gov/USAspending.gov"}`
          : "Authoritative UEI identity not confirmed"
      ),
      vehicleAccess: vehicleAvailable
        ? verifiedSignal(true, "ORION contractors.vehicle direct record")
        : verifiedSignal(false, "ORION contractors.vehicle has no current vehicle record"),
      federalSalesSignal: authoritativeAwards.available === true && authoritativeIdentity
        ? verifiedSignal(federalSales, "USAspending.gov authoritative award-history audit")
        : unverifiedSignal(Boolean(truth.availability?.awardHistory), "Authoritative award history unavailable or identity not persistence-authoritative"),
      agencyAlignment: verifiedSignal(
        agencies.length > 0,
        agencies.length ? "ORION buyers.company_id linked buyer history" : "No linked ORION buyer history"
      ),
      buyerTargeting: buyerRecommendations.length > 0 && agencies.length > 0
        ? verifiedSignal(true, "ORION buyer recommendations supported by linked buyer history")
        : unverifiedSignal(buyerRecommendations.length > 0, "ORION buyer recommendation without sufficient linked buyer evidence"),
      opportunityFit: opportunities.length > 0
        ? verifiedSignal(true, "ORION company-linked opportunity signals after freshness/source filtering")
        : verifiedSignal(false, "No current ORION company-linked opportunity signal survived freshness/source filtering"),
      teamingPath: unverifiedSignal(
        partnerRecommendations.length > 0,
        partnerRecommendations.length
          ? "ORION partner recommendation; independent partner validation required"
          : "No validated partner/team path evidence"
      ),
      recompeteTiming: unverifiedSignal(
        recompetes.length > 0,
        recompetes.length
          ? "ORION recompete decision-support signal; authoritative procurement validation required"
          : "No current recompete decision-support signal"
      ),
      certificationAlignment: unverifiedSignal(
        certificationRecommendations.length > 0,
        certificationRecommendations.length
          ? "ORION certification recommendation; authoritative eligibility/demand validation required"
          : "No validated certification-alignment evidence"
      ),
      captureProcess: unverifiedSignal(false, "Prospect capture-process maturity is not inferred from market data")
    };

    for (const key of Object.keys(signals)) {
      const supplied = supplementalSignal(supplemental[key]);
      if (!supplied) continue;
      if (supplied.verified && supplied.source) {
        signals[key] = supplied;
      }
    }

    return signals;
  }

  evidenceNotes(truth = {}, signals = {}) {
    const notes = [];
    if (truth.opportunities?.available) {
      notes.push("Opportunity-fit points reflect ORION company-linked, freshness/source-filtered decision-support signals; they do not claim a solicitation is confirmed beyond the underlying source record.");
    }
    if (truth.recompetes?.available) {
      notes.push("Recompete signals are shown for planning but do not add score points until independently validated against an authoritative procurement source.");
    }
    if (list(truth.recommendations?.partner).length) {
      notes.push("Partner/team recommendations do not add score points without independent partner-path evidence.");
    }
    if (list(truth.recommendations?.certification).length) {
      notes.push("Certification recommendations do not add score points without authoritative eligibility and demand evidence.");
    }
    if (!signals.captureProcess?.verified) {
      notes.push("Capture-process maturity remains unscored unless direct evidence is supplied; MILES does not infer internal operating maturity from public market data.");
    }
    return notes;
  }

  async evaluate(term, options = {}) {
    const requestTerm = String(term || "").trim();
    if (!requestTerm) {
      return {
        ok: false,
        service: "FEDERAL_PATHWAY_SCORE_INTEGRATED",
        status: "TERM_REQUIRED"
      };
    }

    const truth = await this.truthService.build(requestTerm, {
      ...(options.truthOptions || {}),
      includeAwardHistory: options.includeAwardHistory !== false
    });

    if (!truth?.ok) {
      return {
        ok: false,
        service: "FEDERAL_PATHWAY_SCORE_INTEGRATED",
        status: truth?.status || "TRUTH_BUILD_FAILED",
        error: truth?.error || truth?.reason || null,
        truth
      };
    }

    const signals = this.buildSignals(truth, options.supplementalEvidence || {});
    const score = this.scoreService.evaluate({
      companyName: truth.identity?.name || requestTerm,
      signals
    });

    return {
      ok: true,
      service: "FEDERAL_PATHWAY_SCORE_INTEGRATED",
      version: "1.0.0",
      status: "SCORE_READY",
      generatedAt: new Date().toISOString(),
      request: {
        term: requestTerm,
        companyName: truth.identity?.name || null,
        uei: truth.identity?.uei || null
      },
      score,
      signals,
      evidenceNotes: this.evidenceNotes(truth, signals),
      truthSummary: {
        identity: truth.identity,
        vehicle: truth.vehicle,
        awardHistory: {
          available: truth.awardHistory?.available === true,
          status: truth.awardHistory?.status || null,
          authoritativeForPersistence: truth.awardHistory?.authoritativeForPersistence === true,
          summary: truth.awardHistory?.summary || null,
          source: truth.awardHistory?.source || null
        },
        agencyAlignment: truth.agencyAlignment,
        opportunities: truth.opportunities,
        recompetes: truth.recompetes,
        recommendations: truth.recommendations
      },
      governance: {
        noFabricatedSignals: true,
        authoritativeIdentityAndAwardsPreferred: true,
        modeledRecompetesScorePoints: false,
        modeledPartnerRecommendationsScorePoints: false,
        modeledCertificationRecommendationsScorePoints: false,
        supplementalEvidenceMustBeVerifiedAndSourcedToOverride: true
      }
    };
  }
}

module.exports = FederalPathwayScoreIntegratedService;
module.exports.helpers = { list, positiveNumber, verifiedSignal, unverifiedSignal, supplementalSignal };
