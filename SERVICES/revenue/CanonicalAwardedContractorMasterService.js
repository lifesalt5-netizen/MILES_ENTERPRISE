'use strict';

const fs = require('fs');
const path = require('path');

function clean(value) { return value == null ? '' : String(value).trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function normalize(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function domainFromValue(value) {
  let text = clean(value).toLowerCase();
  if (!text) return '';
  if (text.includes('@')) text = text.split('@').pop();
  return text.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[\/?#]/)[0].split(':')[0];
}
function number(value) {
  const parsed = Number(String(value == null ? '' : value).replace(/[$,]/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return fallback; }
}
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows.filter(values => values.some(value => clean(value)));
}
function csvObjects(file) {
  if (!file || !fs.existsSync(file)) return [];
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (rows.length < 2) return [];
  const headers = rows[0].map(clean);
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] == null ? '' : values[index]])));
}
function first(record, names) {
  if (!record) return '';
  const lookup = new Map(Object.keys(record).map(key => [key.toLowerCase(), key]));
  for (const name of names) {
    const actual = lookup.get(String(name).toLowerCase());
    if (actual && clean(record[actual])) return clean(record[actual]);
  }
  return '';
}
function truthy(value) { return ['1', 'true', 'yes', 'y', 'active'].includes(clean(value).toLowerCase()); }
function anyTruthy(record, names) { return names.some(name => truthy(first(record, [name]))); }
function email(record) { return first(record, ['email', 'work_email', 'contact_email', 'email_address']); }
function verificationStatus(record) {
  return clean(first(record, ['verification_status', 'email_verification_status', 'millionverifier_status', 'email_status', 'verification', 'verified'])).toLowerCase();
}
function emailIsVerified(record) {
  const value = email(record);
  if (!value || !value.includes('@')) return false;
  const status = verificationStatus(record);
  return /^(valid|verified|deliverable|safe|good|ok|true|1)$/.test(status) || /\b(valid|verified|deliverable)\b/.test(status);
}
function individualSuppressed(record) {
  if (anyTruthy(record, ['suppressed', 'is_suppressed', 'unsubscribed', 'opt_out', 'opted_out', 'do_not_contact', 'hard_bounce', 'bounced', 'invalid_email'])) return true;
  return /unsubscribe|opt.?out|do not contact|hard bounce|invalid|suppressed/i.test(first(record, ['suppression_status', 'contact_status', 'email_status', 'status']));
}
function accountDoNotProspect(record) {
  if (anyTruthy(record, ['company_do_not_prospect', 'account_do_not_prospect', 'do_not_prospect', 'company_suppressed', 'account_suppressed'])) return true;
  return /company do not prospect|account do not prospect|company suppressed/i.test(first(record, ['account_status', 'company_status', 'relationship_status']));
}
function existingClient(record) {
  if (anyTruthy(record, ['existing_client', 'is_client', 'client', 'customer'])) return true;
  return /existing client|current client|customer/i.test(first(record, ['relationship_status', 'client_status']));
}
function q(identifier) { return `"${String(identifier).replace(/"/g, '""')}"`; }
function tableExists(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
}
function chooseColumn(columns, names) {
  const lookup = new Map(columns.map(column => [String(column).toLowerCase(), column]));
  for (const name of names) if (lookup.has(String(name).toLowerCase())) return lookup.get(String(name).toLowerCase());
  return null;
}
function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function awardTier(totalObligations) {
  const value = Math.max(0, number(totalObligations));
  if (value < 500000) return '0_500k';
  if (value < 3000000) return '500k_3m';
  if (value < 5000000) return '3m_5m';
  return '5m_plus';
}
function fallbackSegment(role, totalObligations) {
  return `awarded_${String(role || '').toLowerCase()}_${awardTier(totalObligations)}`;
}
function lifecycleState(input = {}) {
  if (input.existingClient) return 'EXISTING_CLIENT';
  if (input.accountDoNotProspect) return 'DO_NOT_PROSPECT';
  if (!clean(input.company)) return 'IDENTITY_ENRICHMENT_REQUIRED';
  if (input.verifiedContact) return 'OUTBOUND_READY';
  if (input.hasUnsuppressedEmail) return 'CONTACT_VERIFICATION_REQUIRED';
  return 'CONTACT_ENRICHMENT_REQUIRED';
}
function safeStamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

