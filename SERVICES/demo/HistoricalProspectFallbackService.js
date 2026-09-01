'use strict';

const fs = require('fs');
const path = require('path');

function clean(value) { return String(value == null ? '' : value).trim(); }
function normalize(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function canonicalName(value) {
  const tokens = normalize(value).split(' ').filter(Boolean);
  const suffixes = new Set(['LLC','L L C','INC','INCORPORATED','CORP','CORPORATION','COMPANY','CO','LTD','LIMITED','LP','LLP','PLLC']);
  while (tokens.length && suffixes.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}
function uniq(values) { return [...new Set((values || []).map(clean).filter(Boolean))]; }
function numberOrNull(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }

class HistoricalProspectFallbackService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.reportPath = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_contract_sidecar_build.json');
    this.Database = options.Database || null;
    this.db = null;
    this.dbPath = null;
  }

  sourceStatus() {
    let report = null;
    try { report = JSON.parse(fs.readFileSync(this.reportPath, 'utf8').replace(/^\uFEFF/, '')); } catch {}
    const database = report?.sidecarDb ? path.resolve(report.sidecarDb) : null;
    const usable = Boolean(
      report?.ok === true &&
      report?.validation?.ok === true &&
      report?.validation?.integrity === 'ok' &&
      report?.safety?.sidecarOnly === true &&
      report?.safety?.productionDatabaseModified === false &&
      database && fs.existsSync(database)
    );
    return {
      usable,
      reportPath: this.reportPath,
      database: usable ? database : null,
      source: usable ? report?.source || null : null,
      validation: usable ? report?.validation || null : null,
      reason: usable ? null : 'ORION_VALIDATED_SIDECAR_NOT_USABLE'
    };
  }

  open() {
    const status = this.sourceStatus();
    if (!status.usable) return null;
    if (this.db && this.dbPath !== status.database) {
      try { this.db.close(); } catch {}
      this.db = null;
      this.dbPath = null;
    }
    if (!this.db) {
      if (!this.Database) this.Database = require('better-sqlite3');
      this.db = new this.Database(status.database, { readonly: true, fileMustExist: true });
      this.dbPath = status.database;
    }
    return this.db;
  }

  candidateRows(term) {
    const db = this.open();
    if (!db) return [];
    const target = canonicalName(term);
    const meaningful = target.split(' ').filter(token => token.length >= 3);
    const anchor = [...meaningful].sort((a, b) => b.length - a.length)[0];
    if (!anchor) return [];
    return db.prepare(`
      SELECT uei, recipient_name, COUNT(*) AS award_count,
             SUM(obligation) AS federal_obligations,
             MAX(action_date_last) AS latest_action_date
      FROM orion_award_refresh_fy2026
      WHERE recipient_name LIKE ? COLLATE NOCASE
      GROUP BY uei, recipient_name
      ORDER BY ABS(SUM(obligation)) DESC
      LIMIT 100
    `).all(`%${anchor}%`);
  }

  select(term, rows = []) {
    const target = canonicalName(term);
    const matches = rows.filter(row => canonicalName(row?.recipient_name) === target);
    const byUei = new Map();
    for (const row of matches) if (clean(row?.uei)) byUei.set(clean(row.uei).toUpperCase(), row);
    const unique = [...byUei.values()];
    if (unique.length === 1) return { ok: true, row: unique[0], matchedBy: 'USA_SPENDING_RECIPIENT_NAME_CANONICAL' };
    if (unique.length > 1) return { ok: false, status: 'HISTORICAL_IDENTITY_AMBIGUOUS', candidates: unique };
    return { ok: false, status: 'HISTORICAL_IDENTITY_NOT_FOUND', candidates: [] };
  }

  details(uei) {
    const db = this.open();
    if (!db) return { summary: null, buyers: [], recompetes: [], naicsCodes: [] };
    const key = clean(uei).toUpperCase();
    const summary = db.prepare(`SELECT uei, federal_obligations, award_count, latest_action_date, refreshed_at
      FROM orion_contractor_fy2026_summary WHERE UPPER(uei)=?`).get(key) || null;
    const buyers = db.prepare(`SELECT buyer_name, agency, award_count, spend, refreshed_at
      FROM orion_buyer_fy2026_summary WHERE UPPER(uei)=? ORDER BY spend DESC, award_count DESC LIMIT 10`).all(key);
    const recompetes = db.prepare(`SELECT award_key, title, agency, recompete_date, value, refreshed_at
      FROM orion_recompete_fy2026 WHERE UPPER(uei)=? ORDER BY recompete_date ASC LIMIT 25`).all(key);
    const naicsCodes = db.prepare(`SELECT naics_code, COUNT(*) AS n
      FROM orion_award_refresh_fy2026
      WHERE UPPER(uei)=? AND COALESCE(naics_code,'')<>''
      GROUP BY naics_code ORDER BY n DESC LIMIT 8`).all(key).map(row => clean(row.naics_code)).filter(Boolean);
    return { summary, buyers, recompetes, naicsCodes: uniq(naicsCodes) };
  }

  readinessSkeleton(identityEvidence = []) {
    const category = (label, evidence = [], missing = []) => ({ label, score: null, evidence, missing, checks: [] });
    return {
      overall: null,
      methodology: 'Readiness score withheld where the available fallback evidence does not prove the complete readiness fact set.',
      categories: {
        eligibility: category('Eligibility', identityEvidence, ['Current eligibility/certification evidence is incomplete']),
        registrations: category('Registrations', [], ['Current SAM registration evidence is not proven by historical award data alone']),
        contractVehicles: category('Contract Vehicles', [], ['Current vehicle evidence is not reconciled']),
        marketing: category('Marketing', [], ['Current marketing evidence is not reconciled']),
        pastPerformance: category('Past Performance', identityEvidence, []),
        positioning: category('Positioning', [], ['Current positioning evidence is not reconstructed']),
        relationships: category('Relationships', [], ['Relationship evidence is limited to validated buyer history when present'])
      }
    };
  }

  historicalModel(term, selected, source) {
    const row = selected.row;
    const detail = this.details(row.uei);
    const summary = detail.summary || row;
    const awardCount = numberOrNull(summary?.award_count);
    const obligations = numberOrNull(summary?.federal_obligations);
    const companyName = clean(row.recipient_name) || clean(term);
    const buyerRecords = detail.buyers.map(item => ({
      agency: item.agency || null,
      buyer: item.buyer_name || null,
      spend: numberOrNull(item.spend),
      awardCount: numberOrNull(item.award_count),
      evidenceLane: 'CURRENT_OFFICIAL_USASPENDING_FY2026'
    }));
    const recompetes = detail.recompetes.map(item => ({
      awardKey: item.award_key || null,
      title: item.title || null,
      agency: item.agency || null,
      date: item.recompete_date || null,
      value: numberOrNull(item.value),
      evidenceLane: 'RECONSTRUCTED_FROM_CURRENT_OFFICIAL_USASPENDING_FY2026'
    }));
    const buyerNames = uniq(buyerRecords.map(item => item.agency || item.buyer));
    const identityEvidence = [`FY2026 USAspending recipient matched by canonical legal name: ${companyName}`];

    return {
      ok: true,
      service: 'P2GC_EXECUTIVE_GOVERNMENT_GROWTH_BLUEPRINT_DEMO',
      status: 'DEMO_READY_WITH_HISTORICAL_IDENTITY_AND_COVERAGE_GAPS',
      generatedAt: new Date().toISOString(),
      requestedTerm: clean(term),
      resolvedTerm: clean(row.uei) || companyName,
      profile: {
        companyName,
        uei: clean(row.uei) || null,
        cage: null,
        headquarters: null,
        website: null,
        naicsCodes: detail.naicsCodes,
        certifications: [],
        samStatus: 'UNVERIFIED',
        gsaStatus: 'NOT CONFIRMED FROM CURRENT EVIDENCE',
        contractVehicles: [],
        yearsInBusiness: null,
        yearsInBusinessStatus: 'UNAVAILABLE'
      },
      readiness: this.readinessSkeleton(identityEvidence),
      currentState: {
        samRegistration: null,
        certifications: [],
        contractVehicles: [],
        activeContracts: awardCount,
        federalSales: obligations,
        stateLocalSales: null,
        agencyRelationships: buyerNames
      },
      gaps: {
        status: 'COVERAGE_GAPS_EXPLICIT',
        items: [
          'Current SAM registration status is not inferred from historical award identity.',
          'Current contract-vehicle evidence has not yet been reconciled for this prospect.',
          'Current public opportunity matching remains separate from historical award identity evidence.'
        ]
      },
      revenue: {
        current: { federal: obligations, state: null, local: null, commercial: null },
        opportunity: {
          status: 'POTENTIAL_REVENUE_NOT_MODELED',
          currentFederalRevenue: obligations,
          modeledPotentialFederalRevenue: null,
          modeledGrowthOpportunity: null,
          disclosure: 'Federal value shown is FY2026 USAspending obligations from the validated sidecar; no additional growth amount is fabricated.'
        }
      },
      vehicles: { current: [], recommendations: [], status: 'VEHICLE_STATUS_UNCONFIRMED' },
      competitors: { status: 'UNAVAILABLE', records: [], disclosure: 'Competitor facts are withheld until separately proven.' },
      primePartners: { status: 'UNAVAILABLE', records: [], strategy: [], disclosure: 'Prime/team candidates are withheld until separately proven.' },
      subcontracting: { status: 'NO_CURRENT_TEAMING_SIGNAL_IDENTIFIED', records: [], strategy: [] },
      agencyAlignment: { status: buyerRecords.length ? 'CURRENT_OFFICIAL_USASPENDING_BUYER_HISTORY' : 'UNAVAILABLE', agencies: buyerRecords },
      buyerIntelligence: { status: buyerRecords.length ? 'CURRENT_OFFICIAL_USASPENDING_BUYER_HISTORY' : 'UNAVAILABLE', records: buyerRecords },
      opportunities: {
        liveAndForecast: [],
        recompetes,
        publicSourceAdditions: [],
        sourceCoverage: { status: 'HISTORICAL_IDENTITY_RESOLVED_CURRENT_LIVE_OPPORTUNITY_COVERAGE_SEPARATE', historicalIdentityResolved: true }
      },
      recommendations: { immediate: [], vehicle: [], agency: [], partner: [], opportunity: [], growth: [] },
      pathway: {
        type: 'EVIDENCE_COMPLETION_PATHWAY',
        title: 'Evidence Completion Pathway',
        steps: [
          'Confirm current SAM registration and current legal identity state.',
          'Reconcile current vehicles and certifications.',
          'Use validated buyer/recompete history to build current opportunity and teaming actions.'
        ]
      },
      safety: { readOnly: true, writesEnabled: false, emailsSent: false, campaignsChanged: false, contactsInvented: false },
      evidence: {
        identity: {
          authority: 'USA_SPENDING_OFFICIAL_FY2026_VALIDATED_SIDECAR',
          matchedBy: selected.matchedBy,
          sidecarReportPath: source.reportPath,
          sidecarDatabaseMode: 'READ_ONLY',
          source: source.source,
          validation: source.validation,
          latestActionDate: summary?.latest_action_date || row.latest_action_date || null
        },
        disclosure: 'Historical identity and award facts come from the validated FY2026 USAspending sidecar. Current SAM, vehicle, certification and live-opportunity facts remain UNKNOWN until separately proven.'
      }
    };
  }

  unresolvedModel(term, source, selection, context = {}) {
    const samFallback = context.samFallback || null;
    return {
      ok: true,
      service: 'P2GC_EXECUTIVE_GOVERNMENT_GROWTH_BLUEPRINT_DEMO',
      status: 'DEMO_READY_WITH_EXPLICIT_IDENTITY_COVERAGE_GAP',
      generatedAt: new Date().toISOString(),
      requestedTerm: clean(term),
      resolvedTerm: clean(term),
      profile: {
        companyName: clean(term), uei: null, cage: null, headquarters: null, website: null,
        naicsCodes: [], certifications: [], samStatus: 'UNVERIFIED',
        gsaStatus: 'NOT CONFIRMED FROM CURRENT EVIDENCE', contractVehicles: [],
        yearsInBusiness: null, yearsInBusinessStatus: 'UNAVAILABLE'
      },
      readiness: this.readinessSkeleton([]),
      currentState: {
        samRegistration: null, certifications: [], contractVehicles: [], activeContracts: null,
        federalSales: null, stateLocalSales: null, agencyRelationships: []
      },
      gaps: {
        status: 'IDENTITY_COVERAGE_GAP_EXPLICIT',
        items: [
          'The requested company name did not resolve uniquely in the governed current SAM-qualified universe.',
          'The requested company name did not resolve uniquely in the validated FY2026 USAspending historical sidecar.',
          'No UEI, CAGE, SAM status, award history, vehicle, buyer, competitor or opportunity fact is claimed for an unresolved identity.'
        ]
      },
      revenue: {
        current: { federal: null, state: null, local: null, commercial: null },
        opportunity: { status: 'POTENTIAL_REVENUE_NOT_MODELED', currentFederalRevenue: null, modeledPotentialFederalRevenue: null, modeledGrowthOpportunity: null, disclosure: 'Revenue remains UNKNOWN because company identity is unresolved.' }
      },
      vehicles: { current: [], recommendations: [], status: 'VEHICLE_STATUS_UNCONFIRMED' },
      competitors: { status: 'UNAVAILABLE', records: [], disclosure: 'No competitor claims are made for an unresolved identity.' },
      primePartners: { status: 'UNAVAILABLE', records: [], strategy: [], disclosure: 'No prime/team claims are made for an unresolved identity.' },
      subcontracting: { status: 'NO_CURRENT_TEAMING_SIGNAL_IDENTIFIED', records: [], strategy: [] },
      agencyAlignment: { status: 'UNAVAILABLE', agencies: [] },
      buyerIntelligence: { status: 'UNAVAILABLE', records: [] },
      opportunities: { liveAndForecast: [], recompetes: [], publicSourceAdditions: [], sourceCoverage: { status: 'IDENTITY_COVERAGE_GAP', identityResolved: false } },
      recommendations: { immediate: [], vehicle: [], agency: [], partner: [], opportunity: [], growth: [] },
      pathway: {
        type: 'IDENTITY_RESOLUTION_PATHWAY', title: 'Identity Resolution Pathway',
        steps: ['Confirm legal entity name, UEI, CAGE or authoritative website.', 'Re-run authoritative SAM and award-history reconciliation.', 'Only then generate evidence-backed growth actions.']
      },
      safety: { readOnly: true, writesEnabled: false, emailsSent: false, campaignsChanged: false, contactsInvented: false },
      evidence: {
        identity: {
          status: 'UNRESOLVED',
          requestedTerm: clean(term),
          samFallbackStatus: samFallback?.status || null,
          historicalFallbackStatus: selection?.status || source.reason || null,
          sidecarUsable: source.usable === true,
          sidecarReportPath: source.reportPath,
          candidatesSelected: 0
        },
        disclosure: 'This is an explicit coverage-gap result, not a claim that the company has no government history. Identity must be resolved before factual company assertions are made.'
      }
    };
  }

  build(term, context = {}) {
    const requestedTerm = clean(term);
    if (!requestedTerm) return { ok: false, status: 'TERM_REQUIRED' };
    const source = this.sourceStatus();
    if (!source.usable) return this.unresolvedModel(requestedTerm, source, { status: source.reason }, context);
    const selected = this.select(requestedTerm, this.candidateRows(requestedTerm));
    if (selected.ok) return this.historicalModel(requestedTerm, selected, source);
    return this.unresolvedModel(requestedTerm, source, selected, context);
  }

  close() {
    if (this.db) { try { this.db.close(); } catch {} }
    this.db = null;
    this.dbPath = null;
  }
}

module.exports = HistoricalProspectFallbackService;
module.exports.helpers = { clean, normalize, canonicalName, uniq, numberOrNull };
