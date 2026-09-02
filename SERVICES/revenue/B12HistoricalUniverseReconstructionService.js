'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const csv = require('csv-parser');

const EMAIL_ALIASES = ['email','emailaddress','email_address','contactemail','contact_email','workemail','work_email','recipientemail','recipient_email'];
const COMPANY_ALIASES = ['company','companyname','company_name','organization','organizationname','organization_name','businessname','business_name','legalbusinessname','legal_business_name','legalname','legal_name'];
const FIRST_ALIASES = ['firstname','first_name','contactfirstname','contact_first_name','givenname','given_name'];
const LAST_ALIASES = ['lastname','last_name','contactlastname','contact_last_name','surname','familyname','family_name'];
const FULLNAME_ALIASES = ['fullname','full_name','contact','contactname','contact_name','name'];
const UEI_ALIASES = ['uei','uniqueentityid','unique_entity_id','recipientuei','recipient_uei'];
const CAGE_ALIASES = ['cage','cagecode','cage_code'];
const DOMAIN_ALIASES = ['domain','companydomain','company_domain'];
const WEBSITE_ALIASES = ['website','websiteurl','website_url','url','companywebsite','company_website'];
const STATE_ALIASES = ['state','statecode','state_code','company_state','businessstate','business_state'];
const PHONE_ALIASES = ['phone','phonenumber','phone_number','contactphone','contact_phone'];
const CAMPAIGN_ALIASES = ['campaign','campaignname','campaign_name','segment','segmentname','segment_name','list','listname','list_name'];
const SEND_DATE_ALIASES = ['senddate','send_date','sentdate','sent_date','createdat','created_at','date','timestamp'];
const STATUS_ALIASES = ['status','contactstatus','contact_status','leadstatus','lead_status','deliverystatus','delivery_status'];
const MAX_JSON_BYTES = 250 * 1024 * 1024;
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','msn.com',
  'yahoo.com','ymail.com','aol.com','icloud.com','me.com','mac.com','proton.me',
  'protonmail.com','gmx.com','gmx.net','mail.com','zoho.com'
]);

