'use strict';

const AwardHistoryLocalInventoryService = require('../SERVICES/revenue/AwardHistoryLocalInventoryService');
const SixFiscalYearAwardSourceValidationService = require('../SERVICES/revenue/SixFiscalYearAwardSourceValidationService');
const SixFiscalYearAwardUniverseNormalizerService = require('../SERVICES/revenue/SixFiscalYearAwardUniverseNormalizerService');

async function main() {
  const inventory = new AwardHistoryLocalInventoryService().run();
  const validation = inventory?.ok === true
    ? new SixFiscalYearAwardSourceValidationService().run({ inventory })
    : null;
  const normalization = validation
    ? await new SixFiscalYearAwardUniverseNormalizerService().run({ sourceValidation: validation })
    : { ok:false, status:'LOCAL_AWARD_HISTORY_INVENTORY_REQUIRED' };

  const compactYears = validation?.byYear
    ? Object.fromEntries(Object.entries(validation.byYear).map(([year, value]) => [year, {
        primeReady: value.prime?.ready === true,
        primeFiles: (value.prime?.selected || []).map(item => item.file),
        subcontractReady: value.subcontract?.ready === true,
        subcontractFiles: (value.subcontract?.selected || []).map(item => item.file)
      }]))
    : null;

  const result = {
    ok: normalization?.ok === true,
    status: normalization?.status || validation?.status || inventory?.status || null,
    inventory: inventory ? {
      ok: inventory.ok === true,
      status: inventory.status || null,
      rootsSearched: inventory.rootsSearched || [],
      filesVisited: inventory.filesVisited || 0,
      candidateFiles: inventory.candidateFiles || 0,
      fiscalYearCandidateCounts: inventory.fiscalYears
        ? Object.fromEntries(Object.entries(inventory.fiscalYears).map(([year, value]) => [year, value.candidateCount || 0]))
        : null
    } : null,
    sourceValidation: validation ? {
      ok: validation.ok === true,
      status: validation.status || null,
      readyForSixFiscalYearNormalization: validation.readyForSixFiscalYearNormalization === true,
      inspectedCandidates: validation.inspectedCandidates || 0,
      usableCsvSources: validation.usableCsvSources || 0,
      missingRequirements: validation.missingRequirements || [],
      fiscalYears: compactYears
    } : null,
    normalization: normalization ? {
      ok: normalization.ok === true,
      status: normalization.status || null,
      metrics: normalization.metrics || null,
      roleCounts: normalization.roleCounts || null,
      identityConfidenceCounts: normalization.identityConfidenceCounts || null,
      trajectoryCounts: normalization.trajectoryCounts || null,
      acceptance: normalization.acceptance || null,
      processing: normalization.processing ? {
        sourceRowsRead: normalization.processing.sourceRowsRead,
        sourceRowsAccepted: normalization.processing.sourceRowsAccepted,
        sourceRowsOutsideExpectedFy: normalization.processing.sourceRowsOutsideExpectedFy,
        rowsWithoutUei: normalization.processing.rowsWithoutUei,
        rowsWithoutDefensibleSecondaryIdentity: normalization.processing.rowsWithoutDefensibleSecondaryIdentity,
        identityMergeCount: normalization.processing.identityMergeCount,
        sourceErrors: normalization.processing.sourceErrors
      } : null,
      artifacts: normalization.artifacts || null,
      safety: normalization.safety || null,
      missingRequirements: normalization.missingRequirements || null,
      error: normalization.error || null
    } : null,
    safety: {
      localInventoryReadOnly: true,
      sourceValidationReadOnly: true,
      stagingOnly: true,
      externalAcquisitionTriggered: false,
      currentMasterModified: false,
      productionOrionModified: false,
      providerMutation: false,
      campaignMutation: false,
      emailSent: false,
      suppressionOverridden: false
    }
  };

  // Print the compact result last so the remote bridge's bounded stdout tail
  // always preserves year-by-year source readiness plus the governing counts.
  console.log('MILES_SIX_FY_AWARDED_UNIVERSE_NORMALIZATION_FINAL');
  console.log(JSON.stringify(result, null, 2));
  if (result.ok !== true) process.exitCode = 2;
}

main().catch(error => {
  console.error('MILES_SIX_FY_AWARDED_UNIVERSE_NORMALIZATION_FAILED');
  console.error(error.stack || error.message);
  process.exitCode = 2;
});
