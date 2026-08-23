'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P2GCAcquisitionV2ProspectEnrichmentService = require('../SERVICES/revenue/P2GCAcquisitionV2ProspectEnrichmentService');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p2gc-enrich-'));
  const routedFile = path.join(root, 'governed.csv');
  fs.writeFileSync(routedFile, [
    'company_name,contact_name,email,uei,verification_status,verification_source,assigned_segment,lead_status',
    'GSA Co,Pat Person,gsa@example.com,GSAUEI,VALID,verified.csv,GSA_NO_SALES,Ready',
    'SAM Co,Sam Person,sam@example.com,SAMUEI,VALID,verified.csv,SAM_NO_SALES,Ready',
    'Growth Co,Gina Person,growth@example.com,GROWTHUEI,VALID,verified.csv,EXPIRING_GSA_12M,Ready',
    'Unknown Co,U Person,unknown@example.com,UNKNOWNUEI,VALID,verified.csv,OTHER,Ready'
  ].join('\n'));

  const scoreService = {
    async evaluate(term) {
      if (term === 'GSAUEI') return {
        ok: true,
        request: { companyName: 'GSA Co', uei: term },
        score: { score: 45, pathwayStatus: 'BLOCKED' },
        signals: {
          vehicleAccess: { value: true, verified: true, source: 'ORION vehicle' },
          federalSalesSignal: { value: false, verified: true, source: 'USAspending award audit' }
        },
        truthSummary: { vehicle: { current: 'GSA MAS' } }
      };
      if (term === 'SAMUEI') return {
        ok: true,
        request: { companyName: 'SAM Co', uei: term },
        score: { score: 35, pathwayStatus: 'BLOCKED' },
        signals: {
          registration: { value: true, verified: true, source: 'SAM.gov identity' },
          federalSalesSignal: { value: false, verified: true, source: 'USAspending award audit' }
        },
        truthSummary: {}
      };
      if (term === 'GROWTHUEI') return {
        ok: true,
        request: { companyName: 'Growth Co', uei: term },
        score: { score: 70, pathwayStatus: 'PARTIALLY_POSITIONED' },
        signals: {
          vehicleAccess: { value: true, verified: true, source: 'ORION vehicle' },
          recompeteTiming: { value: true, verified: false, source: 'modeled ORION signal' }
        },
        truthSummary: { vehicle: { current: 'GSA MAS' } }
      };
      return { ok: false, status: 'NOT_FOUND' };
    }
  };

  const service = new P2GCAcquisitionV2ProspectEnrichmentService({ rootDir: root, scoreService, maxProspects: 10 });
  const report = await service.run({ governanceResult: { ok: true, outputs: { routedFile } } });

  assert.equal(report.ok, true);
  assert.equal(report.candidatesEvaluated, 3);
  assert.equal(report.accepted, 3);
  assert.equal(report.byOffer.GSA_ZERO_SALES_DIAGNOSTIC.length, 1);
  assert.equal(report.byOffer.FEDERAL_REVENUE_GAP_ANALYSIS.length, 1);
  assert.equal(report.byOffer.RECOMPETE_VEHICLE_GROWTH_SCAN.length, 1);
  assert.ok(/no federal sales signal/i.test(report.byOffer.GSA_ZERO_SALES_DIAGNOSTIC[0].verified_condition));
  assert.ok(/authoritative federal identity/i.test(report.byOffer.FEDERAL_REVENUE_GAP_ANALYSIS[0].verified_condition));
  assert.ok(/GSA MAS/.test(report.byOffer.RECOMPETE_VEHICLE_GROWTH_SCAN[0].verified_recompete_or_vehicle_signal));
  assert.equal(report.governance.modeledRecompeteAloneCannotGenerateOutboundFact, true);
  assert.ok(fs.existsSync(report.outputFile));

  console.log('P2GCAcquisitionV2ProspectEnrichmentService tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
