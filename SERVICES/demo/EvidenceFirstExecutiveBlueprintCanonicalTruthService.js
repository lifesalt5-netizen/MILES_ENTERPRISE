'use strict';

const BaseCanonical = require('./ExecutiveBlueprintCanonicalTruthService');

function clean(v){ return String(v == null ? '' : v).trim(); }
function list(v){ return Array.isArray(v) ? v.filter(Boolean) : (v == null || v === '' ? [] : [v]); }
function measurementWindowKnown(aggregate){
  const window=aggregate?.source?.measurementWindow;
  return Boolean(window && clean(window.startDate) && clean(window.endDate));
}

function enforceSolicitationQualificationBoundary(opportunity){
  if (!opportunity?.ok) return opportunity;
  const records=list(opportunity.records).map(row=>{
    const requirementsValidated = row?.solicitationRequirementsValidated === true || row?.requirementValidation?.complete === true;
    const gapState=clean(row?.qualificationGapState);
    const preliminaryCapability = row?.directPursuitCapabilitySupported === true || row?.capabilityStatus === 'DEMONSTRATED_CAPABILITY_SUPPORTED';
    if (requirementsValidated) {
      return { ...row, directPursuitQualified:row?.qualificationTier==='DIRECT_FIT_SUPPORTED', preliminaryCapabilitySupported:preliminaryCapability };
    }
    if (row?.qualificationTier === 'DIRECT_FIT_SUPPORTED' || gapState === 'PRELIMINARY_DIRECT_FIT_SUPPORTED') {
      return {
        ...row,
        preliminaryCapabilitySupported:true,
        directPursuitQualified:false,
        qualificationTier:'SOLICITATION_REQUIREMENT_VALIDATION_REQUIRED',
        recommendationEligible:false,
        allowedAction:'VALIDATE_SOLICITATION_REQUIREMENTS_BEFORE_DIRECT_PURSUIT',
        confidence:'CURRENT_PUBLIC_SOURCE_WITH_PRELIMINARY_CAPABILITY_SUPPORT_REQUIREMENTS_PENDING',
        qualification:[clean(row?.qualification),'Company capability evidence supports this work family, but solicitation-specific requirements have not yet been fully validated.'].filter(Boolean).join('; ')
      };
    }
    if (row?.qualificationTier === 'TEAMING_PATH_SUPPORTED') {
      return {
        ...row,
        preliminaryCapabilitySupported:preliminaryCapability,
        directPursuitQualified:false,
        qualificationTier:'PRELIMINARY_TEAMING_PATH_REQUIREMENT_VALIDATION_REQUIRED',
        recommendationEligible:false,
        allowedAction:'VALIDATE_SOLICITATION_REQUIREMENTS_AND_TEAMING_PATH',
        confidence:'CURRENT_PUBLIC_SOURCE_WITH_PRELIMINARY_TEAMING_PATH_REQUIREMENTS_PENDING'
      };
    }
    return { ...row, directPursuitQualified:false, preliminaryCapabilitySupported:preliminaryCapability };
  });

  const qualification={
    discovered:records.length,
    fullyQualifiedDirectPursuit:records.filter(x=>x.directPursuitQualified===true).length,
    preliminaryCapabilitySupported:records.filter(x=>x.preliminaryCapabilitySupported===true && x.directPursuitQualified!==true).length,
    preliminaryTeamingPath:records.filter(x=>x.qualificationTier==='PRELIMINARY_TEAMING_PATH_REQUIREMENT_VALIDATION_REQUIRED').length,
    nearFitGapClosable:records.filter(x=>x.nearFit===true).length,
    capabilityValidationRequired:records.filter(x=>x.qualificationTier==='CAPABILITY_VALIDATION_REQUIRED').length,
    solicitationRequirementValidationRequired:records.filter(x=>x.qualificationTier==='SOLICITATION_REQUIREMENT_VALIDATION_REQUIRED').length,
    notRecommendedDirectPursuit:records.filter(x=>x.qualificationTier==='NOT_RECOMMENDED_DIRECT_PURSUIT').length,
    recommendationEligible:records.filter(x=>x.recommendationEligible===true).length,
    rule:'Discovery and preliminary capability support are not full qualification. Direct pursuit becomes qualified only after solicitation-specific requirements are extracted and validated against authoritative company evidence.'
  };
  return { ...opportunity, records, qualification, match:{ ...(opportunity.match||{}), qualification } };
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

    const opportunity = enforceSolicitationQualificationBoundary(await this.safeOpportunities(out));
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
      rule:'Company identity, authoritative award history and current vehicle evidence hydrate before opportunity qualification. Preliminary capability support is not full pursuit qualification until solicitation-specific requirements are validated. Missing source coverage remains explicit UNKNOWN/unavailable; conflicts or fabrication fail closed to review.'
    };
    return out;
  }
}

module.exports = EvidenceFirstExecutiveBlueprintCanonicalTruthService;
module.exports.enforceSolicitationQualificationBoundary = enforceSolicitationQualificationBoundary;
