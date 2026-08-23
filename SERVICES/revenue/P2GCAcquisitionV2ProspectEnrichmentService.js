'use strict';

const fs = require('fs');
const path = require('path');
const OutboundLeadGovernanceConvergenceService = require('../OutboundLeadGovernanceConvergenceService');
const FederalPathwayScoreIntegratedService = require('../FederalPathwayScoreIntegratedService');

function clean(v) { return String(v || '').trim(); }
function lower(v) { return clean(v).toLowerCase(); }
function normalizeSegment(v) { return clean(v).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      values.push(current); current = '';
    } else current += ch;
  }
  values.push(current);
  return values;
}

function readCsv(file) {
  if (!file || !fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(x => x.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line); const row = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

function offerForSegment(segment) {
  const s = normalizeSegment(segment);
  if (/^GSA_/.test(s) && /(NO_SALES|LOW_SALES|0_500|500K_3M)/.test(s)) return 'GSA_ZERO_SALES_DIAGNOSTIC';
  if (/^SAM_/.test(s) && /(NO_SALES|LOW_SALES)/.test(s)) return 'FEDERAL_REVENUE_GAP_ANALYSIS';
  if (/^(SBS|HUBZONE|WOSB|SDVOSB|VOSB|8A|EIGHT_A)/.test(s)) return 'FEDERAL_REVENUE_GAP_ANALYSIS';
  if (/EXPIR|RECOMPETE|GROWTH_HIGH_VALUE/.test(s)) return 'RECOMPETE_VEHICLE_GROWTH_SCAN';
  if (/GROWTH|CERTIFICATION/.test(s)) return 'FEDERAL_REVENUE_GAP_ANALYSIS';
  return null;
}

function firstName(contactName) {
  return clean(contactName).split(/\s+/)[0] || '';
}

function sourceText(signal) {
  return clean(signal?.source) || 'retained MILES evidence';
}

function evidenceForOffer(offerId, scoreResult) {
  const signals = scoreResult?.signals || {};
  const truth = scoreResult?.truthSummary || {};
  const company = clean(scoreResult?.request?.companyName) || 'the company';

  if (offerId === 'GSA_ZERO_SALES_DIAGNOSTIC') {
    if (signals.vehicleAccess?.verified && signals.vehicleAccess?.value && signals.federalSalesSignal?.verified && !signals.federalSalesSignal?.value) {
      return {
        verified_condition: `${company} has a current contract-vehicle record, while the authoritative award-history check found no federal sales signal for the matched UEI.`,
        verified_condition_source: `${sourceText(signals.vehicleAccess)} + ${sourceText(signals.federalSalesSignal)}`
      };
    }
    if (signals.vehicleAccess?.verified && signals.vehicleAccess?.value) {
      return {
        verified_condition: `${company} has a current contract-vehicle record, but the current pathway review still shows unresolved revenue-positioning gaps that should be validated before increasing bid volume.`,
        verified_condition_source: `${sourceText(signals.vehicleAccess)}; pathway score ${scoreResult?.score?.score ?? 'n/a'} with retained evidence`
      };
    }
    return null;
  }

  if (offerId === 'FEDERAL_REVENUE_GAP_ANALYSIS') {
    if (signals.registration?.verified && signals.registration?.value && signals.federalSalesSignal?.verified && !signals.federalSalesSignal?.value) {
      return {
        verified_condition: `${company} has an authoritative federal identity match, while the authoritative award-history check found no federal sales signal for the matched UEI.`,
        verified_condition_source: `${sourceText(signals.registration)} + ${sourceText(signals.federalSalesSignal)}`
      };
    }
    if (signals.registration?.verified && signals.registration?.value && signals.agencyAlignment?.verified && !signals.agencyAlignment?.value) {
      return {
        verified_condition: `${company} has an authoritative federal identity match, but the current ORION record does not show linked buyer-history evidence for the company.`,
        verified_condition_source: `${sourceText(signals.registration)} + ${sourceText(signals.agencyAlignment)}`
      };
    }
    if (signals.registration?.verified && signals.registration?.value && signals.opportunityFit?.verified && !signals.opportunityFit?.value) {
      return {
        verified_condition: `${company} has an authoritative federal identity match, but no current company-linked opportunity signal survived the present ORION freshness/source filters.`,
        verified_condition_source: `${sourceText(signals.registration)} + ${sourceText(signals.opportunityFit)}`
      };
    }
    return null;
  }

  if (offerId === 'RECOMPETE_VEHICLE_GROWTH_SCAN') {
    if (signals.recompeteTiming?.verified && signals.recompeteTiming?.value) {
      return {
        verified_recompete_or_vehicle_signal: `The current evidence set contains a verified recompete-timing signal for ${company}.`,
        verified_recompete_or_vehicle_signal_source: sourceText(signals.recompeteTiming)
      };
    }
    if (signals.vehicleAccess?.verified && signals.vehicleAccess?.value && truth.vehicle?.current) {
      return {
        verified_recompete_or_vehicle_signal: `${company} has a current vehicle record (${clean(truth.vehicle.current)}), creating a concrete access point for a growth-path review.`,
        verified_recompete_or_vehicle_signal_source: sourceText(signals.vehicleAccess)
      };
    }
    return null;
  }

  return null;
}

class P2GCAcquisitionV2ProspectEnrichmentService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.governance = options.governance || new OutboundLeadGovernanceConvergenceService({ rootDir: this.rootDir });
    this.scoreService = options.scoreService || new FederalPathwayScoreIntegratedService(options.scoreOptions || {});
    this.maxProspects = Number(options.maxProspects || process.env.P2GC_ACQ_V2_ENRICHMENT_CAP || 50);
  }

  async run(options = {}) {
    const convergence = options.governanceResult || this.governance.run();
    if (!convergence?.ok || !convergence?.outputs?.routedFile) {
      return { ok: false, status: 'GOVERNED_LEAD_REPOSITORY_UNAVAILABLE', convergence };
    }

    const rows = readCsv(convergence.outputs.routedFile);
    const requestedOffer = clean(options.offerId).toUpperCase();
    const candidates = rows.filter(row => {
      const offerId = offerForSegment(row.assigned_segment);
      return offerId && (!requestedOffer || offerId === requestedOffer) && lower(row.lead_status) === 'ready';
    }).slice(0, Number(options.maxProspects || this.maxProspects));

    const accepted = [];
    const rejected = [];
    for (const row of candidates) {
      const offerId = offerForSegment(row.assigned_segment);
      const term = clean(row.uei) || clean(row.company_name);
      if (!term) {
        rejected.push({ email: row.email || null, companyName: row.company_name || null, offerId, reason: 'NO_COMPANY_IDENTITY_FOR_TRUTH_REFRESH' });
        continue;
      }

      let scoreResult;
      try {
        scoreResult = await this.scoreService.evaluate(term);
      } catch (error) {
        rejected.push({ email: row.email || null, companyName: row.company_name || null, offerId, reason: 'PATHWAY_SCORE_EXCEPTION', error: error.message });
        continue;
      }
      if (!scoreResult?.ok) {
        rejected.push({ email: row.email || null, companyName: row.company_name || null, offerId, reason: scoreResult?.status || 'PATHWAY_SCORE_UNAVAILABLE' });
        continue;
      }

      const evidence = evidenceForOffer(offerId, scoreResult);
      if (!evidence) {
        rejected.push({ email: row.email || null, companyName: row.company_name || null, offerId, reason: 'NO_SAFE_OUTBOUND_FACT_FROM_CURRENT_EVIDENCE', pathwayScore: scoreResult?.score?.score ?? null });
        continue;
      }

      accepted.push({
        email: lower(row.email),
        first_name: firstName(row.contact_name),
        company_name: clean(scoreResult?.request?.companyName || row.company_name),
        segment: normalizeSegment(row.assigned_segment),
        uei: clean(scoreResult?.request?.uei || row.uei),
        verification_status: clean(row.verification_status),
        verification_source: clean(row.verification_source),
        pathway_score: Number(scoreResult?.score?.score || 0),
        pathway_status: clean(scoreResult?.score?.pathwayStatus),
        offerId,
        ...evidence
      });
    }

    const byOffer = {};
    for (const row of accepted) {
      byOffer[row.offerId] = byOffer[row.offerId] || [];
      byOffer[row.offerId].push(row);
    }

    const outputDir = path.join(this.rootDir, 'DATA', 'runtime', 'revenue', 'p2gc_acquisition_v2');
    fs.mkdirSync(outputDir, { recursive: true });
    const outputFile = path.join(outputDir, 'enriched_pilot_candidates.json');
    const report = {
      ok: true,
      service: 'P2GC_ACQUISITION_V2_PROSPECT_ENRICHMENT',
      generatedAt: new Date().toISOString(),
      governedRowsObserved: rows.length,
      candidatesEvaluated: candidates.length,
      accepted: accepted.length,
      rejected: rejected.length,
      byOffer,
      rejectedRows: rejected,
      outputFile,
      governance: {
        currentTruthRefreshRequired: true,
        authoritativeIdentityAndAwardsPreferred: true,
        modeledRecompeteAloneCannotGenerateOutboundFact: true,
        noSegmentLabelAloneTreatedAsExternalFact: true
      }
    };
    fs.writeFileSync(outputFile, JSON.stringify(report, null, 2), 'utf8');
    return report;
  }
}

module.exports = P2GCAcquisitionV2ProspectEnrichmentService;
module.exports.helpers = { parseCsvLine, readCsv, offerForSegment, evidenceForOffer, normalizeSegment, firstName };
