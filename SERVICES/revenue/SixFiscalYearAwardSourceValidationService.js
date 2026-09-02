'use strict';

const fs = require('fs');
const path = require('path');

const YEARS = [2021, 2022, 2023, 2024, 2025, 2026];

function clean(value) { return value == null ? '' : String(value).trim(); }
function normalizedKey(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return fallback; }
}
function uniq(values) { return [...new Set((values || []).filter(Boolean))]; }
function pathPenalty(file) {
  const text = String(file || '').toLowerCase();
  let score = 0;
  if (/\\backup\\|\/backup\//.test(text) || /backup/.test(path.basename(text))) score += 120;
  if (/_archive_old|old_copy|deprecated/.test(text)) score += 100;
  if (/archive_2026_review/.test(text)) score += 35;
  if (/\\staging\\|\/staging\//.test(text)) score += 25;
  if (/orion_core/.test(text)) score -= 25;
  if (/usa[_ -]?spending|usaspending/.test(text)) score -= 20;
  if (/all_years_prime/.test(text)) score -= 20;
  if (/government_contractor_truth/.test(text)) score -= 5;
  return score;
}
function sourceStamp(file) {
  const base = path.basename(String(file || ''));
  const matches = [...base.matchAll(/(?:^|[^0-9])(20\d{6})(?:[^0-9]|$)/g)];
  return matches.length ? matches[matches.length - 1][1] : '';
}
function isExactOfficialPrimeName(file, year) {
  return new RegExp(`^FY${year}_All_Contracts_Full_`, 'i').test(path.basename(String(file || '')));
}
function isAllYearsPath(file) { return /all[_ -]?years|multi[_ -]?year|historical/i.test(String(file || '')); }

function parseCsvHeader(text) {
  const row = [];
  let field = '';
  let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { row.push(field); break; }
    else field += ch;
  }
  if (!row.length && field) row.push(field);
  return row.map(clean).filter(Boolean);
}
function readCsvHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(256 * 1024);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return parseCsvHeader(buffer.subarray(0, bytes).toString('utf8'));
  } finally { fs.closeSync(fd); }
}
function hasAlias(keys, aliases) {
  const set = new Set(keys.map(normalizedKey));
  return aliases.some(alias => set.has(normalizedKey(alias)));
}

const PRIME_UEI = ['recipient_uei', 'Recipient UEI', 'recipient_unique_entity_identifier', 'unique_entity_id'];
const PRIME_NAME = ['recipient_name', 'recipient_legal_business_name', 'recipient legal business name', 'vendor_name'];
const PRIME_AMOUNT = ['federal_action_obligation', 'Federal Action Obligation', 'total_obligation', 'current_total_value_of_award'];
const SUB_UEI = ['sub_recipient_uei', 'Sub-Recipient UEI', 'subrecipient_uei', 'subawardee_uei', 'subawardee_or_recipient_uei', 'sub_awardee_or_recipient_uei'];
const SUB_NAME = ['sub_recipient_name', 'Sub-Recipient Name', 'subrecipient_name', 'subawardee_name', 'subcontractor_name'];
const SUB_AMOUNT = ['subaward_amount', 'Subaward Amount', 'sub_award_amount'];
const CAGE = ['cage', 'cage_code', 'recipient_cage', 'recipient_cage_code', 'subawardee_cage_code'];
const DOMAIN = ['website', 'domain', 'company_website', 'recipient_website'];
const ADDRESS = ['recipient_address_line_1', 'address', 'street_address', 'recipient_city_name', 'recipient_zip_4_code'];
const FY = ['action_date_fiscal_year', 'fiscal_year', 'award_fiscal_year', 'subaward_action_date_fiscal_year'];
const DATE = ['action_date', 'award_date', 'subaward_action_date', 'period_of_performance_start_date'];

