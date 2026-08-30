'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { readCentralDirectory } = require('./OrionOfficialArchiveInspectorService');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function clean(v) { return v == null ? '' : String(v).trim(); }
function num(v) { const n = Number(String(v || '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; }
function isoNow() { return new Date().toISOString(); }
function safeName(v) { return String(v || '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120); }

function dataStartForEntry(file, entry) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(30);
    fs.readSync(fd, header, 0, 30, entry.localHeaderOffset);
    if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(`ZIP_LOCAL_HEADER_INVALID:${entry.name}`);
    return entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  } finally { fs.closeSync(fd); }
}

function entryStream(file, entry) {
  const start = dataStartForEntry(file, entry);
  const source = fs.createReadStream(file, { start, end: start + entry.compressedSize - 1 });
  if (entry.method === 0) return source;
  if (entry.method === 8) return source.pipe(zlib.createInflateRaw());
  source.destroy();
  throw new Error(`UNSUPPORTED_ZIP_METHOD:${entry.method}:${entry.name}`);
}

function parseCsvRecord(record) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < record.length; i++) {
    const ch = record[i];
    if (quoted) {
      if (ch === '"') {
        if (record[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field.length === 0) quoted = true;
    else if (ch === ',') { out.push(field); field = ''; }
    else field += ch;
  }
  out.push(field);
  return out;
}

function csvRecordComplete(text) {
  if (!text.includes('"')) return true;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"') continue;
    if (quoted && text[i + 1] === '"') { i++; continue; }
    quoted = !quoted;
  }
  return !quoted;
}

function maxTextDate(a, b) { if (!a) return b || null; if (!b) return a || null; return String(a) >= String(b) ? a : b; }
function minTextDate(a, b) { if (!a) return b || null; if (!b) return a || null; return String(a) <= String(b) ? a : b; }

class OrionContractStagingBuildService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.acquisitionPath = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_official_source_staging_acquisition.json');
    this.schemaAuditPath = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_refresh_target_schema_audit.json');
    this.reportPath = path.join(this.rootDir, 'DATA', 'orion_refresh', 'latest_contract_staging_build.json');
    this.stagingDir = path.join(this.rootDir, 'DATA', 'orion_refresh', 'staging_db');
    this.Database = options.Database || null;
    this.batchSize = Math.max(250, Number(options.batchSize || 5000));
    this.progressEvery = Math.max(10000, Number(options.progressEvery || 250000));
  }

  loadDatabase() {
    if (!this.Database) this.Database = require('better-sqlite3');
    return this.Database;
  }

  validateInputs() {
    const acquisition = readJson(this.acquisitionPath);
    const schemaAudit = readJson(this.schemaAuditPath);
    if (acquisition?.ok !== true || !Array.isArray(acquisition.downloads)) throw new Error('ACQUISITION_MANIFEST_NOT_GREEN');
    if (schemaAudit?.ok !== true || !schemaAudit.currentDb) throw new Error('TARGET_SCHEMA_AUDIT_NOT_GREEN');
    const full = acquisition.downloads.find(x => x.role === 'full');
    if (!full?.path || !fs.existsSync(full.path)) throw new Error('FULL_OFFICIAL_ARCHIVE_MISSING');
    const stat = fs.statSync(full.path);
    if (stat.size !== Number(full.downloadedBytes)) throw new Error('FULL_OFFICIAL_ARCHIVE_SIZE_CHANGED');
    if (!fs.existsSync(schemaAudit.currentDb)) throw new Error('CURRENT_ORION_DB_MISSING');
    return { acquisition, schemaAudit, full };
  }

  prepareCandidate(currentDb, sourceDate) {
    fs.mkdirSync(this.stagingDir, { recursive: true });
    const stamp = isoNow().replace(/[:.]/g, '-');
    const candidate = path.join(this.stagingDir, `ORION_CONTRACT_STAGING_${safeName(sourceDate || 'unknown')}_${stamp}.db`);
    fs.copyFileSync(currentDb, candidate, fs.constants.COPYFILE_EXCL);
    return candidate;
  }

  ensureSchema(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS orion_award_refresh_fy2026 (
        uei TEXT NOT NULL,
        award_key TEXT NOT NULL,
        award_id_piid TEXT,
        recipient_name TEXT,
        obligation REAL NOT NULL DEFAULT 0,
        current_total_value REAL NOT NULL DEFAULT 0,
        potential_total_value REAL NOT NULL DEFAULT 0,
        action_date_first TEXT,
        action_date_last TEXT,
        pop_start_date TEXT,
        pop_current_end_date TEXT,
        pop_potential_end_date TEXT,
        awarding_agency TEXT,
        awarding_sub_agency TEXT,
        awarding_office TEXT,
        funding_agency TEXT,
        naics_code TEXT,
        naics_description TEXT,
        psc_code TEXT,
        psc_description TEXT,
        set_aside_code TEXT,
        set_aside TEXT,
        extent_competed_code TEXT,
        extent_competed TEXT,
        solicitation_identifier TEXT,
        description TEXT,
        last_modified_date TEXT,
        source_archive TEXT NOT NULL,
        source_entry TEXT NOT NULL,
        refreshed_at TEXT NOT NULL,
        PRIMARY KEY (uei, award_key)
      );
      CREATE INDEX IF NOT EXISTS idx_orion_award_refresh_uei ON orion_award_refresh_fy2026(uei);
      CREATE INDEX IF NOT EXISTS idx_orion_award_refresh_end ON orion_award_refresh_fy2026(pop_potential_end_date);
      CREATE TABLE IF NOT EXISTS orion_contractor_fy2026_summary (
        uei TEXT PRIMARY KEY,
        federal_obligations REAL NOT NULL DEFAULT 0,
        award_count INTEGER NOT NULL DEFAULT 0,
        latest_action_date TEXT,
        refreshed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS orion_buyer_fy2026_summary (
        uei TEXT NOT NULL,
        buyer_name TEXT NOT NULL,
        agency TEXT,
        award_count INTEGER NOT NULL DEFAULT 0,
        spend REAL NOT NULL DEFAULT 0,
        refreshed_at TEXT NOT NULL,
        PRIMARY KEY (uei, buyer_name)
      );
      CREATE TABLE IF NOT EXISTS orion_recompete_fy2026 (
        uei TEXT NOT NULL,
        award_key TEXT NOT NULL,
        title TEXT,
        agency TEXT,
        recompete_date TEXT,
        value REAL NOT NULL DEFAULT 0,
        refreshed_at TEXT NOT NULL,
        PRIMARY KEY (uei, award_key)
      );
      CREATE TABLE IF NOT EXISTS orion_source_refresh_manifest (
        source_family TEXT PRIMARY KEY,
        source_scope TEXT NOT NULL,
        source_updated_date TEXT,
        source_archive TEXT,
        source_sha256 TEXT,
        transaction_rows INTEGER NOT NULL DEFAULT 0,
        award_rows INTEGER NOT NULL DEFAULT 0,
        contractor_summary_rows INTEGER NOT NULL DEFAULT 0,
        imported_at TEXT NOT NULL,
        production_promoted INTEGER NOT NULL DEFAULT 0,
        notes TEXT
      );
    `);
  }

  async importFullArchive(db, full) {
    const { entries } = readCentralDirectory(full.path);
    const csvEntries = entries.filter(x => /\.csv$/i.test(x.name));
    if (!csvEntries.length) throw new Error('FULL_ARCHIVE_HAS_NO_CSV_ENTRIES');
    const refreshedAt = isoNow();
    const upsert = db.prepare(`
      INSERT INTO orion_award_refresh_fy2026 (
        uei, award_key, award_id_piid, recipient_name, obligation, current_total_value, potential_total_value,
        action_date_first, action_date_last, pop_start_date, pop_current_end_date, pop_potential_end_date,
        awarding_agency, awarding_sub_agency, awarding_office, funding_agency, naics_code, naics_description,
        psc_code, psc_description, set_aside_code, set_aside, extent_competed_code, extent_competed,
        solicitation_identifier, description, last_modified_date, source_archive, source_entry, refreshed_at
      ) VALUES (@uei,@award_key,@award_id_piid,@recipient_name,@obligation,@current_total_value,@potential_total_value,
        @action_date,@action_date,@pop_start_date,@pop_current_end_date,@pop_potential_end_date,
        @awarding_agency,@awarding_sub_agency,@awarding_office,@funding_agency,@naics_code,@naics_description,
        @psc_code,@psc_description,@set_aside_code,@set_aside,@extent_competed_code,@extent_competed,
        @solicitation_identifier,@description,@last_modified_date,@source_archive,@source_entry,@refreshed_at)
      ON CONFLICT(uei, award_key) DO UPDATE SET
        obligation = obligation + excluded.obligation,
        current_total_value = MAX(current_total_value, excluded.current_total_value),
        potential_total_value = MAX(potential_total_value, excluded.potential_total_value),
        action_date_first = CASE WHEN action_date_first IS NULL OR excluded.action_date_first < action_date_first THEN excluded.action_date_first ELSE action_date_first END,
        action_date_last = CASE WHEN action_date_last IS NULL OR excluded.action_date_last > action_date_last THEN excluded.action_date_last ELSE action_date_last END,
        pop_start_date = COALESCE(pop_start_date, excluded.pop_start_date),
        pop_current_end_date = CASE WHEN pop_current_end_date IS NULL OR excluded.pop_current_end_date > pop_current_end_date THEN excluded.pop_current_end_date ELSE pop_current_end_date END,
        pop_potential_end_date = CASE WHEN pop_potential_end_date IS NULL OR excluded.pop_potential_end_date > pop_potential_end_date THEN excluded.pop_potential_end_date ELSE pop_potential_end_date END,
        recipient_name = COALESCE(NULLIF(excluded.recipient_name,''), recipient_name),
        awarding_agency = COALESCE(NULLIF(excluded.awarding_agency,''), awarding_agency),
        awarding_sub_agency = COALESCE(NULLIF(excluded.awarding_sub_agency,''), awarding_sub_agency),
        awarding_office = COALESCE(NULLIF(excluded.awarding_office,''), awarding_office),
        funding_agency = COALESCE(NULLIF(excluded.funding_agency,''), funding_agency),
        naics_code = COALESCE(NULLIF(excluded.naics_code,''), naics_code),
        naics_description = COALESCE(NULLIF(excluded.naics_description,''), naics_description),
        psc_code = COALESCE(NULLIF(excluded.psc_code,''), psc_code),
        psc_description = COALESCE(NULLIF(excluded.psc_description,''), psc_description),
        set_aside_code = COALESCE(NULLIF(excluded.set_aside_code,''), set_aside_code),
        set_aside = COALESCE(NULLIF(excluded.set_aside,''), set_aside),
        extent_competed_code = COALESCE(NULLIF(excluded.extent_competed_code,''), extent_competed_code),
        extent_competed = COALESCE(NULLIF(excluded.extent_competed,''), extent_competed),
        solicitation_identifier = COALESCE(NULLIF(excluded.solicitation_identifier,''), solicitation_identifier),
        description = COALESCE(NULLIF(excluded.description,''), description),
        last_modified_date = CASE WHEN last_modified_date IS NULL OR excluded.last_modified_date > last_modified_date THEN excluded.last_modified_date ELSE last_modified_date END,
        refreshed_at = excluded.refreshed_at
    `);
    const batch = db.transaction(rows => { for (const row of rows) upsert.run(row); });
    let transactionRows = 0;
    for (const entry of csvEntries) {
      const stream = entryStream(full.path, entry);
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      let header = null, index = null, pending = '', rows = [];
      for await (const physicalLine of rl) {
        pending = pending ? `${pending}\n${physicalLine}` : physicalLine;
        if (!csvRecordComplete(pending)) continue;
        const fields = parseCsvRecord(pending.replace(/^\uFEFF/, ''));
        pending = '';
        if (!header) {
          header = fields.map(clean);
          index = Object.fromEntries(header.map((name, i) => [name, i]));
          const required = ['contract_award_unique_key','recipient_uei','federal_action_obligation','action_date'];
          const missing = required.filter(k => index[k] == null);
          if (missing.length) throw new Error(`FULL_CSV_REQUIRED_COLUMNS_MISSING:${missing.join(',')}`);
          continue;
        }
        const g = name => index[name] == null ? '' : fields[index[name]];
        const uei = clean(g('recipient_uei')).toUpperCase();
        const awardKey = clean(g('contract_award_unique_key')) || clean(g('award_id_piid'));
        if (!uei || !awardKey) continue;
        rows.push({
          uei, award_key: awardKey, award_id_piid: clean(g('award_id_piid')), recipient_name: clean(g('recipient_name')),
          obligation: num(g('federal_action_obligation')), current_total_value: num(g('current_total_value_of_award') || g('total_dollars_obligated')),
          potential_total_value: num(g('potential_total_value_of_award')), action_date: clean(g('action_date')) || null,
          pop_start_date: clean(g('period_of_performance_start_date')) || null, pop_current_end_date: clean(g('period_of_performance_current_end_date')) || null,
          pop_potential_end_date: clean(g('period_of_performance_potential_end_date')) || null, awarding_agency: clean(g('awarding_agency_name')),
          awarding_sub_agency: clean(g('awarding_sub_agency_name')), awarding_office: clean(g('awarding_office_name')), funding_agency: clean(g('funding_agency_name')),
          naics_code: clean(g('naics_code')), naics_description: clean(g('naics_description')), psc_code: clean(g('product_or_service_code')),
          psc_description: clean(g('product_or_service_code_description')), set_aside_code: clean(g('type_of_set_aside_code')), set_aside: clean(g('type_of_set_aside')),
          extent_competed_code: clean(g('extent_competed_code')), extent_competed: clean(g('extent_competed')), solicitation_identifier: clean(g('solicitation_identifier')),
          description: clean(g('transaction_description') || g('prime_award_base_transaction_description')), last_modified_date: clean(g('last_modified_date')) || null,
          source_archive: full.fileName, source_entry: entry.name, refreshed_at: refreshedAt
        });
        transactionRows++;
        if (rows.length >= this.batchSize) { batch(rows); rows = []; }
        if (transactionRows % this.progressEvery === 0) console.log(`ORION_STAGING_IMPORT_PROGRESS rows=${transactionRows}`);
      }
      if (pending) throw new Error(`CSV_UNTERMINATED_QUOTED_RECORD:${entry.name}`);
      if (rows.length) batch(rows);
    }
    return { transactionRows, csvEntries: csvEntries.length, refreshedAt };
  }

  derive(db, refreshedAt) {
    db.exec('DELETE FROM orion_contractor_fy2026_summary; DELETE FROM orion_buyer_fy2026_summary; DELETE FROM orion_recompete_fy2026;');
    db.prepare(`INSERT INTO orion_contractor_fy2026_summary (uei,federal_obligations,award_count,latest_action_date,refreshed_at)
      SELECT uei, COALESCE(SUM(obligation),0), COUNT(*), MAX(action_date_last), ? FROM orion_award_refresh_fy2026 GROUP BY uei`).run(refreshedAt);
    db.prepare(`INSERT INTO orion_buyer_fy2026_summary (uei,buyer_name,agency,award_count,spend,refreshed_at)
      SELECT uei, COALESCE(NULLIF(awarding_office,''), COALESCE(NULLIF(awarding_sub_agency,''), awarding_agency)), awarding_agency,
      COUNT(*), COALESCE(SUM(obligation),0), ? FROM orion_award_refresh_fy2026
      WHERE COALESCE(NULLIF(awarding_office,''), NULLIF(awarding_sub_agency,''), NULLIF(awarding_agency,'')) IS NOT NULL
      GROUP BY uei, COALESCE(NULLIF(awarding_office,''), COALESCE(NULLIF(awarding_sub_agency,''), awarding_agency)), awarding_agency`).run(refreshedAt);
    db.prepare(`INSERT INTO orion_recompete_fy2026 (uei,award_key,title,agency,recompete_date,value,refreshed_at)
      SELECT uei, award_key, COALESCE(NULLIF(description,''), award_id_piid), awarding_agency,
      COALESCE(NULLIF(pop_potential_end_date,''), pop_current_end_date), MAX(potential_total_value,current_total_value), ?
      FROM orion_award_refresh_fy2026 WHERE COALESCE(NULLIF(pop_potential_end_date,''), NULLIF(pop_current_end_date,'')) IS NOT NULL`).run(refreshedAt);
  }

  runValidation(db) {
    const integrity = db.pragma('integrity_check', { simple: true });
    const awardRows = db.prepare('SELECT COUNT(*) AS n FROM orion_award_refresh_fy2026').get().n;
    const summaryRows = db.prepare('SELECT COUNT(*) AS n FROM orion_contractor_fy2026_summary').get().n;
    const matched = db.prepare(`SELECT COUNT(*) AS n FROM orion_contractor_fy2026_summary s JOIN contractors c ON UPPER(c.uei)=UPPER(s.uei)`).get().n;
    const buyerRows = db.prepare('SELECT COUNT(*) AS n FROM orion_buyer_fy2026_summary').get().n;
    const recompeteRows = db.prepare('SELECT COUNT(*) AS n FROM orion_recompete_fy2026').get().n;
    return { integrity, awardRows, summaryRows, matchedContractorRows: matched, buyerRows, recompeteRows, ok: integrity === 'ok' && awardRows > 0 && summaryRows > 0 };
  }

  async run() {
    const { acquisition, schemaAudit, full } = this.validateInputs();
    const candidate = this.prepareCandidate(schemaAudit.currentDb, full.updatedDate || acquisition.planGeneratedAt);
    const Database = this.loadDatabase();
    const db = new Database(candidate);
    let result;
    try {
      db.pragma('journal_mode = DELETE');
      db.pragma('synchronous = NORMAL');
      this.ensureSchema(db);
      db.exec('DELETE FROM orion_award_refresh_fy2026;');
      const imported = await this.importFullArchive(db, full);
      this.derive(db, imported.refreshedAt);
      const validation = this.runValidation(db);
      if (!validation.ok) throw new Error(`STAGING_VALIDATION_FAILED:${JSON.stringify(validation)}`);
      db.prepare(`INSERT OR REPLACE INTO orion_source_refresh_manifest
        (source_family,source_scope,source_updated_date,source_archive,source_sha256,transaction_rows,award_rows,contractor_summary_rows,imported_at,production_promoted,notes)
        VALUES (?,?,?,?,?,?,?,?,?,0,?)`).run('USAspending contracts','FY2026 full contract archive', full.updatedDate || null, full.fileName || null, full.sha256 || null,
          imported.transactionRows, validation.awardRows, validation.summaryRows, imported.refreshedAt,
          'Award, buyer and recompete sidecar facts rebuilt in staging. Existing ORION tables remain unchanged until a separate promotion contract is validated.');
      result = {
        ok: true,
        service: 'ORION_CONTRACT_STAGING_BUILD',
        generatedAt: isoNow(),
        productionDb: schemaAudit.currentDb,
        stagingDb: candidate,
        source: { archive: full.fileName, sha256: full.sha256 || null, updatedDate: full.updatedDate || null },
        imported,
        validation,
        nextStep: 'VALIDATE_STAGING_FACTS_AGAINST_CURRENT_ORION_AND_PROMOTION_POLICY',
        safety: { productionDatabaseModified:false, stagingDatabaseCreated:true, stagingDatabasePromoted:false, existingCoreTablesModified:false, freshnessFabricated:false }
      };
    } catch (error) {
      try { db.close(); } catch {}
      try { fs.unlinkSync(candidate); } catch {}
      throw error;
    }
    db.close();
    fs.mkdirSync(path.dirname(this.reportPath), { recursive:true });
    fs.writeFileSync(this.reportPath, JSON.stringify(result, null, 2), 'utf8');
    return result;
  }
}

module.exports = OrionContractStagingBuildService;
module.exports.parseCsvRecord = parseCsvRecord;
module.exports.csvRecordComplete = csvRecordComplete;
module.exports.entryStream = entryStream;
