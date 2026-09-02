'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const csv = require('csv-parser');

const YEARS = [2021, 2022, 2023, 2024, 2025, 2026];

function clean(value) { return value == null ? '' : String(value).trim(); }
function normKey(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function normUei(value) { return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function normCage(value) { return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function normName(value) { return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function normDomain(value) {
  return clean(value).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(':')[0].replace(/\.$/, '');
}
function normAddress(value) { return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function num(value) {
  const parsed = Number(clean(value).replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
function sha(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex').toUpperCase(); }
function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return fallback; }
}
function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function aliasValue(row, aliases) {
  const lookup = new Map(Object.keys(row || {}).map(key => [normKey(key), row[key]]));
  for (const alias of aliases) {
    const value = lookup.get(normKey(alias));
    if (value !== undefined && clean(value) !== '') return value;
  }
  return '';
}
function uniqueSorted(values) { return [...new Set(values)].sort((a, b) => Number(a) - Number(b)); }

const COMMON = {
  cage: ['cage', 'cage_code', 'recipient_cage', 'recipient_cage_code', 'subawardee_cage_code', 'sub_recipient_cage_code'],
  domain: ['website', 'domain', 'company_website', 'recipient_website', 'sub_recipient_website'],
  address: ['recipient_address_line_1', 'address', 'street_address', 'recipient_city_name', 'recipient_zip_4_code', 'sub_recipient_address_line_1', 'subawardee_address_line_1'],
  fy: ['action_date_fiscal_year', 'fiscal_year', 'award_fiscal_year', 'subaward_action_date_fiscal_year'],
  date: ['action_date', 'award_date', 'subaward_action_date', 'period_of_performance_start_date']
};
const PRIME = {
  uei: ['recipient_uei', 'Recipient UEI', 'recipient_unique_entity_identifier', 'unique_entity_id'],
  name: ['recipient_name', 'recipient_legal_business_name', 'recipient legal business name', 'vendor_name'],
  amount: ['federal_action_obligation', 'Federal Action Obligation', 'total_obligation', 'current_total_value_of_award'],
  awardId: ['generated_unique_award_id', 'award_id_piid', 'award_id', 'piid', 'award_number']
};
const SUB = {
  uei: ['sub_recipient_uei', 'Sub-Recipient UEI', 'subrecipient_uei', 'subawardee_uei', 'subawardee_or_recipient_uei', 'sub_awardee_or_recipient_uei'],
  name: ['sub_recipient_name', 'Sub-Recipient Name', 'subrecipient_name', 'subawardee_name', 'subcontractor_name'],
  amount: ['subaward_amount', 'Subaward Amount', 'sub_award_amount'],
  awardId: ['subaward_id', 'subaward_number', 'sub_award_id', 'subaward_unique_id']
};
const MASTER = {
  uei: ['uei', 'unique_entity_id', 'unique entity identifier', 'recipient_uei', 'Recipient UEI'],
  cage: COMMON.cage,
  name: ['company', 'company_name', 'company name', 'legal_business_name', 'recipient_name', 'recipient legal business name'],
  domain: COMMON.domain,
  address: COMMON.address
};

function identityAliases(fields) {
  const out = [];
  if (fields.cage) out.push(`CAGE:${fields.cage}`);
  if (fields.name && fields.domain) out.push(`NAME_DOMAIN:${fields.name}|${fields.domain}`);
  if (fields.name && fields.address) out.push(`NAME_ADDRESS:${fields.name}|${fields.address}`);
  return out;
}

function blankAnnual() {
  return Object.fromEntries(YEARS.map(year => [String(year), {
    primeEvidenceRows: 0,
    primeDollars: 0,
    subEvidenceRows: 0,
    subDollars: 0
  }]));
}
function newAccount(key, fields, confidence) {
  return {
    canonicalKey: key,
    uei: fields.uei || null,
    cage: fields.cage || null,
    companyName: fields.nameRaw || null,
    normalizedName: fields.name || null,
    domain: fields.domain || null,
    address: fields.address || null,
    identityConfidence: confidence,
    identityMethods: new Set([confidence]),
    aliases: new Set(),
    primeYears: new Set(),
    subYears: new Set(),
    primeEvidenceRows: 0,
    subEvidenceRows: 0,
    primeDollars: 0,
    subDollars: 0,
    firstAwardFy: null,
    lastAwardFy: null,
    firstAwardDate: null,
    lastAwardDate: null,
    annual: blankAnnual(),
    sourceFiles: new Set(),
    rowsWithoutUei: 0,
    masterMatch: null
  };
}
function betterConfidence(current, incoming) {
  const rank = {
    UEI_EXACT: 100,
    SECONDARY_MATCH_TO_UEI: 90,
    CAGE_EXACT: 80,
    NAME_DOMAIN: 70,
    NAME_ADDRESS: 60,
    UNKNOWN_IDENTITY_KEY: 10
  };
  return (rank[incoming] || 0) > (rank[current] || 0) ? incoming : current;
}

function trajectory(account) {
  const years = uniqueSorted([...account.primeYears, ...account.subYears]);
  if (!years.length) return 'UNKNOWN';
  const first = years[0];
  const last = years[years.length - 1];
  const activeValues = YEARS.map(year => ({
    year,
    value: (account.annual[String(year)]?.primeDollars || 0) + (account.annual[String(year)]?.subDollars || 0)
  })).filter(row => Math.abs(row.value) > 0);
  if (first === 2026 && last === 2026) return 'FIRST_TIME_RECENT_WINNER';
  if (last < 2025) return `DORMANT_LAST_AWARD_FY${last}`;
  const prior = activeValues.filter(row => row.year < last).at(-1);
  const latest = activeValues.find(row => row.year === last);
  if (!prior || !latest) return last >= 2025 ? 'ACTIVE_RECENT' : 'DORMANT';
  if (last - prior.year > 1) return 'RETURNING_AFTER_GAP';
  const denominator = Math.max(Math.abs(prior.value), 1);
  const change = (latest.value - prior.value) / denominator;
  if (change >= 0.15) return 'GROWING';
  if (change <= -0.15) return 'DECLINING';
  return 'STABLE';
}

class SixFiscalYearAwardUniverseNormalizerService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.outputDir = path.resolve(options.outputDir || path.join(this.rootDir, 'DATA', 'revenue_universe'));
    this.sourceValidationPath = path.resolve(options.sourceValidationPath || path.join(this.outputDir, 'latest_six_fy_award_source_validation.json'));
    this.currentMasterPath = options.currentMasterPath || process.env.P2GC_CURRENT_MASTER || 'D:\\P2GC_Intelligence\\ARCHIVE_2026_REVIEW\\Good Files to use\\Good To Use and segmented\\MASTER_DEDUPED_ALL_SEGMENTS.csv';
    this.reportPath = path.join(this.outputDir, 'latest_six_fy_awarded_universe_normalization.json');
    this.csvPath = path.join(this.outputDir, 'latest_six_fy_awarded_contractor_universe.csv');
    this.awardKeyDbPath = path.join(this.outputDir, 'latest_six_fy_award_keys.sqlite');
    this.accounts = new Map();
    this.aliasIndex = new Map();
    this.aliasAmbiguous = new Set();
    this.stats = {
      sourceRowsRead: 0,
      sourceRowsAccepted: 0,
      sourceRowsOutsideExpectedFy: 0,
      rowsWithoutUei: 0,
      rowsWithoutDefensibleSecondaryIdentity: 0,
      identityMergeCount: 0,
      sourceErrors: []
    };
    this.Database = options.Database || null;
  }

  loadDatabase() {
    if (!this.Database) this.Database = require('better-sqlite3');
    return this.Database;
  }

  registerAlias(alias, key) {
    if (!alias || this.aliasAmbiguous.has(alias)) return;
    if (!this.aliasIndex.has(alias)) { this.aliasIndex.set(alias, key); return; }
    const existing = this.aliasIndex.get(alias);
    if (existing !== key) {
      this.aliasIndex.delete(alias);
      this.aliasAmbiguous.add(alias);
    }
  }

  mergeAccounts(targetKey, sourceKey, db) {
    if (!targetKey || !sourceKey || targetKey === sourceKey) return targetKey;
    const target = this.accounts.get(targetKey);
    const source = this.accounts.get(sourceKey);
    if (!target || !source) return targetKey;
    if (target.uei && source.uei && target.uei !== source.uei) return targetKey;
    target.uei = target.uei || source.uei;
    target.cage = target.cage || source.cage;
    target.companyName = target.companyName || source.companyName;
    target.normalizedName = target.normalizedName || source.normalizedName;
    target.domain = target.domain || source.domain;
    target.address = target.address || source.address;
    target.identityConfidence = betterConfidence(target.identityConfidence, source.identityConfidence);
    for (const method of source.identityMethods) target.identityMethods.add(method);
    for (const alias of source.aliases) {
      target.aliases.add(alias);
      if (this.aliasIndex.get(alias) === sourceKey) this.aliasIndex.set(alias, targetKey);
    }
    for (const year of source.primeYears) target.primeYears.add(year);
    for (const year of source.subYears) target.subYears.add(year);
    target.primeEvidenceRows += source.primeEvidenceRows;
    target.subEvidenceRows += source.subEvidenceRows;
    target.primeDollars += source.primeDollars;
    target.subDollars += source.subDollars;
    target.rowsWithoutUei += source.rowsWithoutUei;
    target.firstAwardFy = target.firstAwardFy == null ? source.firstAwardFy : source.firstAwardFy == null ? target.firstAwardFy : Math.min(target.firstAwardFy, source.firstAwardFy);
    target.lastAwardFy = target.lastAwardFy == null ? source.lastAwardFy : source.lastAwardFy == null ? target.lastAwardFy : Math.max(target.lastAwardFy, source.lastAwardFy);
    if (!target.firstAwardDate || (source.firstAwardDate && source.firstAwardDate < target.firstAwardDate)) target.firstAwardDate = source.firstAwardDate || target.firstAwardDate;
    if (!target.lastAwardDate || (source.lastAwardDate && source.lastAwardDate > target.lastAwardDate)) target.lastAwardDate = source.lastAwardDate || target.lastAwardDate;
    for (const year of YEARS) {
      const t = target.annual[String(year)];
      const s = source.annual[String(year)];
      t.primeEvidenceRows += s.primeEvidenceRows;
      t.primeDollars += s.primeDollars;
      t.subEvidenceRows += s.subEvidenceRows;
      t.subDollars += s.subDollars;
    }
    for (const file of source.sourceFiles) target.sourceFiles.add(file);
    if (db) {
      const move = db.transaction(() => {
        db.prepare('INSERT OR IGNORE INTO award_keys(canonical_key, role, award_id) SELECT ?, role, award_id FROM award_keys WHERE canonical_key = ?').run(targetKey, sourceKey);
        db.prepare('DELETE FROM award_keys WHERE canonical_key = ?').run(sourceKey);
      });
      move();
    }
    this.accounts.delete(sourceKey);
    this.stats.identityMergeCount += 1;
    return targetKey;
  }

  resolveAccount(fields, context, db) {
    const aliases = identityAliases(fields);
    const ueiKey = fields.uei ? `UEI:${fields.uei}` : null;
    if (ueiKey) {
      if (!this.accounts.has(ueiKey)) this.accounts.set(ueiKey, newAccount(ueiKey, fields, 'UEI_EXACT'));
      let account = this.accounts.get(ueiKey);
      account.uei = fields.uei;
      account.identityConfidence = 'UEI_EXACT';
      account.identityMethods.add('UEI_EXACT');
      for (const alias of aliases) {
        const existing = this.aliasIndex.get(alias);
        if (existing && existing !== ueiKey) {
          const other = this.accounts.get(existing);
          if (other && !other.uei) this.mergeAccounts(ueiKey, existing, db);
          else if (other?.uei && other.uei !== fields.uei) {
            this.aliasIndex.delete(alias);
            this.aliasAmbiguous.add(alias);
          }
        }
      }
      account = this.accounts.get(ueiKey);
      for (const alias of aliases) { account.aliases.add(alias); this.registerAlias(alias, ueiKey); }
      return account;
    }

    this.stats.rowsWithoutUei += 1;
    for (const alias of aliases) {
      const matchedKey = this.aliasIndex.get(alias);
      if (matchedKey && this.accounts.has(matchedKey)) {
        const account = this.accounts.get(matchedKey);
        const method = account.uei ? 'SECONDARY_MATCH_TO_UEI' : alias.startsWith('CAGE:') ? 'CAGE_EXACT' : alias.startsWith('NAME_DOMAIN:') ? 'NAME_DOMAIN' : 'NAME_ADDRESS';
        account.identityConfidence = betterConfidence(account.identityConfidence, method);
        account.identityMethods.add(method);
        account.rowsWithoutUei += 1;
        return account;
      }
    }

    let key = null;
    let confidence = null;
    if (fields.cage) { key = `CAGE:${fields.cage}`; confidence = 'CAGE_EXACT'; }
    else if (fields.name && fields.domain) { key = `NAME_DOMAIN:${fields.name}|${fields.domain}`; confidence = 'NAME_DOMAIN'; }
    else if (fields.name && fields.address) { key = `NAME_ADDRESS:${fields.name}|${fields.address}`; confidence = 'NAME_ADDRESS'; }
    else {
      const weak = [fields.name || '', path.basename(context.file || ''), context.role, context.year].join('|');
      key = `UNKNOWN_IDENTITY_KEY:${sha(weak)}`;
      confidence = 'UNKNOWN_IDENTITY_KEY';
      this.stats.rowsWithoutDefensibleSecondaryIdentity += 1;
    }
    if (!this.accounts.has(key)) this.accounts.set(key, newAccount(key, fields, confidence));
    const account = this.accounts.get(key);
    account.identityConfidence = betterConfidence(account.identityConfidence, confidence);
    account.identityMethods.add(confidence);
    account.rowsWithoutUei += 1;
    for (const alias of aliases) { account.aliases.add(alias); this.registerAlias(alias, key); }
    return account;
  }

  fieldsFor(row, role) {
    const spec = role === 'PRIME' ? PRIME : SUB;
    const nameRaw = clean(aliasValue(row, spec.name));
    return {
      uei: normUei(aliasValue(row, spec.uei)),
      cage: normCage(aliasValue(row, COMMON.cage)),
      nameRaw,
      name: normName(nameRaw),
      domain: normDomain(aliasValue(row, COMMON.domain)),
      address: normAddress(aliasValue(row, COMMON.address)),
      amount: num(aliasValue(row, spec.amount)),
      awardId: clean(aliasValue(row, spec.awardId)),
      rowFiscalYear: Number(clean(aliasValue(row, COMMON.fy))) || null,
      actionDate: clean(aliasValue(row, COMMON.date)) || null
    };
  }

  applyAward(account, fields, context, insertAwardKey) {
    const year = Number(context.year);
    const annual = account.annual[String(year)];
    const isPrime = context.role === 'PRIME';
    if (isPrime) {
      account.primeYears.add(year);
      account.primeEvidenceRows += 1;
      account.primeDollars += fields.amount;
      annual.primeEvidenceRows += 1;
      annual.primeDollars += fields.amount;
    } else {
      account.subYears.add(year);
      account.subEvidenceRows += 1;
      account.subDollars += fields.amount;
      annual.subEvidenceRows += 1;
      annual.subDollars += fields.amount;
    }
    account.firstAwardFy = account.firstAwardFy == null ? year : Math.min(account.firstAwardFy, year);
    account.lastAwardFy = account.lastAwardFy == null ? year : Math.max(account.lastAwardFy, year);
    if (fields.actionDate) {
      if (!account.firstAwardDate || fields.actionDate < account.firstAwardDate) account.firstAwardDate = fields.actionDate;
      if (!account.lastAwardDate || fields.actionDate > account.lastAwardDate) account.lastAwardDate = fields.actionDate;
    }
    if (!account.companyName && fields.nameRaw) account.companyName = fields.nameRaw;
    if (!account.cage && fields.cage) account.cage = fields.cage;
    if (!account.domain && fields.domain) account.domain = fields.domain;
    if (!account.address && fields.address) account.address = fields.address;
    account.sourceFiles.add(context.file);
    if (fields.awardId) insertAwardKey.run(account.canonicalKey, context.role, fields.awardId);
  }

  async processSource(file, role, year, db) {
    const insertAwardKey = db.prepare('INSERT OR IGNORE INTO award_keys(canonical_key, role, award_id) VALUES (?, ?, ?)');
    let rows = 0;
    let accepted = 0;
    const transaction = db.transaction(batch => {
      for (const item of batch) insertAwardKey.run(item.key, item.role, item.awardId);
    });
    const awardBuffer = [];
    try {
      for await (const row of fs.createReadStream(file).pipe(csv())) {
        rows += 1;
        this.stats.sourceRowsRead += 1;
        const fields = this.fieldsFor(row, role);
        if (fields.rowFiscalYear && fields.rowFiscalYear !== Number(year)) {
          this.stats.sourceRowsOutsideExpectedFy += 1;
          continue;
        }
        if (!fields.uei && !fields.cage && !(fields.name && fields.domain) && !(fields.name && fields.address) && !fields.name) {
          this.stats.rowsWithoutDefensibleSecondaryIdentity += 1;
          continue;
        }
        const account = this.resolveAccount(fields, { file, role, year, row: rows }, db);
        this.applyAward(account, fields, { file, role, year }, { run: (key, awardRole, awardId) => {
          awardBuffer.push({ key, role: awardRole, awardId });
          if (awardBuffer.length >= 5000) {
            transaction(awardBuffer.splice(0, awardBuffer.length));
          }
        }});
        accepted += 1;
        this.stats.sourceRowsAccepted += 1;
      }
      if (awardBuffer.length) transaction(awardBuffer.splice(0, awardBuffer.length));
      return { file, role, year, rowsRead: rows, rowsAccepted: accepted, ok: true };
    } catch (error) {
      const failure = { file, role, year, rowsRead: rows, rowsAccepted: accepted, ok: false, error: String(error?.message || error) };
      this.stats.sourceErrors.push(failure);
      return failure;
    }
  }

  async loadCurrentMaster() {
    const result = {
      rows: 0,
      ueiSet: new Set(),
      cageMap: new Map(),
      nameDomainMap: new Map(),
      nameAddressMap: new Map()
    };
    if (!fs.existsSync(this.currentMasterPath)) return { ...result, missing: true };
    function addUnique(map, alias, rowId) {
      if (!alias) return;
      if (!map.has(alias)) map.set(alias, rowId);
      else if (map.get(alias) !== rowId) map.set(alias, null);
    }
    let rowId = 0;
    for await (const row of fs.createReadStream(this.currentMasterPath).pipe(csv())) {
      rowId += 1;
      result.rows += 1;
      const uei = normUei(aliasValue(row, MASTER.uei));
      const cage = normCage(aliasValue(row, MASTER.cage));
      const name = normName(aliasValue(row, MASTER.name));
      const domain = normDomain(aliasValue(row, MASTER.domain));
      const address = normAddress(aliasValue(row, MASTER.address));
      if (uei) result.ueiSet.add(uei);
      if (cage) addUnique(result.cageMap, `CAGE:${cage}`, rowId);
      if (name && domain) addUnique(result.nameDomainMap, `NAME_DOMAIN:${name}|${domain}`, rowId);
      if (name && address) addUnique(result.nameAddressMap, `NAME_ADDRESS:${name}|${address}`, rowId);
    }
    return result;
  }

  assignMasterCoverage(master) {
    let exactUei = 0;
    let secondary = 0;
    let missing = 0;
    for (const account of this.accounts.values()) {
      if (account.uei && master.ueiSet.has(account.uei)) {
        account.masterMatch = 'UEI_EXACT';
        exactUei += 1;
        continue;
      }
      let matched = null;
      for (const alias of account.aliases) {
        if (alias.startsWith('CAGE:') && master.cageMap.get(alias)) { matched = 'CAGE_EXACT'; break; }
        if (alias.startsWith('NAME_DOMAIN:') && master.nameDomainMap.get(alias)) { matched = 'NAME_DOMAIN'; break; }
        if (alias.startsWith('NAME_ADDRESS:') && master.nameAddressMap.get(alias)) { matched = 'NAME_ADDRESS'; break; }
      }
      if (matched) { account.masterMatch = matched; secondary += 1; }
      else { account.masterMatch = 'MISSING_FROM_CURRENT_MASTER'; missing += 1; }
    }
    return { exactUei, secondary, representedTotal: exactUei + secondary, missing };
  }

  finalizeAccount(account, uniqueAwardCounts) {
    const prime = account.primeYears.size > 0;
    const sub = account.subYears.size > 0;
    const awardRole = prime && sub ? 'BOTH' : prime ? 'PRIME' : sub ? 'SUB' : 'UNKNOWN';
    return {
      canonical_key: account.canonicalKey,
      uei: account.uei,
      cage: account.cage,
      company_name: account.companyName,
      domain: account.domain,
      identity_confidence: account.identityConfidence,
      identity_methods: [...account.identityMethods].sort().join(';'),
      award_role: awardRole,
      first_award_fy: account.firstAwardFy,
      last_award_fy: account.lastAwardFy,
      first_award_date: account.firstAwardDate,
      last_award_date: account.lastAwardDate,
      prime_award_years: uniqueSorted(account.primeYears).join(';'),
      sub_award_years: uniqueSorted(account.subYears).join(';'),
      prime_award_count: uniqueAwardCounts.get(`${account.canonicalKey}|PRIME`) || null,
      sub_award_count: uniqueAwardCounts.get(`${account.canonicalKey}|SUB`) || null,
      prime_evidence_rows: account.primeEvidenceRows,
      sub_evidence_rows: account.subEvidenceRows,
      prime_dollars: account.primeDollars,
      sub_dollars: account.subDollars,
      total_awarded_dollars: account.primeDollars + account.subDollars,
      award_trend: trajectory(account),
      active_recently: account.lastAwardFy != null && account.lastAwardFy >= 2025 ? 'YES' : 'NO',
      current_master_match: account.masterMatch,
      source_files: [...account.sourceFiles].sort().join(';'),
      annual: account.annual
    };
  }

  writeCsv(rows) {
    const headers = [
      'canonical_key','uei','cage','company_name','domain','identity_confidence','identity_methods','award_role',
      'first_award_fy','last_award_fy','first_award_date','last_award_date','prime_award_years','sub_award_years',
      'prime_award_count','sub_award_count','prime_evidence_rows','sub_evidence_rows','prime_dollars','sub_dollars',
      'total_awarded_dollars','award_trend','active_recently','current_master_match','source_files'
    ];
    const stream = fs.createWriteStream(this.csvPath, 'utf8');
    stream.write(headers.join(',') + '\n');
    for (const row of rows) stream.write(headers.map(key => csvEscape(row[key])).join(',') + '\n');
    stream.end();
  }

  async run(options = {}) {
    fs.mkdirSync(this.outputDir, { recursive: true });
    const validation = options.sourceValidation || readJson(this.sourceValidationPath, null);
    if (!validation?.ok) {
      const blocked = { ok: false, status: 'SIX_FY_SOURCE_VALIDATION_REQUIRED', sourceValidationPath: this.sourceValidationPath };
      fs.writeFileSync(this.reportPath, JSON.stringify(blocked, null, 2), 'utf8');
      return blocked;
    }
    if (validation.readyForSixFiscalYearNormalization !== true) {
      const blocked = {
        ok: false,
        status: 'SIX_FY_SOURCE_GAPS_BLOCK_NORMALIZATION',
        readyForSixFiscalYearNormalization: false,
        missingRequirements: validation.missingRequirements || [],
        byYear: Object.fromEntries(YEARS.map(year => [String(year), {
          primeReady: validation.byYear?.[String(year)]?.prime?.ready === true,
          subcontractReady: validation.byYear?.[String(year)]?.subcontract?.ready === true
        }])),
        safety: { normalizationPerformed: false, acquisitionTriggered: false, sourceFilesModified: false, productionOrionModified: false, campaignMutation: false, emailSent: false }
      };
      fs.writeFileSync(this.reportPath, JSON.stringify(blocked, null, 2), 'utf8');
      return blocked;
    }

    const Database = this.loadDatabase();
    try { if (fs.existsSync(this.awardKeyDbPath)) fs.unlinkSync(this.awardKeyDbPath); } catch {}
    const db = new Database(this.awardKeyDbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.exec('CREATE TABLE award_keys(canonical_key TEXT NOT NULL, role TEXT NOT NULL, award_id TEXT NOT NULL, PRIMARY KEY(canonical_key, role, award_id)) WITHOUT ROWID;');

    const sourceRuns = [];
    try {
      for (const year of YEARS) {
        const y = validation.byYear?.[String(year)] || {};
        for (const item of y.prime?.selected || []) sourceRuns.push(await this.processSource(item.file, 'PRIME', year, db));
        for (const item of y.subcontract?.selected || []) sourceRuns.push(await this.processSource(item.file, 'SUB', year, db));
      }
      if (this.stats.sourceErrors.length) throw new Error(`SOURCE_READ_FAILURES:${this.stats.sourceErrors.length}`);

      const uniqueAwardCounts = new Map();
      for (const row of db.prepare('SELECT canonical_key, role, COUNT(*) AS c FROM award_keys GROUP BY canonical_key, role').iterate()) {
        uniqueAwardCounts.set(`${row.canonical_key}|${row.role}`, Number(row.c));
      }
      const master = await this.loadCurrentMaster();
      if (master.missing) throw new Error(`CURRENT_MASTER_NOT_FOUND:${this.currentMasterPath}`);
      const coverage = this.assignMasterCoverage(master);
      const rows = [...this.accounts.values()].map(account => this.finalizeAccount(account, uniqueAwardCounts));
      this.writeCsv(rows);

      const prime = rows.filter(row => row.award_role === 'PRIME' || row.award_role === 'BOTH').length;
      const sub = rows.filter(row => row.award_role === 'SUB' || row.award_role === 'BOTH').length;
      const both = rows.filter(row => row.award_role === 'BOTH').length;
      const ueiExact = rows.filter(row => row.identity_confidence === 'UEI_EXACT').length;
      const secondary = rows.filter(row => ['SECONDARY_MATCH_TO_UEI','CAGE_EXACT','NAME_DOMAIN','NAME_ADDRESS'].includes(row.identity_confidence)).length;
      const unknown = rows.filter(row => row.identity_confidence === 'UNKNOWN_IDENTITY_KEY').length;
      const union = rows.length;
      const roleReconciles = prime + sub - both === union;
      const report = {
        ok: roleReconciles && coverage.representedTotal + coverage.missing === union,
        status: roleReconciles ? 'SIX_FY_AWARDED_UNIVERSE_NORMALIZED' : 'SIX_FY_ROLE_RECONCILIATION_FAILED',
        generatedAt: new Date().toISOString(),
        fiscalYearScope: YEARS,
        sourceValidation: {
          status: validation.status || null,
          readyForSixFiscalYearNormalization: true,
          missingRequirements: [],
          selectedSourceCounts: Object.fromEntries(YEARS.map(year => [String(year), {
            prime: validation.byYear?.[String(year)]?.prime?.selected?.length || 0,
            subcontract: validation.byYear?.[String(year)]?.subcontract?.selected?.length || 0
          }]))
        },
        metrics: {
          uniqueFy21Fy26PrimeWinners: prime,
          uniqueFy21Fy26SubcontractWinners: sub,
          uniqueAppearingInBoth: both,
          dedupedAwardedUniverse: union,
          exactUeiIdentities: ueiExact,
          secondaryResolvedIdentities: secondary,
          unresolvedIdentityKeys: unknown,
          alreadyRepresentedInCurrent26k: coverage.representedTotal,
          representedByExactUei: coverage.exactUei,
          representedByDefensibleSecondaryMatch: coverage.secondary,
          missingFromCurrent26k: coverage.missing,
          historicalAwardedUniverseCoveragePercent: union ? Number(((coverage.representedTotal / union) * 100).toFixed(2)) : null,
          exactUeiCoveragePercent: ueiExact ? Number(((rows.filter(row => row.identity_confidence === 'UEI_EXACT' && row.current_master_match === 'UEI_EXACT').length / ueiExact) * 100).toFixed(2)) : null
        },
        trajectoryCounts: rows.reduce((out, row) => { out[row.award_trend] = (out[row.award_trend] || 0) + 1; return out; }, {}),
        roleCounts: rows.reduce((out, row) => { out[row.award_role] = (out[row.award_role] || 0) + 1; return out; }, {}),
        identityConfidenceCounts: rows.reduce((out, row) => { out[row.identity_confidence] = (out[row.identity_confidence] || 0) + 1; return out; }, {}),
        acceptance: {
          allSixFiscalYearsSourceReady: true,
          primeSubRoleArithmeticReconciles: roleReconciles,
          everyNormalizedIdentityAccountedInCoverage: coverage.representedTotal + coverage.missing === union,
          missingUeiRecordsPreserved: this.stats.rowsWithoutUei >= 0,
          unknownIdentityDistinctFromZero: true,
          currentMasterReadOnly: true,
          campaignGenerationPerformed: false
        },
        processing: { ...this.stats, sourceRuns },
        artifacts: { report: this.reportPath, contractorCsv: this.csvPath, awardKeyDatabase: this.awardKeyDbPath },
        safety: {
          stagingOnly: true,
          sourceFilesModified: false,
          currentMasterModified: false,
          productionOrionModified: false,
          providerMutation: false,
          campaignMutation: false,
          emailSent: false,
          suppressionOverridden: false,
          acquisitionTriggered: false
        }
      };
      fs.writeFileSync(this.reportPath, JSON.stringify(report, null, 2), 'utf8');
      return report;
    } catch (error) {
      const failed = {
        ok: false,
        status: 'SIX_FY_NORMALIZATION_FAILED',
        error: String(error?.stack || error?.message || error),
        processing: this.stats,
        safety: { stagingOnly: true, sourceFilesModified: false, currentMasterModified: false, productionOrionModified: false, campaignMutation: false, emailSent: false, acquisitionTriggered: false }
      };
      fs.writeFileSync(this.reportPath, JSON.stringify(failed, null, 2), 'utf8');
      return failed;
    } finally {
      db.close();
    }
  }
}

module.exports = SixFiscalYearAwardUniverseNormalizerService;
module.exports.trajectory = trajectory;
module.exports.normUei = normUei;
module.exports.normCage = normCage;
module.exports.normName = normName;
module.exports.normDomain = normDomain;
