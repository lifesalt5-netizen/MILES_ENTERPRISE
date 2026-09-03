'use strict';

const BaseCanonical = require('./ExecutiveBlueprintCanonicalTruthService');

function clean(v){ return String(v == null ? '' : v).trim(); }
function list(v){ return Array.isArray(v) ? v.filter(Boolean) : (v == null || v === '' ? [] : [v]); }
function measurementWindowKnown(aggregate){
  const window=aggregate?.source?.measurementWindow;
  return Boolean(window && clean(window.startDate) && clean(window.endDate));
}

class EvidenceFirstExecutiveBlueprintCanonicalTruthService extends BaseCanonical {
  async hydrate(model = {}, options = {}) {
    if (!model?.ok) return model;
    const out = JSON.parse(JSON.stringify(model));
    const uei=clean(out.profile?.uei);
    const companyName=clean(out.profile?.companyName);
    const asOfDate=(this.now || new Date()).toISOString().slice(0,10);

    // Identity/award/vehicle/obligation truth may hydrate concurrently because none of these
    // depends on opportunity qualification. Opportunity qualification MUST run afterward so
    // it sees the company's canonical award descriptions and current GSA/vehicle scope.
    const [award,gsa,aggregate] = await Promise.all([
      this.safeAwardHistory(uei,companyName),
      this.safeGsa(uei,companyName),
      this.aggregateEvidence(uei)
    ]);

    this.applyGsa(out,gsa);
    this.applyAwards(out,award,aggregate,asOfDate);

    const opportunity = await this.safeOpportunities(out);
    this.applyOpportunities(out,opportunity);
    if (out.opportunities) {
      out.opportunities.qualification = opportunity?.qualification || opportunity?.match?.qualification || null;
    }

    out.competitors = { ...(out.competitors||{}), records:BaseCanonical.dedupeEntities(out.competitors?.records).slice(0,10) };
    out.primePartners = { ...(out.primePartners||{}), records:BaseCanonical.dedupeEntities(out.primePartners?.records).slice(0,10) };
    this.rebuildGapsAndPathway(out,award,gsa);
    this.recomputeReadiness(out);
    this.finalIntegrity(out,award,gsa,opportunity,aggregate);

    out.evidence=out.evidence||{};
    out.evidence.canonicalTruth={
      generatedAt:new Date().toISOString(),
      requestedRefresh:options.refresh===true,
      hydrationOrder:'AUTHORITATIVE_COMPANY_EVIDENCE_THEN_OPPORTUNITY_QUALIFICATION',
      awardHistory:{ status:award?.status||null, source:award?.source||null, authoritativeZeroPermitted:award?.dataQuality?.zeroAwardClassificationPermitted===true },
      currentGsa:{ status:gsa?.status||null, holder:gsa?.holder??null, source:gsa?.source||null },
      currentOpportunities:{ status:opportunity?.status||null, source:opportunity?.source||null, returned:list(opportunity?.records).length, qualification:opportunity?.qualification||opportunity?.match?.qualification||null },
      federalObligations:{ status:aggregate?.status||null, source:aggregate?.source||null, measurementWindowKnown:measurementWindowKnown(aggregate) },
      rule:'Company identity, authoritative award history and current vehicle evidence hydrate before opportunity qualification. Missing source coverage remains explicit UNKNOWN/unavailable; conflicts or fabrication fail closed to review.'
    };
    return out;
  }
}

module.exports = EvidenceFirstExecutiveBlueprintCanonicalTruthService;