function clean(value) { return value == null ? '' : String(value).trim(); }
function normalizedHeader(value) { return clean(value).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function normalizeCompany(value) { return clean(value).toLowerCase().replace(/\b(incorporated|inc|llc|ltd|limited|corp|corporation|co|company)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '); }
function normalizeState(value) { return clean(value).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2); }
function normalizeId(value) { return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function normalizeEmail(value) { return clean(value).toLowerCase(); }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value)); }
function normalizeDomain(value) {
  let text = clean(value).toLowerCase();
  if (!text) return '';
  text = text.replace(/^mailto:/, '').replace(/^https?:\/\//, '').replace(/^www\./, '');
  text = text.split('/')[0].split('?')[0].split('#')[0].split(':')[0];
  if (text.includes('@')) text = text.split('@').pop();
  return text.replace(/[^a-z0-9.-]/g, '').replace(/^\.+|\.+$/g, '');
}
function domainFromEmail(email) { const value = normalizeEmail(email); return validEmail(value) ? value.split('@').pop() : ''; }
function isBusinessDomain(value) { const domain = normalizeDomain(value); return Boolean(domain && domain.includes('.') && !FREE_EMAIL_DOMAINS.has(domain)); }
function extractEmail(value) {
  const text = clean(value);
  if (!text) return '';
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? normalizeEmail(match[0]) : normalizeEmail(text);
}
function csvEscape(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function sha(value) { return crypto.createHash('sha256').update(String(value)).digest('hex').toUpperCase(); }
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; } }
function headerMap(row = {}) {
  const map = new Map();
  for (const [key, value] of Object.entries(row || {})) {
    const normalized = normalizedHeader(key);
    if (normalized && !map.has(normalized)) map.set(normalized, value);
  }
  return map;
}
function valueByAliases(row, aliases) {
  const map = headerMap(row);
  for (const alias of aliases) {
    const value = map.get(normalizedHeader(alias));
    if (value !== undefined && value !== null && clean(value) !== '') return value;
  }
  return '';
}
function rowToRecord(row = {}) {
  const rawEmail = clean(valueByAliases(row, EMAIL_ALIASES));
  const email = extractEmail(rawEmail);
  const company = clean(valueByAliases(row, COMPANY_ALIASES));
  const firstName = clean(valueByAliases(row, FIRST_ALIASES));
  const lastName = clean(valueByAliases(row, LAST_ALIASES));
  const fullName = clean(valueByAliases(row, FULLNAME_ALIASES)) || [firstName, lastName].filter(Boolean).join(' ');
  const uei = normalizeId(valueByAliases(row, UEI_ALIASES));
  const cage = normalizeId(valueByAliases(row, CAGE_ALIASES));
  const website = clean(valueByAliases(row, WEBSITE_ALIASES));
  const explicitDomain = normalizeDomain(valueByAliases(row, DOMAIN_ALIASES)) || normalizeDomain(website);
  const domain = explicitDomain || domainFromEmail(email);
  const state = normalizeState(valueByAliases(row, STATE_ALIASES));
  const phone = clean(valueByAliases(row, PHONE_ALIASES));
  const campaign = clean(valueByAliases(row, CAMPAIGN_ALIASES));
  const sendDate = clean(valueByAliases(row, SEND_DATE_ALIASES));
  const sourceStatus = clean(valueByAliases(row, STATUS_ALIASES));
  const companyNorm = normalizeCompany(company);
  return { rawEmail, email, emailValid: validEmail(email), company, companyNorm, firstName, lastName, fullName, uei, cage, website, domain, domainBusinessIdentityEligible: isBusinessDomain(domain), state, phone, campaign, sendDate, sourceStatus };
}
function companyIdentityKeys(record = {}) {
  const keys = [];
  if (record.uei) keys.push(`UEI:${record.uei}`);
  if (record.cage) keys.push(`CAGE:${record.cage}`);
  if (record.domain && isBusinessDomain(record.domain)) keys.push(`DOMAIN:${record.domain}`);
  if (record.companyNorm && record.state) keys.push(`NAME_STATE:${record.companyNorm}|${record.state}`);
  return keys;
}
function canonicalContactKey(record = {}, sourceFile = '', rowNumber = 0) {
  if (record.emailValid) return `EMAIL:${record.email}`;
  if (record.uei && record.fullName) return `UEI_NAME:${record.uei}|${normalizeCompany(record.fullName)}`;
  if (record.domain && isBusinessDomain(record.domain) && record.fullName) return `DOMAIN_NAME:${record.domain}|${normalizeCompany(record.fullName)}`;
  if (record.uei) return `UEI:${record.uei}`;
  if (record.domain && isBusinessDomain(record.domain) && record.companyNorm) return `DOMAIN_COMPANY:${record.domain}|${record.companyNorm}`;
  return `ROW:${sha(`${sourceFile}|${rowNumber}|${JSON.stringify(record)}`)}`;
}
function suppressionDisposition(entry) {
  if (!entry) return null;
  const reason = `${entry.reason || ''} ${entry.category || ''}`.toUpperCase();
  if (/HARD[_ -]?BOUNCE|BOUNCE/.test(reason)) return 'HARD_BOUNCE';
  if (/UNSUB|DO[_ -]?NOT[_ -]?CONTACT|DNC/.test(reason)) return 'UNSUBSCRIBED';
  return 'SUPPRESSED_FOR_VALID_REASON';
}
function dispositionFor(record, master, suppressionEntry) {
  const suppressed = suppressionDisposition(suppressionEntry);
  if (suppressed) return { disposition: suppressed, evidence: `GLOBAL_SUPPRESSION:${clean(suppressionEntry.reason || suppressionEntry.category)}` };
  if (record.rawEmail && !record.emailValid) return { disposition: 'INVALID_EMAIL', evidence: 'HISTORICAL_EMAIL_SYNTAX_INVALID' };
  if (record.emailValid && master.emails.has(record.email)) return { disposition: 'CURRENT_MASTER', evidence: 'EXACT_EMAIL_MATCH_CURRENT_MASTER' };
  const companyKeys = companyIdentityKeys(record);
  const companyMatchKey = companyKeys.find(key => master.companyKeys.has(key));
  if (companyMatchKey) {
    if (!record.emailValid || !master.emails.has(record.email)) return { disposition: 'COMPANY_STILL_VALID_NEW_CONTACT_NEEDED', evidence: `CURRENT_MASTER_COMPANY_MATCH:${companyMatchKey}` };
  }
  if (!record.emailValid && (record.uei || record.cage || (record.domain && isBusinessDomain(record.domain)) || record.companyNorm)) return { disposition: 'NEEDS_RE_ENRICHMENT', evidence: 'COMPANY_EVIDENCE_PRESENT_WITHOUT_VALID_EMAIL' };
  return { disposition: 'UNKNOWN_INVESTIGATE', evidence: 'NO_GOVERNED_REASON_YET_PROVES_REMOVAL_OR_CURRENT_MASTER_MATCH' };
}
function extractJsonRows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['items','data','records','contacts','leads','prospects','recipients','results']) {
    if (Array.isArray(value[key])) return value[key];
  }
  const values = Object.values(value);
  if (values.length && values.every(item => item && typeof item === 'object' && !Array.isArray(item))) return values;
  return [];
}