function inspectHeader(headers) {
  const primeUei = hasAlias(headers, PRIME_UEI);
  const primeName = hasAlias(headers, PRIME_NAME);
  const subUei = hasAlias(headers, SUB_UEI);
  const subName = hasAlias(headers, SUB_NAME);
  const primeAmount = hasAlias(headers, PRIME_AMOUNT);
  const subAmount = hasAlias(headers, SUB_AMOUNT);
  const cage = hasAlias(headers, CAGE);
  const domain = hasAlias(headers, DOMAIN);
  const address = hasAlias(headers, ADDRESS);
  const fiscalYear = hasAlias(headers, FY);
  const date = hasAlias(headers, DATE);
  let role = 'UNKNOWN';
  if ((subUei || subName) && (subAmount || /sub/i.test(headers.join(' ')))) role = 'SUB';
  else if ((primeUei || primeName) && primeAmount) role = 'PRIME';
  const identity = role === 'SUB'
    ? { hasUeiColumn: subUei, hasNameColumn: subName, hasCageColumn: cage, hasDomainColumn: domain, hasAddressColumn: address }
    : { hasUeiColumn: primeUei, hasNameColumn: primeName, hasCageColumn: cage, hasDomainColumn: domain, hasAddressColumn: address };
  const defensibleIdentity = identity.hasUeiColumn || identity.hasCageColumn || (identity.hasNameColumn && (identity.hasDomainColumn || identity.hasAddressColumn));
  return {
    role,
    identity,
    defensibleIdentity,
    hasAmountColumn: role === 'SUB' ? subAmount : primeAmount,
    hasFiscalYearColumn: fiscalYear,
    hasDateColumn: date
  };
}

