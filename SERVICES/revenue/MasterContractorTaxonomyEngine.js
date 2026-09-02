'use strict';

const fs = require('fs');
const path = require('path');

function clean(value) { return value == null ? '' : String(value).trim(); }
function n(value) {
  const parsed = Number(String(value == null ? '' : value).replace(/[$,]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}
function salesBand(value) {
  const amount = n(value);
  if (amount == null) return 'UNKNOWN';
  if (amount === 0) return '0';
  if (amount < 100000) return 'lt_100k';
  if (amount < 500000) return '100k_500k';
  if (amount < 1000000) return '500k_1m';
  if (amount < 3000000) return '1m_3m';
  if (amount < 5000000) return '3m_5m';
  if (amount < 10000000) return '5m_10m';
  if (amount < 25000000) return '10m_25m';
  if (amount < 50000000) return '25m_50m';
  if (amount < 100000000) return '50m_100m';
  return '100m_plus';
}
function awardRole({ primeAwardCount, subawardCount }) {
  const prime = Number(primeAwardCount || 0) > 0;
  const sub = Number(subawardCount || 0) > 0;
  if (prime && sub) return 'BOTH';
  if (prime) return 'PRIME';
  if (sub) return 'SUB';
  return 'NO_PROVEN_AWARD_ROLE';
}
function recencyBand(fiscalYear) {
  const fy = Number(fiscalYear || 0);
  if (fy === 2026) return 'AWARD_CURRENT_FY';
  if (fy === 2025) return 'AWARD_PRIOR_1Y';
  if (fy === 2024) return 'AWARD_PRIOR_2Y';
  if (fy === 2023) return 'AWARD_PRIOR_3Y';
  if (fy === 2022) return 'AWARD_PRIOR_4Y';
  if (fy === 2021) return 'AWARD_PRIOR_5Y';
  return 'UNKNOWN';
}
function contactReadiness({ verifiedEmail, unsuppressedEmail, phone, linkedin, suppressedContact }) {
  const tags = [];
  if (verifiedEmail) tags.push('VERIFIED_EMAIL');
  else if (unsuppressedEmail) tags.push('UNVERIFIED_EMAIL');
  if (phone) tags.push('PHONE');
  if (linkedin) tags.push('LINKEDIN');
  if (suppressedContact) tags.push('SUPPRESSED_CONTACT');
  if (!tags.length) tags.push('NO_CURRENT_CONTACT');
  return tags;
}
function enrichmentState({ companyKnown, verifiedEmail, unsuppressedEmail }) {
  if (!companyKnown) return 'COMPANY_IDENTITY_REQUIRED';
  if (verifiedEmail) return 'COMPLETE';
  if (unsuppressedEmail) return 'CONTACT_VERIFICATION_REQUIRED';
  return 'CONTACT_REQUIRED';
}
function commercialDisposition({ existingClient, accountDoNotProspect, companyKnown, verifiedEmail, unsuppressedEmail, hasAwardHistory }) {
  if (existingClient) return 'EXISTING_CLIENT';
  if (accountDoNotProspect) return 'SUPPRESSED';
  if (!companyKnown) return 'NEEDS_ENRICHMENT';
  if (verifiedEmail && hasAwardHistory) return 'QUALIFIED';
  if (unsuppressedEmail && hasAwardHistory) return 'NEEDS_ENRICHMENT';
  if (hasAwardHistory) return 'NEEDS_ENRICHMENT';
  return 'UNKNOWN_NOT_YET_EVALUATED';
}
function primaryFallbackSegment(role, band) {
  const normalizedRole = String(role || 'UNKNOWN').toLowerCase();
  const normalizedBand = String(band || 'UNKNOWN').toLowerCase();
  return `awarded_${normalizedRole}_${normalizedBand}`;
}

class MasterContractorTaxonomyEngine {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.taxonomyPath = path.join(this.rootDir, 'DATA', 'registry', 'P2GCMasterContractorSegmentationTaxonomy.json');
    this.lookbackPath = path.join(this.rootDir, 'DATA', 'registry', 'AwardHistoryLookbackPolicy.json');
  }

  validateRegistries() {
    const taxonomy = JSON.parse(fs.readFileSync(this.taxonomyPath, 'utf8'));
    const lookback = JSON.parse(fs.readFileSync(this.lookbackPath, 'utf8'));
    if (taxonomy.architecture !== 'MULTI_DIMENSIONAL_NON_MUTUALLY_EXCLUSIVE') throw new Error('MASTER_TAXONOMY_ARCHITECTURE_INVALID');
    if (taxonomy.governingRules?.unknownMustRemainDistinctFromZero !== true) throw new Error('MASTER_TAXONOMY_UNKNOWN_ZERO_RULE_MISSING');
    if (lookback.sourceReusePolicy?.inventoryExistingLocalHistoryFirst !== true) throw new Error('AWARD_LOOKBACK_LOCAL_REUSE_RULE_MISSING');
    return { taxonomy, lookback };
  }

  classify(input = {}) {
    this.validateRegistries();
    const totalGovernmentSales = n(input.totalGovernmentSales);
    const band = salesBand(totalGovernmentSales);
    const role = awardRole(input);
    const hasAwardHistory = role !== 'NO_PROVEN_AWARD_ROLE';
    const currentFyAwarded = Number(input.fy2026PrimeAwardCount || 0) > 0 || Number(input.fy2026SubawardCount || 0) > 0;
    const tags = new Set();

    tags.add(`award_role:${role}`);
    tags.add(`government_sales_band:${band}`);
    tags.add(`award_history:${currentFyAwarded ? 'CURRENT_FY_AWARDED' : hasAwardHistory ? 'HISTORICAL_AWARDED' : 'NO_PROVEN_AWARD'}`);
    if (hasAwardHistory) tags.add(`award_recency:${recencyBand(input.mostRecentAwardFiscalYear)}`);

    for (const value of input.existingTaxonomyTags || []) if (clean(value)) tags.add(clean(value));
    for (const value of contactReadiness(input)) tags.add(`contact_channel_readiness:${value}`);
    tags.add(`enrichment_state:${enrichmentState(input)}`);
    if (input.currentSamQualified === true) tags.add('government_market_status:FEDERAL_ACTIVE');
    else if (hasAwardHistory) tags.add('government_market_status:FEDERAL_HISTORICAL');
    else tags.add('government_market_status:UNKNOWN');

    const disposition = commercialDisposition({ ...input, hasAwardHistory });
    const nextAction = disposition === 'EXISTING_CLIENT' ? 'CLIENT_SUCCESS_OR_EXPANSION_REVIEW'
      : disposition === 'SUPPRESSED' ? 'NO_OUTREACH_PRESERVE_SUPPRESSION'
      : !input.companyKnown ? 'ENRICH_COMPANY_IDENTITY'
      : input.verifiedEmail ? 'SEGMENT_AND_PRIORITIZE_FOR_GOVERNED_OUTREACH'
      : input.unsuppressedEmail ? 'VERIFY_CURRENT_CONTACT_EMAIL'
      : 'DISCOVER_CURRENT_DECISION_MAKER';

    return {
      awardRole: role,
      governmentSalesBand: band,
      awardRecency: hasAwardHistory ? recencyBand(input.mostRecentAwardFiscalYear) : 'UNKNOWN',
      allSegmentTags: [...tags].sort(),
      commercialDisposition: disposition,
      nextAction,
      primaryFallbackSegment: primaryFallbackSegment(role, band)
    };
  }
}

module.exports = MasterContractorTaxonomyEngine;
module.exports.salesBand = salesBand;
module.exports.awardRole = awardRole;
module.exports.recencyBand = recencyBand;
module.exports.contactReadiness = contactReadiness;
module.exports.enrichmentState = enrichmentState;
module.exports.primaryFallbackSegment = primaryFallbackSegment;
