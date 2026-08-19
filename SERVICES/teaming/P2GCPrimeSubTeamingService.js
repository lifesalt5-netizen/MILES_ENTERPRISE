"use strict";

const ExecutiveGrowthBlueprintDemoService = require("../demo/ExecutiveGrowthBlueprintDemoService");

function clean(value) { return String(value == null ? "" : value).trim(); }
function uniq(values) { return [...new Set((values || []).map(clean).filter(Boolean))]; }
function same(a, b) { return clean(a).toUpperCase() === clean(b).toUpperCase(); }

class P2GCPrimeSubTeamingService {
  constructor(options = {}) {
    this.blueprint = options.blueprintService || new ExecutiveGrowthBlueprintDemoService();
  }

  fromBlueprint(model) {
    if (!model?.ok) return model || { ok:false, status:"BLUEPRINT_UNAVAILABLE" };

    const profile = model.profile || {};
    const currentVehicles = Array.isArray(profile.contractVehicles) ? profile.contractVehicles : [];
    const primeRecords = Array.isArray(model.primePartners?.records) ? model.primePartners.records : [];
    const subRecords = Array.isArray(model.subcontracting?.records) ? model.subcontracting.records : [];
    const agencies = Array.isArray(model.agencyAlignment?.agencies) ? model.agencyAlignment.agencies : [];
    const partnerStrategy = Array.isArray(model.primePartners?.strategy) ? model.primePartners.strategy : [];

    const primeCandidates = primeRecords.map((row, index) => {
      const agencyNames = uniq(Array.isArray(row.agencies) ? row.agencies : []);
      const vehicle = clean(row.vehicle) || null;
      const vehicleOverlap = vehicle ? currentVehicles.some(v => same(v, vehicle)) : false;
      return {
        rank:index + 1,
        company:row.company || null,
        uei:row.uei || null,
        vehicle,
        federalRevenue:Number.isFinite(Number(row.federalRevenue)) ? Number(row.federalRevenue) : null,
        awardCount:Number.isFinite(Number(row.awardCount)) ? Number(row.awardCount) : null,
        agencies:agencyNames,
        whyMatched:uniq([
          row.basis,
          vehicleOverlap ? `Prospect and candidate share identified vehicle ${vehicle}.` : null,
          agencyNames.length ? `Candidate has ORION buyer-history signals with ${agencyNames.join(", ")}.` : null
        ]),
        confidence:row.confidence || "MODELED_CANDIDATE",
        contact:{
          status:"UNAVAILABLE_IN_CURRENT_ORION_RECORD",
          sblo:null,
          email:null,
          phone:null,
          note:"Identify and validate the prime contractor SBLO/small-business contact before outreach."
        },
        recommendedNextStep:`Validate ${row.company || "this candidate"} against current contract, vehicle, agency, and subcontracting evidence before outreach.`
      };
    });

    const targetAgencies = agencies.slice(0,10).map((row,index) => ({
      rank:index + 1,
      agency:row.agency || null,
      fitScore:Number.isFinite(Number(row.fitScore)) ? Number(row.fitScore) : null,
      historicalSpend:Number.isFinite(Number(row.historicalSpend)) ? Number(row.historicalSpend) : null,
      awardCount:Number.isFinite(Number(row.awardCount)) ? Number(row.awardCount) : null,
      basis:row.basis || "ORION historical buyer alignment"
    }));

    const recommendedActions = uniq([
      ...partnerStrategy,
      ...primeCandidates.slice(0,5).map(x => x.company ? `Validate ${x.company} as a prime/team partner and identify its current SBLO or small-business contact.` : null),
      ...targetAgencies.slice(0,3).map(x => x.agency ? `Prioritize teaming research around ${x.agency} and confirm which identified primes hold relevant work or vehicles there.` : null),
      subRecords.length ? "Validate current ORION subcontracting/team signals and map each signal to a qualified prime outreach action." : "No current explicit subcontracting signal is identified; use validated prime candidates and agency alignment for relationship development."
    ]).slice(0,12);

    return {
      ok:true,
      service:"P2GC_PRIME_SUB_TEAMING_INTELLIGENCE",
      product:"Sub2Prime™ / Prime-Sub Teaming Intelligence™",
      status:primeCandidates.length || subRecords.length ? "TEAMING_INTELLIGENCE_READY" : "TEAMING_INTELLIGENCE_LIMITED",
      generatedAt:new Date().toISOString(),
      prospect:{
        companyName:profile.companyName || null,
        uei:profile.uei || null,
        cage:profile.cage || null,
        primaryNaics:Array.isArray(profile.naicsCodes) && profile.naicsCodes.length ? profile.naicsCodes[0] : null,
        naicsCodes:Array.isArray(profile.naicsCodes) ? profile.naicsCodes : [],
        certifications:Array.isArray(profile.certifications) ? profile.certifications : [],
        currentVehicles,
        governmentReadiness:model.readiness?.overall ?? null,
        pathway:model.pathway?.type || null
      },
      primeCandidates,
      subcontractingOpportunities:{
        status:model.subcontracting?.status || (subRecords.length ? "ORION_TEAMING_SIGNALS_AVAILABLE" : "NO_CURRENT_TEAMING_SIGNAL_IDENTIFIED"),
        records:subRecords
      },
      targetAgencies,
      positioning:{
        competitorModelStatus:model.competitors?.status || null,
        primeModelStatus:model.primePartners?.status || null,
        agencyModelStatus:model.agencyAlignment?.status || null,
        currentVehicleCount:currentVehicles.length,
        candidatePrimeCount:primeCandidates.length,
        currentTeamingSignalCount:subRecords.length
      },
      recommendedActions,
      evidence:{
        source:"Executive Government Growth Blueprint™ + ORION™",
        disclosure:model.primePartners?.disclosure || model.evidence?.disclosure || "Prime and teaming candidates are decision-support intelligence. Validate modeled signals and current contacts before external reliance."
      },
      safety:{readOnly:true,writesEnabled:false,outreachSent:false,contactsInvented:false}
    };
  }

  build(term, options = {}) {
    const requestedTerm = clean(term);
    if (!requestedTerm) return { ok:false, status:"TERM_REQUIRED", message:"Enter company name, UEI, CAGE, or website." };
    const blueprint = this.blueprint.build(requestedTerm, options);
    return this.fromBlueprint(blueprint);
  }
}

module.exports = P2GCPrimeSubTeamingService;
