'use strict';

const fs = require('fs');
const path = require('path');

function isoNow() { return new Date().toISOString(); }
function exists(filePath) { return Boolean(filePath) && fs.existsSync(filePath); }

class GsaExecutionAcceptanceService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.outputRoot = path.join(this.rootDir, 'DATA', 'orion_refresh', 'gsa_execution');
  }

  run(input = {}) {
    fs.mkdirSync(this.outputRoot, { recursive: true });
    const holder = input.gsaHolderRefresh || {};
    const spending = input.usaspendingRefresh || {};
    const reconciliation = input.gsaReconciliation || {};
    const limitations = Array.isArray(input.limitations) ? input.limitations : [];

    const evidence = {
      authoritativeGsaRefreshProduced: holder.ok === true && exists(holder.manifestPath),
      usaspendingRefreshProduced: spending.ok === true && exists(spending.manifestPath),
      holderReconciliationProduced: reconciliation.ok === true && exists(reconciliation.reportPath),
      samEnrichmentAvailable: holder.rules?.samEnrichmentAvailable !== false,
      stagingOnly: true,
      instantlyPushBlocked: true
    };

    const blockers = [];
    if (!evidence.authoritativeGsaRefreshProduced) blockers.push('AUTHORITATIVE_GSA_REFRESH_NOT_PROVEN');
    if (!evidence.usaspendingRefreshProduced) blockers.push('USASPENDING_REFRESH_NOT_PROVEN');
    if (!evidence.holderReconciliationProduced) blockers.push('GSA_HOLDER_RECONCILIATION_NOT_PROVEN');

    const report = {
      ok: blockers.length === 0,
      status: blockers.length === 0 ? 'STAGING_ACCEPTED' : 'BLOCKED',
      service: 'GsaExecutionAcceptanceService',
      generatedAt: isoNow(),
      evidence,
      counts: {
        currentMasContracts: holder.counts?.currentMasContracts ?? null,
        currentMasRows: holder.counts?.eLibraryRows ?? null,
        newHolders: reconciliation.counts?.newHolders ?? null,
        removedOrExpiredHolders: reconciliation.counts?.removedOrExpiredHolders ?? null,
        changedHolders: reconciliation.counts?.changedHolders ?? null,
        unchangedHolders: reconciliation.counts?.unchanged ?? null,
        usaspendingReportedRows: spending.download?.reportedRows ?? null
      },
      inputPaths: {
        holderManifestPath: holder.manifestPath || null,
        usaspendingManifestPath: spending.manifestPath || null,
        reconciliationReportPath: reconciliation.reportPath || null
      },
      limitations,
      blockers,
      remainingGates: [
        'SALES_AND_AWARD_NORMALIZATION',
        'SEGMENT_RECALCULATION',
        'CONTACT_AND_EMAIL_READINESS',
        'CAMPAIGN_READY_STAGING',
        'SAMPLE_COMPANY_TRUTH_VERIFICATION'
      ],
      fullMissionComplete: false,
      safety: { productionOrionModified: false, instantlyModified: false, stagingOnly: true }
    };
    const reportPath = path.join(this.outputRoot, 'latest_gsa_acceptance_report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    return { ...report, reportPath };
  }
}

module.exports = GsaExecutionAcceptanceService;
