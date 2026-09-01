'use strict';

const ExecutiveGrowthBlueprintDemoService = require('./ExecutiveGrowthBlueprintDemoService');

function text(value) { return String(value == null ? '' : value).trim(); }

class ExecutiveGrowthBlueprintCurrentEvidenceService extends ExecutiveGrowthBlueprintDemoService {
  rawContractor(assessment = {}) {
    const base = super.rawContractor(assessment) || {};
    const sam = assessment?.evidence?.samQualifiedMatch || null;
    if (!sam) return base;
    return {
      ...base,
      cage: sam.cage || base.cage || base.cage_code || null,
      cage_code: sam.cage || base.cage_code || base.cage || null,
      website: sam.website || base.website || null,
      company_website: sam.website || base.company_website || null,
      sam_status: 'A',
      entity_status: 'A',
      expiration_date: sam.registrationExpirationDate || base.expiration_date || null,
      sam_expiration_date: sam.registrationExpirationDate || base.sam_expiration_date || null,
      registration_expiration: sam.registrationExpirationDate || base.registration_expiration || null,
      activation_date: sam.activationDate || base.activation_date || null,
      last_updated: sam.lastUpdateDate || base.last_updated || null,
      primary_naics: sam.primaryNaics || base.primary_naics || null,
      city: sam.city || base.city || null,
      state: sam.state || base.state || null,
      samQualifiedEvidenceSource: 'SAM_QUALIFIED_UNIVERSE'
    };
  }

  revenueModel(company = {}, raw = {}, recommendations = {}) {
    const result = super.revenueModel(company, raw, recommendations);
    if (company.federalRevenue == null || company.federalRevenue === '') {
      result.current.federal = null;
      result.opportunity = {
        status: 'CURRENT_FEDERAL_REVENUE_UNVERIFIED',
        currentFederalRevenue: null,
        modeledPotentialFederalRevenue: null,
        modeledGrowthOpportunity: null,
        disclosure: 'Current federal revenue is unavailable from the linked evidence; no zero value or revenue-growth estimate is inferred.'
      };
    }
    return result;
  }

  build(term, options = {}) {
    const model = super.build(term, options);
    if (!model?.ok) return model;
    const identitySource = text(model?.evidence?.dataQuality?.identitySource);
    const samOnly = identitySource === 'CURRENT_SAM_QUALIFIED_UNIVERSE';
    const samBacked = identitySource.includes('SAM_QUALIFIED');

    model.evidence = model.evidence || {};
    model.evidence.identitySource = identitySource || 'ORION';
    if (samBacked) {
      model.evidence.samRegistrationSource = 'SAM_QUALIFIED_UNIVERSE';
      model.evidence.disclosure = samOnly
        ? 'Company identity and current SAM registration facts come from the governed qualified SAM universe. ORION-linked buyer, award, opportunity, recompete, persona, and recommendation facts remain unavailable unless a real ORION contractor join exists.'
        : 'Company intelligence uses the existing ORION contractor join while current SAM registration facts are reconciled from the governed qualified SAM universe. Modeled outputs remain labeled and unavailable facts are not invented.';
    }

    if (samOnly) {
      model.currentState = model.currentState || {};
      model.currentState.activeContracts = null;
      model.currentState.activeContractsStatus = 'NO_ORION_AWARD_COUNT_AVAILABLE';
      model.currentState.federalSales = null;
      model.revenue = model.revenue || { current: {}, opportunity: {} };
      model.revenue.current = model.revenue.current || {};
      model.revenue.current.federal = null;
      model.pathway = {
        type: 'GOVERNMENT_GROWTH_PATHWAY_REVENUE_EVIDENCE_PENDING',
        title: 'Government Growth Pathway™ — Revenue Evidence Pending',
        steps: [
          'Confirm current federal award and revenue history from authoritative award evidence',
          'Validate agency and buyer history',
          'Identify current contract-vehicle evidence',
          'Match public live, forecast, recompete, and reconstructed opportunity signals',
          'Build prime/sub/team strategy from confirmed capability and award evidence'
        ],
        disclosure: 'First-award versus growth-stage positioning is withheld until federal award/revenue history is reconciled.'
      };
    }

    return model;
  }
}

module.exports = ExecutiveGrowthBlueprintCurrentEvidenceService;
