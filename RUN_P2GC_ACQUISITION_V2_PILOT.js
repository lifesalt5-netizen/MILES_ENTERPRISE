'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const P2GCAcquisitionV2ProspectEnrichmentService = require('./SERVICES/revenue/P2GCAcquisitionV2ProspectEnrichmentService');
const P2GCAcquisitionV2CampaignService = require('./SERVICES/revenue/P2GCAcquisitionV2CampaignService');

async function main() {
  const rootDir = path.resolve(process.env.MILES_ROOT || process.cwd());
  const execute = String(process.env.P2GC_ACQ_V2_EXECUTE || '').trim().toLowerCase() === 'true';
  const activate = String(process.env.P2GC_ACQ_V2_ACTIVATE || '').trim().toLowerCase() === 'true';
  const maxProspects = Number(process.env.P2GC_ACQ_V2_ENRICHMENT_CAP || 50);
  const requestedOffer = String(process.env.P2GC_ACQ_V2_OFFER || '').trim().toUpperCase();

  const enrichment = new P2GCAcquisitionV2ProspectEnrichmentService({ rootDir, maxProspects });
  const enriched = await enrichment.run({ offerId: requestedOffer, maxProspects });
  if (!enriched?.ok) {
    console.log(JSON.stringify(enriched, null, 2));
    process.exitCode = 1;
    return;
  }

  const campaignService = new P2GCAcquisitionV2CampaignService({ rootDir });
  const offerIds = requestedOffer
    ? [requestedOffer]
    : ['GSA_ZERO_SALES_DIAGNOSTIC', 'FEDERAL_REVENUE_GAP_ANALYSIS', 'RECOMPETE_VEHICLE_GROWTH_SCAN'];

  const deployments = [];
  for (const offerId of offerIds) {
    const leads = Array.isArray(enriched.byOffer?.[offerId]) ? enriched.byOffer[offerId] : [];
    if (!leads.length) {
      deployments.push({ ok: true, offerId, status: 'NO_EVIDENCE_QUALIFIED_PILOT_LEADS', acceptedLeads: 0 });
      continue;
    }
    deployments.push(await campaignService.deploy({ offerId, leads, execute, activate }));
  }

  const result = {
    ok: deployments.every(x => x?.ok !== false),
    service: 'P2GC_ACQUISITION_V2_PILOT_ORCHESTRATOR',
    generatedAt: new Date().toISOString(),
    executeRequested: execute,
    activationRequested: activate,
    maxProspects,
    enrichment: {
      governedRowsObserved: enriched.governedRowsObserved,
      candidatesEvaluated: enriched.candidatesEvaluated,
      accepted: enriched.accepted,
      rejected: enriched.rejected,
      outputFile: enriched.outputFile
    },
    deployments,
    executionTruth: deployments.some(x => x?.executionTruth === 'EXTERNAL_MUTATION_CONFIRMED')
      ? 'EXTERNAL_MUTATION_CONFIRMED'
      : 'NO_EXTERNAL_MUTATION'
  };

  const outDir = path.join(rootDir, 'DATA', 'runtime', 'revenue', 'p2gc_acquisition_v2');
  fs.mkdirSync(outDir, { recursive: true });
  result.outputFile = path.join(outDir, 'pilot_deployment_latest.json');
  fs.writeFileSync(result.outputFile, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
