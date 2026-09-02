'use strict';

function clean(value) { return value == null ? '' : String(value).trim(); }
function numOrNull(value) {
  if (value === null || value === undefined || clean(value) === '') return null;
  const parsed = Number(String(value).replace(/[$,]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function governmentSalesBand(value) {
  const amount = numOrNull(value);
  if (amount === null) return 'UNKNOWN';
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

function commercialDisposition(input = {}) {
  if (input.accountDoNotProspect) return 'SUPPRESSED';
  if (input.existingClient) return 'EXISTING_CLIENT';
  if (input.inactive) return 'INACTIVE';
  if (input.verifiedContact && input.reasonToContactNow) return 'CONTACT_NOW';
  if (input.verifiedContact && input.highPriority) return 'HIGH_PRIORITY';
  if (input.verifiedContact && input.commerciallyQualified) return 'QUALIFIED';
  if (input.companyKnown && !input.verifiedContact) return 'NEEDS_ENRICHMENT';
  if (input.watchTrigger) return 'WATCH_TRIGGER';
  if (input.noCurrentFit) return 'NO_CURRENT_FIT';
  if (input.companyKnown) return 'NURTURE';
  return 'UNKNOWN_NOT_YET_EVALUATED';
}

function nextAction(input = {}) {
  const disposition = input.commercialDisposition || commercialDisposition(input);
  const map = {
    CONTACT_NOW: 'ROUTE_TO_PRIORITY_OUTREACH',
    HIGH_PRIORITY: 'PREPARE_PRIORITY_OUTREACH',
    QUALIFIED: 'QUEUE_FOR_OUTBOUND',
    NEEDS_ENRICHMENT: input.hasUnsuppressedEmail ? 'VERIFY_CURRENT_CONTACT' : 'DISCOVER_CURRENT_DECISION_MAKER',
    WATCH_TRIGGER: 'MONITOR_TRIGGER',
    NURTURE: 'PLACE_IN_NURTURE',
    EXISTING_CLIENT: 'ROUTE_TO_CLIENT_LIFECYCLE',
    FORMER_CLIENT: 'ROUTE_TO_REACTIVATION',
    NO_CURRENT_FIT: 'RETAIN_FOR_REEVALUATION',
    SUPPRESSED: 'DO_NOT_CONTACT',
    INACTIVE: 'RETAIN_INACTIVE_EVIDENCE',
    UNKNOWN_NOT_YET_EVALUATED: 'QUALIFY_ACCOUNT'
  };
  return map[disposition] || 'QUALIFY_ACCOUNT';
}

function baseTaxonomy(input = {}) {
  const tags = new Set();
  const role = ['PRIME', 'SUB', 'BOTH'].includes(input.awardRole) ? input.awardRole : 'NO_PROVEN_AWARD_ROLE';
  const salesBand = governmentSalesBand(input.totalGovernmentSales);
  tags.add(`award_role:${role}`);
  tags.add(`government_sales_band:${salesBand}`);
  tags.add(`award_history:${input.currentFyAwarded ? 'CURRENT_FY_AWARDED' : input.historicalAwarded ? 'HISTORICAL_AWARDED' : 'NO_PROVEN_AWARD'}`);

  if (input.currentSamQualified === true) tags.add('government_market_status:FEDERAL_ACTIVE');
  else if (input.currentFyAwarded || input.historicalAwarded) tags.add('government_market_status:FEDERAL_HISTORICAL');
  else tags.add('government_market_status:UNKNOWN');

  if (input.verifiedContact) tags.add('contact_channel_readiness:VERIFIED_EMAIL');
  else if (input.hasUnsuppressedEmail) tags.add('contact_channel_readiness:UNVERIFIED_EMAIL');
  else tags.add('contact_channel_readiness:NO_CURRENT_CONTACT');

  if (input.accountDoNotProspect) tags.add('suppression_state:ACCOUNT_DO_NOT_PROSPECT');
  else tags.add('suppression_state:CLEAR');

  if (!input.companyKnown) tags.add('enrichment_state:COMPANY_IDENTITY_REQUIRED');
  else if (input.verifiedContact) tags.add('enrichment_state:COMPLETE');
  else if (input.hasUnsuppressedEmail) tags.add('enrichment_state:CONTACT_VERIFICATION_REQUIRED');
  else tags.add('enrichment_state:CONTACT_REQUIRED');

  for (const tag of input.existingSegmentTags || []) if (clean(tag)) tags.add(clean(tag));

  const disposition = commercialDisposition({
    ...input,
    companyKnown: Boolean(input.companyKnown),
    commerciallyQualified: input.commerciallyQualified !== false && Boolean(input.currentFyAwarded || input.historicalAwarded || input.currentSamQualified)
  });

  return {
    awardRole: role,
    governmentSalesBand: salesBand,
    allSegmentTags: [...tags].sort(),
    commercialDisposition: disposition,
    nextAction: nextAction({ ...input, commercialDisposition: disposition }),
    scores: {
      FIT: input.scores?.FIT ?? 'UNKNOWN',
      INTENT: input.scores?.INTENT ?? 'UNKNOWN',
      URGENCY: input.scores?.URGENCY ?? 'UNKNOWN',
      VALUE: input.scores?.VALUE ?? 'UNKNOWN',
      CONTACTABILITY: input.scores?.CONTACTABILITY ?? 'UNKNOWN',
      P2GC_SERVICE_MATCH: input.scores?.P2GC_SERVICE_MATCH ?? 'UNKNOWN',
      OVERALL_REVENUE_PRIORITY: input.scores?.OVERALL_REVENUE_PRIORITY ?? 'UNKNOWN'
    },
    reasonToContactNow: clean(input.reasonToContactNow) || 'UNKNOWN'
  };
}

module.exports = {
  governmentSalesBand,
  commercialDisposition,
  nextAction,
  baseTaxonomy
};
