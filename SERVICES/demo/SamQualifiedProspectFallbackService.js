'use strict';

const fs = require('fs');
const path = require('path');

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalize(value) {
  return clean(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function list(value) {
  return clean(value).split('~').map(item => item.trim()).filter(Boolean);
}

function uniqueRows(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = clean(row?.uei).toUpperCase() || `${normalize(row?.legal_name)}|${clean(row?.cage).toUpperCase()}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

class SamQualifiedProspectFallbackService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.reportPath = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_sam_qualified_universe_build.json');
    this.Database = options.Database || null;
    this.db = null;
    this.dbPath = null;
  }

  readReport() {
    try {
      return JSON.parse(fs.readFileSync(this.reportPath, 'utf8').replace(/^\uFEFF/, ''));
    } catch {
      return null;
    }
  }

  sourceStatus() {
    const report = this.readReport();
    const database = report?.output?.database ? path.resolve(report.output.database) : null;
    const usable = Boolean(
      report?.ok === true &&
      report?.output?.sqliteIntegrity === 'ok' &&
      report?.safety?.stagingOnly === true &&
      report?.safety?.productionDatabaseModified === false &&
      database &&
      fs.existsSync(database)
    );
    return {
      usable,
      reportPath: this.reportPath,
      database: usable ? database : null,
      sourceFile: usable ? report?.source?.fileName || null : null,
      sourceDate: usable ? report?.source?.date || null : null,
      generatedAt: usable ? report?.generatedAt || null : null,
      storedQualifiedCompanies: usable ? report?.output?.storedQualifiedCompanies ?? null : null,
      reason: usable ? null : 'SAM_QUALIFIED_UNIVERSE_NOT_USABLE'
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
    const raw = clean(term);
    const normalized = normalize(raw);
    if (!normalized) return [];

    const tokens = normalized.split(' ').filter(token => token.length >= 3 && !['LLC','INC','CORP','CORPORATION','COMPANY','CO','LTD'].includes(token));
    const anchor = tokens.sort((a, b) => b.length - a.length)[0] || normalized.split(' ')[0];
    const anchorLike = `%${anchor}%`;
    const rawLike = `%${raw}%`;

    return db.prepare(`
      SELECT uei, cage, legal_name, dba, registration_expiration_date, last_update_date,
             activation_date, website, primary_naics, naics_codes, sba_business_type_codes,
             business_type_codes, city, state, zip, country, source_file, source_date, loaded_at
      FROM sam_qualified_companies
      WHERE UPPER(uei) = UPPER(?)
         OR UPPER(cage) = UPPER(?)
         OR legal_name LIKE ? COLLATE NOCASE
         OR dba LIKE ? COLLATE NOCASE
         OR website LIKE ? COLLATE NOCASE
      LIMIT 100
    `).all(raw, raw, anchorLike, anchorLike, rawLike);
  }

  select(term, rows = []) {
    const raw = clean(term);
    const target = normalize(raw);
    const upperRaw = raw.toUpperCase();
    const candidates = uniqueRows(rows);

    const exactUei = candidates.filter(row => clean(row.uei).toUpperCase() === upperRaw);
    if (exactUei.length === 1) return { ok: true, row: exactUei[0], matchedBy: 'SAM_UEI' };
    if (exactUei.length > 1) return { ok: false, status: 'SAM_IDENTITY_AMBIGUOUS', candidates: exactUei };

    const exactCage = candidates.filter(row => clean(row.cage).toUpperCase() === upperRaw);
    if (exactCage.length === 1) return { ok: true, row: exactCage[0], matchedBy: 'SAM_CAGE' };
    if (exactCage.length > 1) return { ok: false, status: 'SAM_IDENTITY_AMBIGUOUS', candidates: exactCage };

    const exactName = candidates.filter(row => normalize(row.legal_name) === target || normalize(row.dba) === target);
    if (exactName.length === 1) return { ok: true, row: exactName[0], matchedBy: 'SAM_LEGAL_NAME' };
    if (exactName.length > 1) return { ok: false, status: 'SAM_IDENTITY_AMBIGUOUS', candidates: exactName };

    const exactWebsite = candidates.filter(row => normalize(row.website) === target);
    if (exactWebsite.length === 1) return { ok: true, row: exactWebsite[0], matchedBy: 'SAM_WEBSITE' };
    if (exactWebsite.length > 1) return { ok: false, status: 'SAM_IDENTITY_AMBIGUOUS', candidates: exactWebsite };

    return { ok: false, status: 'SAM_IDENTITY_NOT_FOUND', candidates: [] };
  }

  build(term) {
    const requestedTerm = clean(term);
    if (!requestedTerm) return { ok: false, status: 'TERM_REQUIRED' };

    const source = this.sourceStatus();
    if (!source.usable) {
      return {
        ok: false,
        service: 'P2GC_SAM_QUALIFIED_PROSPECT_FALLBACK',
        status: source.reason,
        requestedTerm,
        source
      };
    }

    const selected = this.select(requestedTerm, this.candidateRows(requestedTerm));
    if (!selected.ok) {
      return {
        ok: false,
        service: 'P2GC_SAM_QUALIFIED_PROSPECT_FALLBACK',
        status: selected.status,
        requestedTerm,
        source,
        candidateCount: selected.candidates?.length || 0
      };
    }

    const row = selected.row;
    const naicsCodes = [...new Set([clean(row.primary_naics), ...list(row.naics_codes)].filter(Boolean))];
    const headquarters = [clean(row.city), clean(row.state)].filter(Boolean).join(', ') || null;
    const sourceEvidence = {
      authority: 'SAM_PUBLIC_BULK_QUALIFIED_UNIVERSE',
      matchedBy: selected.matchedBy,
      sourceFile: row.source_file || source.sourceFile,
      sourceDate: row.source_date || source.sourceDate,
      sourceLastUpdateDate: row.last_update_date || null,
      buildGeneratedAt: source.generatedAt,
      reportPath: source.reportPath,
      databaseMode: 'READ_ONLY',
      qualificationMeaning: 'The record is present in the governed current SAM qualified-universe staging database. Fields not carried by that source remain UNKNOWN.'
    };

    return {
      ok: true,
      service: 'P2GC_EXECUTIVE_GOVERNMENT_GROWTH_BLUEPRINT_DEMO',
      status: 'DEMO_READY_WITH_SAM_IDENTITY_AND_COVERAGE_GAPS',
      generatedAt: new Date().toISOString(),
      requestedTerm,
      resolvedTerm: row.uei || row.legal_name || requestedTerm,
      profile: {
        companyName: row.legal_name || requestedTerm,
        uei: row.uei || null,
        cage: row.cage || null,
        headquarters,
        website: row.website || null,
        naicsCodes,
        certifications: [],
        samStatus: 'ACTIVE',
        gsaStatus: 'NOT CONFIRMED FROM CURRENT EVIDENCE',
        contractVehicles: [],
        yearsInBusiness: null,
        yearsInBusinessStatus: 'UNAVAILABLE'
      },
      readiness: {
        overall: null,
        methodology: 'Readiness score withheld because the fallback source proves identity/registration fields but does not by itself prove the full readiness evidence set.',
        categories: {
          eligibility: { label: 'Eligibility', score: null, evidence: ['Current governed SAM-qualified record'], missing: ['Certification and broader eligibility evidence not reconstructed yet'], checks: [] },
          registrations: { label: 'Registrations', score: null, evidence: ['UEI and CAGE from current SAM bulk record'].filter(Boolean), missing: [], checks: [] },
          contractVehicles: { label: 'Contract Vehicles', score: null, evidence: [], missing: ['Current vehicle evidence not reconciled'], checks: [] },
          marketing: { label: 'Marketing', score: null, evidence: row.website ? ['Website from SAM record'] : [], missing: row.website ? [] : ['Website evidence unavailable'], checks: [] },
          pastPerformance: { label: 'Past Performance', score: null, evidence: [], missing: ['Authoritative award history not reconciled into this fallback view'], checks: [] },
          positioning: { label: 'Positioning', score: null, evidence: [], missing: ['Positioning evidence not reconstructed'], checks: [] },
          relationships: { label: 'Relationships', score: null, evidence: [], missing: ['Buyer/agency relationship evidence not reconstructed'], checks: [] }
        }
      },
      currentState: {
        samRegistration: true,
        certifications: [],
        contractVehicles: [],
        activeContracts: null,
        federalSales: null,
        stateLocalSales: null,
        agencyRelationships: []
      },
      gaps: {
        status: 'COVERAGE_GAPS_EXPLICIT',
        items: [
          'Current contract-vehicle evidence has not yet been reconciled for this prospect.',
          'Authoritative prime and subcontract award history has not yet been reconciled into this fallback view.',
          'Buyer, opportunity, recompete, competitor, and teaming evidence remain coverage gaps until separately proven.'
        ]
      },
      revenue: {
        current: { federal: null, state: null, local: null, commercial: null },
        opportunity: {
          status: 'POTENTIAL_REVENUE_NOT_MODELED',
          currentFederalRevenue: null,
          modeledPotentialFederalRevenue: null,
          modeledGrowthOpportunity: null,
          disclosure: 'Revenue is UNKNOWN in this SAM-only fallback and is not coerced to zero.'
        }
      },
      vehicles: { current: [], recommendations: [], status: 'VEHICLE_STATUS_UNCONFIRMED' },
      competitors: { status: 'UNAVAILABLE', records: [], disclosure: 'Competitor evidence not reconstructed from the SAM identity source alone.' },
      primePartners: { status: 'UNAVAILABLE', records: [], strategy: [], disclosure: 'Prime/team candidates are withheld until evidence is reconstructed.' },
      subcontracting: { status: 'NO_CURRENT_TEAMING_SIGNAL_IDENTIFIED', records: [], strategy: [] },
      agencyAlignment: { status: 'UNAVAILABLE', agencies: [] },
      buyerIntelligence: { status: 'UNAVAILABLE', records: [] },
      opportunities: { liveAndForecast: [], recompetes: [], publicSourceAdditions: [], sourceCoverage: { status: 'COVERAGE_GAP', samIdentityResolved: true } },
      recommendations: { immediate: [], vehicle: [], agency: [], partner: [], opportunity: [], growth: [] },
      pathway: {
        type: 'EVIDENCE_COMPLETION_PATHWAY',
        title: 'Evidence Completion Pathway',
        steps: [
          'Reconcile authoritative prime and subcontract award history.',
          'Reconcile current vehicle and agency/buyer evidence.',
          'Match current public opportunities and procurement-stage signals.',
          'Build evidence-backed teaming and capture actions only after those facts are proven.'
        ]
      },
      safety: {
        readOnly: true,
        writesEnabled: false,
        emailsSent: false,
        campaignsChanged: false,
        contactsInvented: false
      },
      evidence: {
        identity: sourceEvidence,
        disclosure: 'Identity and registration fields come from the governed SAM public bulk qualified-universe source. All non-SAM facts remain explicit UNKNOWN/coverage gaps until proven by their authoritative sources.'
      }
    };
  }

  close() {
    if (this.db) {
      try { this.db.close(); } catch {}
      this.db = null;
      this.dbPath = null;
    }
  }
}

module.exports = SamQualifiedProspectFallbackService;
module.exports.helpers = { clean, normalize, list, uniqueRows };