class SixFiscalYearAwardSourceValidationService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.inventoryPath = path.resolve(options.inventoryPath || path.join(this.rootDir, 'DATA', 'revenue_universe', 'latest_local_award_history_inventory.json'));
    this.outputDir = path.resolve(options.outputDir || path.join(this.rootDir, 'DATA', 'revenue_universe'));
    this.reportPath = path.join(this.outputDir, 'latest_six_fy_award_source_validation.json');
  }

  inspectCandidate(item) {
    const file = path.resolve(item.file);
    const result = {
      file,
      extension: path.extname(file).toLowerCase(),
      bytes: item.bytes == null ? null : Number(item.bytes),
      modifiedAt: item.modifiedAt || null,
      yearHints: Array.isArray(item.yearHints) ? item.yearHints.map(Number) : [],
      pathPenalty: pathPenalty(file),
      sourceStamp: sourceStamp(file),
      exists: fs.existsSync(file),
      status: 'UNINSPECTED',
      role: 'UNKNOWN',
      headers: [],
      schema: null,
      exactOfficialPrimeNameYears: YEARS.filter(year => isExactOfficialPrimeName(file, year)),
      allYearsContainerHint: isAllYearsPath(file)
    };
    if (!result.exists) { result.status = 'MISSING'; return result; }
    if (result.extension === '.csv') {
      try {
        result.headers = readCsvHeader(file);
        result.schema = inspectHeader(result.headers);
        result.role = result.schema.role;
        result.status = result.role !== 'UNKNOWN' && result.schema.defensibleIdentity ? 'CSV_SCHEMA_USABLE' : 'CSV_SCHEMA_NOT_AWARD_USABLE';
      } catch (error) {
        result.status = 'CSV_HEADER_READ_FAILED';
        result.error = String(error?.message || error);
      }
      return result;
    }
    if (['.db', '.sqlite', '.sqlite3'].includes(result.extension)) {
      try {
        const Database = require('better-sqlite3');
        const db = new Database(file, { readonly: true, fileMustExist: true });
        try {
          const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
          const primeLedger = tables.includes('award_history_prime');
          const subLedger = tables.includes('award_history_subcontracts');
          result.sqliteTables = tables.filter(name => /award|contract|sub/i.test(name)).slice(0, 50);
          result.role = primeLedger && subLedger ? 'PRIME_AND_SUB_LEDGER' : primeLedger ? 'PRIME_LEDGER' : subLedger ? 'SUB_LEDGER' : 'UNKNOWN';
          result.status = result.role === 'UNKNOWN' ? 'SQLITE_NO_CANONICAL_AWARD_LEDGER' : 'SQLITE_CANONICAL_AWARD_LEDGER';
        } finally { db.close(); }
      } catch (error) {
        result.status = 'SQLITE_INSPECTION_FAILED';
        result.error = String(error?.message || error);
      }
      return result;
    }
    if (result.extension === '.zip') {
      result.status = 'ZIP_REQUIRES_STAGING_EXTRACTION_VALIDATION';
      return result;
    }
    result.status = 'NON_TABULAR_CANDIDATE_REQUIRES_SPECIALIZED_VALIDATOR';
    return result;
  }

  candidateScore(item, year, role) {
    let score = item.pathPenalty;
    if (item.role === role && item.status === 'CSV_SCHEMA_USABLE') score -= 100;
    if (role === 'PRIME' && isExactOfficialPrimeName(item.file, year)) score -= 100;
    if (item.yearHints.includes(year)) score -= 40;
    if (item.allYearsContainerHint && item.schema?.hasFiscalYearColumn) score -= 15;
    if (!item.schema?.hasFiscalYearColumn && !item.yearHints.includes(year) && !isExactOfficialPrimeName(item.file, year)) score += 80;
    if (!item.schema?.hasDateColumn) score += 3;
    if (item.bytes && item.bytes > 100 * 1024 * 1024) score -= 2;
    return score;
  }

  selectRoleSources(inspected, year, role) {
    const usable = inspected.filter(item => item.status === 'CSV_SCHEMA_USABLE' && item.role === role && (
      item.yearHints.includes(year) ||
      (role === 'PRIME' && isExactOfficialPrimeName(item.file, year)) ||
      (item.allYearsContainerHint && item.schema?.hasFiscalYearColumn)
    ));
    if (!usable.length) return { ready: false, selected: [], candidates: [], blocker: `NO_VALIDATED_LOCAL_${role}_SOURCE_FY${year}` };
    const ranked = usable.map(item => ({ ...item, score: this.candidateScore(item, year, role) }))
      .sort((a, b) => a.score - b.score || String(b.sourceStamp).localeCompare(String(a.sourceStamp)) || (b.bytes || 0) - (a.bytes || 0));
    const best = ranked[0];
    const bestParent = path.dirname(best.file);
    let selected = ranked.filter(item => path.dirname(item.file) === bestParent && item.score <= best.score + 2);

    // Multiple dated full snapshots in one folder are duplicates, not shards: retain only newest snapshot.
    if (role === 'PRIME') {
      const exact = selected.filter(item => isExactOfficialPrimeName(item.file, year));
      if (exact.length > 1) {
        const newestStamp = exact.map(item => item.sourceStamp).filter(Boolean).sort().at(-1);
        if (newestStamp) selected = selected.filter(item => !isExactOfficialPrimeName(item.file, year) || item.sourceStamp === newestStamp);
      }
    }
    return {
      ready: selected.length > 0,
      selected: selected.map(item => ({
        file: item.file,
        role,
        year,
        bytes: item.bytes,
        modifiedAt: item.modifiedAt,
        score: item.score,
        sourceStamp: item.sourceStamp || null,
        schema: item.schema,
        selectionBasis: isExactOfficialPrimeName(item.file, year)
          ? 'EXACT_FY_OFFICIAL_FULL_CONTRACT_FILENAME_AND_VALIDATED_SCHEMA'
          : item.yearHints.includes(year)
            ? 'FY_SCOPED_PATH_AND_VALIDATED_SCHEMA'
            : 'ALL_YEARS_CONTAINER_WITH_FISCAL_YEAR_COLUMN_AND_VALIDATED_SCHEMA'
      })),
      candidates: ranked.slice(0, 20).map(item => ({ file: item.file, score: item.score, status: item.status, role: item.role, sourceStamp: item.sourceStamp || null })),
      blocker: null
    };
  }

  run(options = {}) {
    fs.mkdirSync(this.outputDir, { recursive: true });
    const inventory = options.inventory || readJson(this.inventoryPath, null);
    if (!inventory?.ok || !inventory?.fiscalYears) {
      const failed = { ok: false, status: 'LOCAL_AWARD_HISTORY_INVENTORY_REQUIRED', generatedAt: new Date().toISOString(), inventoryPath: this.inventoryPath };
      fs.writeFileSync(this.reportPath, JSON.stringify(failed, null, 2), 'utf8');
      return failed;
    }

    const rawCandidates = [];
    const seen = new Set();
    for (const year of YEARS) {
      for (const item of inventory.fiscalYears?.[String(year)]?.candidates || []) {
        const file = path.resolve(item.file);
        if (seen.has(file)) continue;
        seen.add(file);
        rawCandidates.push(item);
      }
    }
    for (const item of inventory.unscopedAwardCandidates || []) {
      const file = path.resolve(item.file);
      if (seen.has(file)) continue;
      seen.add(file);
      rawCandidates.push(item);
    }

    const inspected = rawCandidates.map(item => this.inspectCandidate(item));
    const byYear = {};
    const missingRequirements = [];
    for (const year of YEARS) {
      const prime = this.selectRoleSources(inspected, year, 'PRIME');
      const subcontract = this.selectRoleSources(inspected, year, 'SUB');
      if (!prime.ready) missingRequirements.push({ year, role: 'PRIME', blocker: prime.blocker });
      if (!subcontract.ready) missingRequirements.push({ year, role: 'SUB', blocker: subcontract.blocker });
      byYear[String(year)] = { prime, subcontract };
    }

    const report = {
      ok: true,
      status: missingRequirements.length ? 'SIX_FY_LOCAL_SOURCE_GAPS_PRESENT' : 'SIX_FY_LOCAL_SOURCE_VALIDATION_GREEN',
      generatedAt: new Date().toISOString(),
      inventory: {
        status: inventory.status || null,
        rootsSearched: inventory.rootsSearched || [],
        filesVisited: inventory.filesVisited || 0,
        candidateFiles: inventory.candidateFiles || 0,
        fiscalYearCandidateCounts: Object.fromEntries(YEARS.map(year => [String(year), Number(inventory.fiscalYears?.[String(year)]?.candidateCount || 0)]))
      },
      inspectedCandidates: inspected.length,
      usableCsvSources: inspected.filter(item => item.status === 'CSV_SCHEMA_USABLE').length,
      byYear,
      missingRequirements,
      readyForSixFiscalYearNormalization: missingRequirements.length === 0,
      sourceRules: {
        localInventoryFirst: true,
        exactFiscalYearFilenamePreferred: true,
        schemaValidationRequired: true,
        backupsPenalized: true,
        duplicateDatedFullSnapshotsCollapsedToNewest: true,
        missingUeiRowsMustNotBeDiscardedByNormalizer: true,
        secondaryIdentityResolutionRequired: ['CAGE', 'NORMALIZED_NAME_PLUS_DOMAIN', 'NORMALIZED_NAME_PLUS_ADDRESS'],
        unknownIdentityMustRemainVisible: true
      },
      safety: {
        readOnlySourceInspection: true,
        sourceFilesModified: false,
        productionOrionModified: false,
        currentOutboundMasterModified: false,
        providerMutation: false,
        campaignMutation: false,
        emailSent: false,
        suppressionOverridden: false,
        acquisitionTriggered: false
      },
      artifacts: { report: this.reportPath }
    };
    fs.writeFileSync(this.reportPath, JSON.stringify(report, null, 2), 'utf8');
    return report;
  }
}

module.exports = SixFiscalYearAwardSourceValidationService;
module.exports.inspectHeader = inspectHeader;
module.exports.parseCsvHeader = parseCsvHeader;
module.exports.pathPenalty = pathPenalty;
module.exports.isExactOfficialPrimeName = isExactOfficialPrimeName;
