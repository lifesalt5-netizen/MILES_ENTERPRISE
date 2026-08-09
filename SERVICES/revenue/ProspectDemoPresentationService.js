"use strict";

const defaultDemoProtection = require("../governance/DemoProtectionService");
const ProspectGrowthAssessmentService = require("./ProspectGrowthAssessmentService");

function list(value, limit = 5) {
  return (Array.isArray(value) ? value : []).filter(Boolean).slice(0, limit);
}

function money(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(number);
}

class ProspectDemoPresentationService {
  constructor(options = {}) {
    this.assessmentService = options.assessmentService || new ProspectGrowthAssessmentService();
    this.demoProtection = options.demoProtection || defaultDemoProtection;
  }

  build(term, options = {}) {
    const policy = this.demoProtection.evaluate({
      demoMode: true,
      payload: { requestedView: "PROSPECT_GROWTH_ASSESSMENT" }
    });

    if (!policy.allowed) {
      return {
        ok: false,
        service: "PROSPECT_DEMO_PRESENTATION",
        status: "DEMO_POLICY_BLOCKED",
        reason: policy.reason,
        policyVersion: policy.policyVersion
      };
    }

    const assessment = this.assessmentService.build(term, options);
    if (!assessment?.ok) {
      return {
        ok: false,
        service: "PROSPECT_DEMO_PRESENTATION",
        status: assessment?.status || "ASSESSMENT_UNAVAILABLE",
        error: assessment?.error || null,
        policyVersion: policy.policyVersion
      };
    }

    const company = assessment.company || {};
    const persona = assessment.persona || {};
    const recommendations = assessment.recommendations || {};

    const buyerAgencies = [...new Set(
      list(assessment.buyerAlignment, 10)
        .map(row => row.agency || row.buyer_name)
        .filter(Boolean)
    )].slice(0, 5);

    const opportunities = list(assessment.linkedOpportunities, 5).map(row => ({
      title: row.title || null,
      source: row.source || null,
      dueDate: row.due_date || null,
      status: row.status || null
    }));

    const recompetes = list(assessment.recompeteSignals, 5).map(row => ({
      title: row.title || null,
      agency: row.agency || null,
      expectedDate: row.recompete_date || null,
      estimatedValue: money(row.value),
      signalType: row.signalType || "ORION_RECOMPETE_SIGNAL",
      qualification: row.prospectClaim || "Validate against an authoritative procurement source before external claim."
    }));

    const presentation = {
      title: `ORION Government Growth Assessment — ${company.company || term}`,
      asOfDate: assessment.asOfDate || null,
      company: {
        name: company.company || null,
        uei: company.uei || null,
        location: [company.city, company.state].filter(Boolean).join(", ") || null,
        primaryNaics: company.primaryNaics || null,
        smallBusiness: company.smallBusinessFlag === "Y",
        currentFederalRevenue: money(company.federalRevenue),
        awardCount: company.awardCount ?? null,
        currentVehicle: company.vehicle || null,
        marketSegment: company.segment || null
      },
      growthProfile: {
        primaryPersona: persona.primary || null,
        secondaryPersona: persona.secondary || null,
        personaScore: persona.score ?? null,
        vehicleGapScore: persona.vehicleGapScore ?? null,
        growthExpansionScore: persona.growthExpansionScore ?? null,
        agencyConcentrationScore: persona.agencyConcentrationScore ?? null
      },
      priorityActions: list(recommendations.topPriorityActions, 5),
      vehicleStrategy: list(recommendations.vehicle, 3),
      buyerStrategy: list(recommendations.buyer, 3),
      partnerStrategy: list(recommendations.partner, 3),
      buyerAlignment: buyerAgencies,
      currentOpportunities: opportunities,
      recompeteSignals: recompetes,
      dataWarnings: list(assessment.dataQuality?.warnings, 5),
      nextStep: "Validate the highest-value growth gap and build the execution pathway with P2GC.",
      disclosure: "ORION is decision-support intelligence. Opportunity and recompete items should be validated against authoritative procurement sources before external reliance."
    };

    return {
      ok: true,
      service: "PROSPECT_DEMO_PRESENTATION",
      status: "DEMO_READY",
      generatedAt: new Date().toISOString(),
      presentation,
      markdown: this.toMarkdown(presentation),
      safety: {
        demoMode: true,
        policyVersion: policy.policyVersion,
        implementationDetailsRedacted: true,
        rawEnterpriseDataRedacted: true,
        databaseMode: assessment.safety?.databaseMode || "READ_ONLY",
        writesEnabled: false,
        emailsSent: false,
        campaignsChanged: false
      }
    };
  }

  toMarkdown(p) {
    const lines = [
      `# ${p.title}`,
      p.asOfDate ? `As of ${p.asOfDate}` : "",
      "",
      "## Company Position",
      `- UEI: ${p.company.uei || "Not available"}`,
      `- Location: ${p.company.location || "Not available"}`,
      `- Primary NAICS: ${p.company.primaryNaics || "Not available"}`,
      `- Federal revenue: ${p.company.currentFederalRevenue || "$0 / not available"}`,
      `- Awards: ${p.company.awardCount ?? "Not available"}`,
      `- Vehicle: ${p.company.currentVehicle || "No confirmed vehicle in current ORION record"}`,
      "",
      "## Growth Profile",
      `- Primary profile: ${p.growthProfile.primaryPersona || "Not available"}`,
      `- Secondary profile: ${p.growthProfile.secondaryPersona || "Not available"}`,
      `- Vehicle gap score: ${p.growthProfile.vehicleGapScore ?? "Not available"}`,
      `- Growth expansion score: ${p.growthProfile.growthExpansionScore ?? "Not available"}`,
      "",
      "## Priority Actions",
      ...((p.priorityActions.length ? p.priorityActions : ["No prioritized actions available."]).map(x => `- ${x}`)),
      "",
      "## Buyer Alignment",
      ...((p.buyerAlignment.length ? p.buyerAlignment : ["No linked buyer history available."]).map(x => `- ${x}`)),
      "",
      "## Current Opportunity Signals",
      ...((p.currentOpportunities.length ? p.currentOpportunities.map(x => `${x.title}${x.dueDate ? ` — due ${x.dueDate}` : ""}`) : ["No current prospect-safe linked opportunities available."]).map(x => `- ${x}`)),
      "",
      "## Recompete Signals",
      ...((p.recompeteSignals.length ? p.recompeteSignals.map(x => `${x.title}${x.expectedDate ? ` — ${x.expectedDate}` : ""} [${x.signalType}]`) : ["No upcoming recompete signals available."]).map(x => `- ${x}`)),
      "",
      "## Recommended Next Step",
      p.nextStep,
      "",
      `_${p.disclosure}_`
    ];

    return lines.filter((line, index) => line !== "" || lines[index - 1] !== "").join("\n");
  }
}

module.exports = ProspectDemoPresentationService;