class B12HistoricalUniverseReconstructionService {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || process.cwd());
    this.discoveryPath = path.resolve(options.discoveryPath || path.join(this.rootDir, 'DATA', 'revenue', 'b12_reconciliation', 'discovery', 'latest_b12_historical_universe_discovery.json'));
    this.outputDir = path.resolve(options.outputDir || path.join(this.rootDir, 'DATA', 'revenue', 'b12_reconciliation', 'reconstruction'));
    this.masterCandidates = [
      options.masterPath,
      process.env.P2GC_MASTER_FILE,
      path.join(this.rootDir, 'DATA', 'OUTBOUND', 'MASTER_DEDUPED_ALL_SEGMENTS.csv'),
      path.join(this.rootDir, 'MASTER_DEDUPED_ALL_SEGMENTS.csv')
    ].filter(Boolean).map(file => path.resolve(file));
    this.suppressionPath = path.resolve(options.suppressionPath || path.join(this.rootDir, 'DATA', 'runtime', 'revenue', 'replies', 'global_suppression_master.json'));
  }

  resolveMaster() {
    return this.masterCandidates.find(file => fs.existsSync(file) && fs.statSync(file).isFile()) || null;
  }

  async loadMaster(file) {
    const master = { rows: 0, emails: new Set(), companyKeys: new Set() };
    if (!file) return master;
    await new Promise((resolve, reject) => {
      fs.createReadStream(file)
        .pipe(csv())
        .on('data', row => {
          master.rows += 1;
          const record = rowToRecord(row);
          if (record.emailValid) master.emails.add(record.email);
          for (const key of companyIdentityKeys(record)) master.companyKeys.add(key);
        })
        .on('end', resolve)
        .on('error', reject);
    });
    return master;
  }

  loadSuppressions() {
    const parsed = readJson(this.suppressionPath, { entries: [] });
    const map = new Map();
    for (const entry of Array.isArray(parsed?.entries) ? parsed.entries : []) {
      const email = normalizeEmail(entry?.email);
      if (email && entry?.active !== false) map.set(email, entry);
    }
    return map;
  }

  async forEachRow(file, extension, callback) {
    let count = 0;
    if (extension === '.csv' || extension === '.txt') {
      await new Promise((resolve, reject) => {
        fs.createReadStream(file)
          .pipe(csv())
          .on('data', row => { count += 1; callback(row, count); })
          .on('end', resolve)
          .on('error', reject);
      });
      return count;
    }
    if (extension === '.jsonl') {
      const stream = fs.createReadStream(file, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) {
        const text = line.trim();
        if (!text) continue;
        const row = JSON.parse(text);
        count += 1;
        callback(row, count);
      }
      return count;
    }
    if (extension === '.json') {
      const stat = fs.statSync(file);
      if (stat.size > MAX_JSON_BYTES) throw new Error(`JSON_SOURCE_TOO_LARGE_FOR_BOUNDED_PARSE:${stat.size}`);
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      const rows = extractJsonRows(parsed);
      if (!rows.length) throw new Error('JSON_SOURCE_HAS_NO_SUPPORTED_ROW_ARRAY');
      for (const row of rows) { count += 1; callback(row, count); }
      return count;
    }
    throw new Error(`UNSUPPORTED_PARSEABLE_EXTENSION:${extension}`);
  }

  async run() {
    const startedAt = new Date().toISOString();
    const discovery = readJson(this.discoveryPath, null);
    if (!discovery || discovery.ok !== true || discovery.status !== 'DISCOVERY_COMPLETE') {
      return { ok: false, status: 'B12_DISCOVERY_NOT_GREEN', discoveryPath: this.discoveryPath, startedAt, completedAt: new Date().toISOString() };
    }

    const masterPath = this.resolveMaster();
    const master = await this.loadMaster(masterPath);
    const suppressions = this.loadSuppressions();
    const historicalFiles = (Array.isArray(discovery.files) ? discovery.files : [])
      .filter(item => item && item.currentMaster !== true && item.parseableNow === true && fs.existsSync(item.file));

    const duplicateHashes = new Set();
    const selectedFiles = [];
    const skippedDuplicateArtifacts = [];
    for (const item of historicalFiles) {
      const hashValue = clean(item.sha256);
      if (hashValue && duplicateHashes.has(hashValue)) { skippedDuplicateArtifacts.push(item.file); continue; }
      if (hashValue) duplicateHashes.add(hashValue);
      selectedFiles.push(item);
    }

    const canonical = new Map();
    const companyKeys = new Set();
    const uniqueEmails = new Set();
    const campaigns = new Set();
    const sourceResults = [];
    const sourceErrors = [];
    const dispositionCounts = {};
    let historicalRows = 0;
    let duplicateRows = 0;

    fs.mkdirSync(this.outputDir, { recursive: true });
    const rowCsvPath = path.join(this.outputDir, 'latest_b12_historical_row_dispositions.csv');
    const rowStream = fs.createWriteStream(rowCsvPath, { encoding: 'utf8' });
    const rowColumns = ['sourceFile','rowNumber','canonicalKey','email','emailValid','company','uei','cage','domain','state','fullName','campaign','sendDate','sourceStatus','disposition','dispositionEvidence','duplicateHistoricalRow'];
    rowStream.write(`${rowColumns.map(csvEscape).join(',')}\n`);

    const processRow = (row, rowNumber, sourceFile) => {
      historicalRows += 1;
      const record = rowToRecord(row);
      const key = canonicalContactKey(record, sourceFile, rowNumber);
      const already = canonical.has(key);
      if (already) duplicateRows += 1;
      if (record.emailValid) uniqueEmails.add(record.email);
      for (const companyKey of companyIdentityKeys(record)) companyKeys.add(companyKey);
      if (record.campaign) campaigns.add(record.campaign);
      const suppressionEntry = record.emailValid ? suppressions.get(record.email) : null;
      const resolved = dispositionFor(record, master, suppressionEntry);
      const rowDisposition = already ? 'LEGITIMATE_DUPLICATE' : resolved.disposition;
      dispositionCounts[rowDisposition] = (dispositionCounts[rowDisposition] || 0) + 1;

      if (!already) {
        canonical.set(key, {
          canonicalKey: key,
          ...record,
          disposition: resolved.disposition,
          dispositionEvidence: resolved.evidence,
          sourceFiles: new Set([sourceFile]),
          campaigns: new Set(record.campaign ? [record.campaign] : []),
          historicalRowCount: 1
        });
      } else {
        const current = canonical.get(key);
        current.sourceFiles.add(sourceFile);
        if (record.campaign) current.campaigns.add(record.campaign);
        current.historicalRowCount += 1;
      }

      const rowOut = {
        sourceFile, rowNumber, canonicalKey: key, email: record.email, emailValid: record.emailValid,
        company: record.company, uei: record.uei, cage: record.cage, domain: record.domain, state: record.state,
        fullName: record.fullName, campaign: record.campaign, sendDate: record.sendDate, sourceStatus: record.sourceStatus,
        disposition: rowDisposition, dispositionEvidence: already ? `DUPLICATE_OF:${key}` : resolved.evidence,
        duplicateHistoricalRow: already
      };
      rowStream.write(`${rowColumns.map(column => csvEscape(rowOut[column])).join(',')}\n`);
    };

    for (const item of selectedFiles) {
      const sourceFile = path.resolve(item.file);
      const extension = path.extname(sourceFile).toLowerCase();
      try {
        const rows = await this.forEachRow(sourceFile, extension, (row, rowNumber) => processRow(row, rowNumber, sourceFile));
        sourceResults.push({ file: sourceFile, extension, rows, ok: true, registryReferenced: item.registryReferenced === true, discoveryReason: item.discoveryReason || null, contactHeaderEvidence: item.contactHeaderEvidence || [] });
      } catch (error) {
        const detail = { file: sourceFile, extension, ok: false, error: String(error.message || error) };
        sourceResults.push(detail);
        sourceErrors.push(detail);
      }
    }
    await new Promise(resolve => rowStream.end(resolve));

    const canonicalCsvPath = path.join(this.outputDir, 'latest_b12_historical_canonical_contacts.csv');
    const canonicalColumns = ['canonicalKey','email','emailValid','company','uei','cage','domain','state','fullName','disposition','dispositionEvidence','historicalRowCount','sourceFiles','campaigns'];
    const canonicalLines = [canonicalColumns.map(csvEscape).join(',')];
    const canonicalDispositionCounts = {};
    for (const item of canonical.values()) {
      canonicalDispositionCounts[item.disposition] = (canonicalDispositionCounts[item.disposition] || 0) + 1;
      const out = { ...item, sourceFiles: [...item.sourceFiles].join('|'), campaigns: [...item.campaigns].join('|') };
      canonicalLines.push(canonicalColumns.map(column => csvEscape(out[column])).join(','));
    }
    fs.writeFileSync(canonicalCsvPath, `${canonicalLines.join('\n')}\n`, 'utf8');

    const unresolvedCanonical = canonicalDispositionCounts.UNKNOWN_INVESTIGATE || 0;
    const result = {
      ok: sourceErrors.length === 0 && selectedFiles.length > 0,
      status: sourceErrors.length ? 'B12_RECONSTRUCTION_SOURCE_ERRORS' : selectedFiles.length ? 'B12_RECONSTRUCTION_COMPLETE_WITH_EXPLICIT_DISPOSITIONS' : 'B12_RECONSTRUCTION_NO_PARSEABLE_SOURCES',
      service: 'B12HistoricalUniverseReconstructionService',
      mode: 'STAGING_ONLY_READ_ONLY_SOURCES',
      startedAt,
      completedAt: new Date().toISOString(),
      historicalWindow: discovery.historicalWindow || null,
      sourceCoverage: {
        discoveredHistoricalCandidateFiles: discovery.inventory?.historicalCandidateFiles ?? null,
        discoveredParseableCandidateFiles: discovery.inventory?.parseableCandidateFiles ?? null,
        selectedUniqueParseableFiles: selectedFiles.length,
        skippedDuplicateArtifacts: skippedDuplicateArtifacts.length,
        skippedDuplicateArtifactFiles: skippedDuplicateArtifacts,
        sourceResults,
        sourceErrors
      },
      currentMaster: { file: masterPath, rows: master.rows, uniqueEmails: master.emails.size, companyIdentityKeys: master.companyKeys.size },
      suppressions: { file: this.suppressionPath, activeEntries: suppressions.size },
      historicalUniverse: {
        rawRows: historicalRows,
        legitimateDuplicateRows: duplicateRows,
        canonicalHistoricalContacts: canonical.size,
        uniqueValidEmails: uniqueEmails.size,
        uniqueCompanyIdentityKeys: companyKeys.size,
        campaignNamesObserved: campaigns.size,
        campaigns: [...campaigns].sort(),
        rowDispositionCounts: dispositionCounts,
        canonicalDispositionCounts,
        unresolvedCanonicalContacts: unresolvedCanonical,
        provenLostDuringMigration: canonicalDispositionCounts.LOST_DURING_MIGRATION || 0,
        excludedWithoutValidReason: canonicalDispositionCounts.EXCLUDED_WITHOUT_VALID_REASON || 0
      },
      truthRules: {
        absenceFromCurrentMasterDoesNotEqualLostDuringMigration: true,
        freeEmailDomainsNeverEstablishCompanyIdentity: true,
        unknownIsNotZero: true,
        unsupportedOrUnprovenDispositionRemainsUnknownInvestigate: true,
        noHistoricalRowsSilentlyDropped: sourceErrors.length === 0,
        duplicateSourceArtifactsNotDoubleCounted: true
      },
      nextGate: {
        investigateUnknownCanonicalContacts: unresolvedCanonical > 0,
        enrichCompaniesWithStaleOrMissingContacts: (canonicalDispositionCounts.COMPANY_STILL_VALID_NEW_CONTACT_NEEDED || 0) + (canonicalDispositionCounts.NEEDS_RE_ENRICHMENT || 0),
        quantifyRecoverableUniverseAfterLegitimateRemovals: true,
        reconstructCampaignSendReplyMeetingRevenueBaseline: true
      },
      safety: {
        historicalSourcesModified: false,
        currentMasterModified: false,
        providerMutation: false,
        campaignMutation: false,
        emailSent: false,
        suppressionOverridden: false,
        outputsStagingOnly: true
      },
      outputs: { report: path.join(this.outputDir, 'latest_b12_historical_universe_reconstruction.json'), canonicalContactsCsv: canonicalCsvPath, rowDispositionsCsv: rowCsvPath }
    };
    fs.writeFileSync(result.outputs.report, JSON.stringify(result, null, 2), 'utf8');
    return result;
  }
}

module.exports = B12HistoricalUniverseReconstructionService;
module.exports.helpers = { normalizedHeader, normalizeCompany, normalizeDomain, validEmail, isBusinessDomain, extractEmail, rowToRecord, companyIdentityKeys, canonicalContactKey, suppressionDisposition, dispositionFor, extractJsonRows };