class CanonicalAwardedContractorMasterService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.Database = options.Database || null;
    this.outputDir = path.join(this.rootDir, 'DATA', 'revenue_universe');
    this.segmentModelPath = path.join(this.rootDir, 'DATA', 'registry', 'OutboundRevenueSegmentModel.json');
    this.overlayModelPath = path.join(this.rootDir, 'DATA', 'registry', 'AwardedContractorSegmentOverlayModel.json');
    this.samReportPath = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_sam_qualified_universe_build.json');
    this.schemaAuditPath = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_refresh_target_schema_audit.json');
    this.sidecarReportPath = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_contract_sidecar_build.json');
    this.latestReportPath = path.join(this.outputDir, 'latest_canonical_awarded_contractor_master.json');
  }

  loadDatabase() {
    if (!this.Database) this.Database = require('better-sqlite3');
    return this.Database;
  }

  segmentAliases() {
    const model = readJson(this.segmentModelPath, { segments: [] });
    const aliases = new Map();
    for (const segment of model.segments || []) {
      for (const value of [segment.id, segment.name, ...(segment.sourceHints || [])]) {
        if (clean(value)) aliases.set(normalize(value), segment.id);
      }
    }
    return { model, aliases };
  }

  masterIndex(file) {
    const rows = csvObjects(file);
    const byUei = new Map();
    for (const row of rows) {
      const uei = upper(first(row, ['uei', 'uei_number', 'unique_entity_id']));
      if (!uei) continue;
      if (!byUei.has(uei)) byUei.set(uei, []);
      byUei.get(uei).push(row);
    }
    return { rows, byUei };
  }

  existingSegment(rows, aliases) {
    for (const row of rows || []) {
      for (const field of ['primary_segment', 'segment_id', 'segment', 'segment_name', 'campaign_segment']) {
        const raw = first(row, [field]);
        if (!raw) continue;
        const exact = aliases.get(normalize(raw));
        if (exact) return exact;
      }
    }
    return null;
  }

  currentContact(rows) {
    const usable = (rows || []).filter(row => email(row) && !individualSuppressed(row));
    const verified = usable.find(emailIsVerified) || null;
    const candidate = verified || usable[0] || null;
    return {
      verified: Boolean(verified),
      hasUnsuppressedEmail: Boolean(candidate),
      email: candidate ? email(candidate) : '',
      name: candidate ? first(candidate, ['contact_name', 'name', 'full_name', 'first_name']) : '',
      title: candidate ? first(candidate, ['title', 'job_title', 'contact_title']) : '',
      verificationStatus: candidate ? verificationStatus(candidate) : '',
      suppressedContactRows: (rows || []).filter(individualSuppressed).length
    };
  }

  loadPrimeMap(sidecarDb) {
    const Database = this.loadDatabase();
    const db = new Database(sidecarDb, { readonly: true, fileMustExist: true });
    try {
      if (!tableExists(db, 'orion_contractor_fy2026_summary')) throw new Error('ORION_FY2026_CONTRACTOR_SUMMARY_MISSING');
      const rows = db.prepare("SELECT UPPER(TRIM(uei)) AS uei, federal_obligations, award_count, latest_action_date, refreshed_at FROM orion_contractor_fy2026_summary WHERE uei IS NOT NULL AND TRIM(uei)<>''").all();
      return new Map(rows.map(row => [upper(row.uei), row]));
    } finally { db.close(); }
  }

  loadSubMap(file) {
    const out = new Map();
    if (!file || !fs.existsSync(file)) throw new Error('SUBAWARD_AGGREGATE_NOT_FOUND');
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const row = JSON.parse(line);
      const uei = upper(row.uei);
      if (uei) out.set(uei, row);
    }
    return out;
  }

  loadIdentityMap(dbFile, table, union) {
    const out = new Map();
    if (!dbFile || !fs.existsSync(dbFile)) return out;
    const Database = this.loadDatabase();
    const db = new Database(dbFile, { readonly: true, fileMustExist: true });
    try {
      if (!tableExists(db, table)) return out;
      const columns = db.prepare(`PRAGMA table_info(${q(table)})`).all().map(row => row.name);
      const ueiCol = chooseColumn(columns, ['uei', 'uei_number', 'unique_entity_id']);
      if (!ueiCol) return out;
      const cageCol = chooseColumn(columns, ['cage', 'cage_code']);
      const companyCol = chooseColumn(columns, ['company', 'company_name', 'company_norm', 'legal_business_name', 'legal_name', 'name']);
      const websiteCol = chooseColumn(columns, ['website', 'domain', 'company_website', 'url']);
      const select = [
        `${q(ueiCol)} AS uei`,
        cageCol ? `${q(cageCol)} AS cage` : 'NULL AS cage',
        companyCol ? `${q(companyCol)} AS company` : 'NULL AS company',
        websiteCol ? `${q(websiteCol)} AS website` : 'NULL AS website'
      ].join(', ');
      for (const row of db.prepare(`SELECT ${select} FROM ${q(table)} WHERE ${q(ueiCol)} IS NOT NULL AND TRIM(${q(ueiCol)})<>''`).iterate()) {
        const uei = upper(row.uei);
        if (!union.has(uei) || out.has(uei)) continue;
        out.set(uei, { uei, cage: upper(row.cage), company: clean(row.company), domain: domainFromValue(row.website) });
      }
      return out;
    } finally { db.close(); }
  }

  resolveIdentitySources(union) {
    const sidecarReport = readJson(this.sidecarReportPath, {});
    const schemaAudit = readJson(this.schemaAuditPath, {});
    const samReport = readJson(this.samReportPath, {});
    const orionDb = [schemaAudit?.currentDb, sidecarReport?.productionDb].find(file => file && fs.existsSync(file)) || null;
    const samDb = samReport?.ok === true && samReport?.output?.database && fs.existsSync(samReport.output.database) ? samReport.output.database : null;
    return {
      orionDb,
      samDb,
      orion: this.loadIdentityMap(orionDb, 'contractors', union),
      sam: this.loadIdentityMap(samDb, 'sam_qualified_companies', union)
    };
  }

  companyFromMaster(rows) {
    for (const row of rows || []) {
      const company = first(row, ['company', 'company_name', 'legal_business_name', 'organization', 'vendor_name']);
      if (company) return company;
    }
    return '';
  }

  cageFromMaster(rows) {
    for (const row of rows || []) {
      const cage = first(row, ['cage', 'cage_code']);
      if (cage) return upper(cage);
    }
    return '';
  }

  domainFromMaster(rows) {
    for (const row of rows || []) {
      const domain = domainFromValue(first(row, ['domain', 'website', 'company_website', 'email', 'work_email', 'contact_email']));
      if (domain) return domain;
    }
    return '';
  }

  writeCsv(file, records) {
    const headers = [
      'uei','cage','company','domain','award_role','primary_segment','segment_source','lifecycle_state',
      'in_current_outbound_master','current_master_contact_count','verified_current_contact','contact_email','contact_name','contact_title',
      'current_sam_qualified','prime_obligations','prime_award_count','prime_latest_action_date','subaward_obligations','subaward_row_count','total_awarded_obligations'
    ];
    const lines = [headers.join(',')];
    for (const record of records) lines.push(headers.map(header => csvEscape(record[header])).join(','));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  }

  async run(options = {}) {
    fs.mkdirSync(this.outputDir, { recursive: true });
    const coverage = options.coverage || readJson(path.join(this.outputDir, 'latest_fy2026_awarded_universe_coverage.json'), null);
    if (!coverage?.ok || coverage?.status !== 'FY2026_TO_SOURCE_DATE_EXACT_UEI_DEDUPED') throw new Error('FY2026_EXACT_AWARDED_COVERAGE_REQUIRED');
    const expected = coverage.awardedUniverse || {};
    const masterFile = coverage.currentMaster?.file;
    const sidecarDb = coverage.scope?.primeSidecarDb;
    const subAggregate = coverage.artifacts?.subawardAggregatePath;
    if (!masterFile || !fs.existsSync(masterFile)) throw new Error('CURRENT_OUTBOUND_MASTER_NOT_FOUND');
    if (!sidecarDb || !fs.existsSync(sidecarDb)) throw new Error('VALIDATED_PRIME_SIDECAR_NOT_FOUND');

    const prime = this.loadPrimeMap(sidecarDb);
    const sub = this.loadSubMap(subAggregate);
    const union = new Set([...prime.keys(), ...sub.keys()]);
    const overlap = [...prime.keys()].filter(uei => sub.has(uei)).length;
    if (prime.size !== expected.exactUniquePrimeAwardedUeis) throw new Error(`PRIME_COUNT_MISMATCH:${prime.size}:${expected.exactUniquePrimeAwardedUeis}`);
    if (sub.size !== expected.exactUniqueSubcontractAwardedUeis) throw new Error(`SUB_COUNT_MISMATCH:${sub.size}:${expected.exactUniqueSubcontractAwardedUeis}`);
    if (overlap !== expected.exactPrimeAndSubUeiOverlap) throw new Error(`OVERLAP_COUNT_MISMATCH:${overlap}:${expected.exactPrimeAndSubUeiOverlap}`);
    if (union.size !== expected.exactUniqueAwardedUeisEitherRole) throw new Error(`UNION_COUNT_MISMATCH:${union.size}:${expected.exactUniqueAwardedUeisEitherRole}`);

    const master = this.masterIndex(masterFile);
    const { aliases } = this.segmentAliases();
    const identitySources = this.resolveIdentitySources(union);
    const samSet = new Set(identitySources.sam.keys());
    const overlay = readJson(this.overlayModelPath, {});
    if (overlay?.policy?.canonicalAccountRequiredForEveryAwardedUei !== true) throw new Error('AWARDED_SEGMENT_OVERLAY_POLICY_INVALID');

    const stamp = safeStamp();
    const dbPath = path.join(this.outputDir, `P2GC_CANONICAL_AWARDED_CONTRACTOR_MASTER_${stamp}.sqlite`);
    const segmentRoot = path.join(this.outputDir, `segments_${stamp}`);
    const accountSegmentRoot = path.join(segmentRoot, 'account');
    const readySegmentRoot = path.join(segmentRoot, 'outbound_ready');
    const Database = this.loadDatabase();
    const db = new Database(dbPath);
    const records = [];
    try {
      db.exec(`
        PRAGMA journal_mode=DELETE;
        CREATE TABLE canonical_contractor_master (
          uei TEXT PRIMARY KEY,
          cage TEXT,
          company TEXT,
          domain TEXT,
          identity_source TEXT NOT NULL,
          award_role TEXT NOT NULL CHECK(award_role IN ('PRIME','SUB','BOTH')),
          primary_segment TEXT NOT NULL,
          segment_source TEXT NOT NULL,
          lifecycle_state TEXT NOT NULL,
          in_current_outbound_master INTEGER NOT NULL,
          current_master_contact_count INTEGER NOT NULL,
          verified_current_contact INTEGER NOT NULL,
          contact_email TEXT,
          contact_name TEXT,
          contact_title TEXT,
          verification_status TEXT,
          suppressed_contact_rows INTEGER NOT NULL,
          current_sam_qualified INTEGER NOT NULL,
          account_do_not_prospect INTEGER NOT NULL,
          existing_client INTEGER NOT NULL,
          prime_obligations REAL NOT NULL,
          prime_award_count INTEGER NOT NULL,
          prime_latest_action_date TEXT,
          subaward_obligations REAL NOT NULL,
          subaward_row_count INTEGER NOT NULL,
          total_awarded_obligations REAL NOT NULL,
          evidence_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_canonical_awarded_role ON canonical_contractor_master(award_role);
        CREATE INDEX idx_canonical_segment ON canonical_contractor_master(primary_segment);
        CREATE INDEX idx_canonical_lifecycle ON canonical_contractor_master(lifecycle_state);
      `);
      const insert = db.prepare(`INSERT INTO canonical_contractor_master
        (uei,cage,company,domain,identity_source,award_role,primary_segment,segment_source,lifecycle_state,in_current_outbound_master,current_master_contact_count,verified_current_contact,contact_email,contact_name,contact_title,verification_status,suppressed_contact_rows,current_sam_qualified,account_do_not_prospect,existing_client,prime_obligations,prime_award_count,prime_latest_action_date,subaward_obligations,subaward_row_count,total_awarded_obligations,evidence_json,updated_at)
        VALUES (@uei,@cage,@company,@domain,@identity_source,@award_role,@primary_segment,@segment_source,@lifecycle_state,@in_current_outbound_master,@current_master_contact_count,@verified_current_contact,@contact_email,@contact_name,@contact_title,@verification_status,@suppressed_contact_rows,@current_sam_qualified,@account_do_not_prospect,@existing_client,@prime_obligations,@prime_award_count,@prime_latest_action_date,@subaward_obligations,@subaward_row_count,@total_awarded_obligations,@evidence_json,@updated_at)`);
      const tx = db.transaction(rows => rows.forEach(row => insert.run(row)));
      let batch = [];
      for (const uei of [...union].sort()) {
        const primeRow = prime.get(uei) || null;
        const subRow = sub.get(uei) || null;
        const role = primeRow && subRow ? 'BOTH' : primeRow ? 'PRIME' : 'SUB';
        const currentRows = master.byUei.get(uei) || [];
        const contact = this.currentContact(currentRows);
        const masterCompany = this.companyFromMaster(currentRows);
        const samIdentity = identitySources.sam.get(uei) || null;
        const orionIdentity = identitySources.orion.get(uei) || null;
        const company = masterCompany || samIdentity?.company || orionIdentity?.company || '';
        const cage = this.cageFromMaster(currentRows) || samIdentity?.cage || orionIdentity?.cage || '';
        const domain = this.domainFromMaster(currentRows) || samIdentity?.domain || orionIdentity?.domain || '';
        const identitySource = masterCompany ? 'CURRENT_OUTBOUND_MASTER' : samIdentity?.company ? 'SAM_QUALIFIED' : orionIdentity?.company ? 'ORION_CONTRACTOR' : 'UEI_ONLY';
        const primeObligations = number(primeRow?.federal_obligations);
        const subawardObligations = number(subRow?.subawardObligations);
        const total = primeObligations + subawardObligations;
        const retainedSegment = this.existingSegment(currentRows, aliases);
        const primarySegment = retainedSegment || fallbackSegment(role, total);
        const segmentSource = retainedSegment ? 'CURRENT_SEGMENT_RETAINED' : 'AWARDED_ROLE_FALLBACK_CREATED';
        const dnp = currentRows.some(accountDoNotProspect);
        const client = currentRows.some(existingClient);
        const state = lifecycleState({ company, existingClient: client, accountDoNotProspect: dnp, verifiedContact: contact.verified, hasUnsuppressedEmail: contact.hasUnsuppressedEmail });
        const record = {
          uei,
          cage,
          company,
          domain,
          identity_source: identitySource,
          award_role: role,
          primary_segment: primarySegment,
          segment_source: segmentSource,
          lifecycle_state: state,
          in_current_outbound_master: currentRows.length ? 1 : 0,
          current_master_contact_count: currentRows.length,
          verified_current_contact: contact.verified ? 1 : 0,
          contact_email: contact.email,
          contact_name: contact.name,
          contact_title: contact.title,
          verification_status: contact.verificationStatus,
          suppressed_contact_rows: contact.suppressedContactRows,
          current_sam_qualified: samSet.has(uei) ? 1 : 0,
          account_do_not_prospect: dnp ? 1 : 0,
          existing_client: client ? 1 : 0,
          prime_obligations: primeObligations,
          prime_award_count: Number(primeRow?.award_count || 0),
          prime_latest_action_date: clean(primeRow?.latest_action_date),
          subaward_obligations: subawardObligations,
          subaward_row_count: Number(subRow?.awardRows || 0),
          total_awarded_obligations: total,
          evidence_json: JSON.stringify({
            primeEvidence: Boolean(primeRow),
            subawardEvidence: Boolean(subRow),
            primeSource: coverage.scope?.primeAuthority || null,
            subawardSource: coverage.scope?.subawardAuthority || null,
            sourceThroughDate: coverage.scope?.endDate || null,
            currentMasterFile: masterFile,
            contactSuppressionIsIndividualNotCompanyUnlessAccountFlagPresent: true
          }),
          updated_at: new Date().toISOString()
        };
        records.push(record);
        batch.push(record);
        if (batch.length >= 5000) { tx(batch); batch = []; }
      }
      if (batch.length) tx(batch);

      const integrity = db.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new Error(`CANONICAL_MASTER_INTEGRITY_FAILED:${integrity}`);
    } finally { db.close(); }

    const roleCounts = Object.fromEntries(['PRIME','SUB','BOTH'].map(role => [role, records.filter(row => row.award_role === role).length]));
    const lifecycleCounts = {};
    const segmentCounts = {};
    for (const record of records) {
      lifecycleCounts[record.lifecycle_state] = Number(lifecycleCounts[record.lifecycle_state] || 0) + 1;
      segmentCounts[record.primary_segment] = Number(segmentCounts[record.primary_segment] || 0) + 1;
    }
    const expectedPrimeOnly = expected.exactUniquePrimeAwardedUeis - expected.exactPrimeAndSubUeiOverlap;
    const expectedSubOnly = expected.exactUniqueSubcontractAwardedUeis - expected.exactPrimeAndSubUeiOverlap;
    const acceptance = {
      canonicalRowsEqualAwardedUnion: records.length === expected.exactUniqueAwardedUeisEitherRole,
      primeOnlyCountMatches: roleCounts.PRIME === expectedPrimeOnly,
      subOnlyCountMatches: roleCounts.SUB === expectedSubOnly,
      bothCountMatches: roleCounts.BOTH === expected.exactPrimeAndSubUeiOverlap,
      zeroAwardedUeisMissingFromCanonicalMaster: records.length === union.size,
      noDuplicateUeis: new Set(records.map(row => row.uei)).size === records.length
    };
    if (!Object.values(acceptance).every(Boolean)) throw new Error(`CANONICAL_MASTER_ACCEPTANCE_FAILED:${JSON.stringify(acceptance)}`);

    const grouped = new Map();
    for (const record of records) {
      if (!grouped.has(record.primary_segment)) grouped.set(record.primary_segment, []);
      grouped.get(record.primary_segment).push(record);
    }
    const segmentManifest = [];
    for (const [segment, rows] of [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const accountFile = path.join(accountSegmentRoot, `${segment}.csv`);
      const readyRows = rows.filter(row => row.lifecycle_state === 'OUTBOUND_READY');
      const readyFile = path.join(readySegmentRoot, `${segment}.csv`);
      this.writeCsv(accountFile, rows);
      this.writeCsv(readyFile, readyRows);
      segmentManifest.push({ segment, accountRows: rows.length, outboundReadyRows: readyRows.length, accountFile, outboundReadyFile: readyFile });
    }

    const allCsv = path.join(this.outputDir, `P2GC_CANONICAL_AWARDED_CONTRACTORS_${stamp}.csv`);
    this.writeCsv(allCsv, records);
    const report = {
      ok: true,
      status: 'CANONICAL_AWARDED_CONTRACTOR_MASTER_GREEN',
      generatedAt: new Date().toISOString(),
      scope: coverage.scope,
      counts: {
        canonicalAwardedContractors: records.length,
        currentOutboundMasterRows: coverage.currentMaster?.rows || null,
        currentOutboundMasterUniqueUeis: coverage.currentMaster?.uniqueUeis || null,
        awardedUeisAlreadyRepresentedInOutboundMaster: expected.exactAwardedUeisInCurrentMaster,
        awardedUeisPreviouslyMissingFromOutboundMaster: expected.exactAwardedUeisMissingFromCurrentMaster,
        roleCounts,
        lifecycleCounts,
        segmentCounts,
        newlyCreatedFallbackSegmentAccounts: records.filter(row => row.segment_source === 'AWARDED_ROLE_FALLBACK_CREATED').length,
        retainedExistingSegmentAccounts: records.filter(row => row.segment_source === 'CURRENT_SEGMENT_RETAINED').length
      },
      acceptance,
      segmentManifest,
      artifacts: { database: dbPath, csv: allCsv, segmentRoot, report: this.latestReportPath },
      safety: {
        productionOrionModified: false,
        currentOutboundMasterModified: false,
        providerMutation: false,
        campaignMutation: false,
        emailSent: false,
        suppressionOverridden: false,
        canonicalMasterIsAccountTruthLayer: true,
        outboundReadyExportsRequireVerifiedUnsuppressedContact: true
      }
    };
    fs.writeFileSync(this.latestReportPath, JSON.stringify(report, null, 2), 'utf8');
    return report;
  }
}

module.exports = CanonicalAwardedContractorMasterService;
module.exports.awardTier = awardTier;
module.exports.fallbackSegment = fallbackSegment;
module.exports.lifecycleState = lifecycleState;
