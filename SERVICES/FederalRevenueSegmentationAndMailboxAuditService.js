'use strict';

/*
  MILES Enterprise
  P1.5K — Federal Revenue Segmentation + Outbound Mailbox Audit
  READ ONLY. No Instantly, Google Workspace, DNS, campaign, or lead mutations.

  Goals:
  1) Audit the canonical four-tier federal revenue segmentation across:
     GSA, VA/FSS, SDVOSB, VOSB, WOSB, HUBZONE, 8A, SBS/SAM.
  2) Audit live Instantly sender inventory against six outreach domains,
     target five senders/domain, while excluding pathways2gc.com.
*/

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const instantlyConnector = require('../CONNECTORS/INSTANTLY/connector');

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, 'DATA', 'OUTBOUND', 'INSTANTLY_MASTER_RECONCILIATION', 'FEDERAL_REVENUE_SEGMENTATION_AND_MAILBOX_AUDIT_LATEST.json');

const TARGET_DOMAINS = [
  'pathways2gc.co',
  'pathwaysfederal.com',
  'pathwaysgov.com',
  'pathwaysgovcon.com',
  'pathwaysgsa.com',
  'pathwaystogc.com'
];
const PROTECTED_PRIMARY_DOMAIN = 'pathways2gc.com';
const TARGET_MAILBOXES_PER_DOMAIN = 5;

const FAMILIES = [
  'GSA', 'VA_FSS', 'SDVOSB', 'VOSB', 'WOSB', 'HUBZONE', '8A', 'SBS_SAM'
];
const TIERS = ['NO_SALES', 'ONE_TO_LT_3M', 'THREE_TO_LT_10M', 'TEN_M_PLUS', 'UNKNOWN'];

function norm(v) { return String(v == null ? '' : v).trim(); }
function lower(v) { return norm(v).toLowerCase(); }
function asArray(v) { return Array.isArray(v) ? v : []; }

function parseMoney(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/[$,]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function tierForRevenue(v) {
  const n = parseMoney(v);
  if (n == null || n < 0) return 'UNKNOWN';
  if (n === 0) return 'NO_SALES';
  if (n < 3000000) return 'ONE_TO_LT_3M';
  if (n < 10000000) return 'THREE_TO_LT_10M';
  return 'TEN_M_PLUS';
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((h, i) => norm(h) || `col_${i}`);
  return rows.slice(1).filter(r => r.some(x => norm(x))).map(r => {
    const o = {};
    headers.forEach((h, i) => { if (!(h in o)) o[h] = r[i] == null ? '' : r[i]; });
    return o;
  });
}

function flattenJsonRecords(value, out = []) {
  if (Array.isArray(value)) {
    for (const v of value) {
      if (v && typeof v === 'object' && !Array.isArray(v)) out.push(v);
      else flattenJsonRecords(v, out);
    }
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  for (const [k, v] of Object.entries(value)) {
    if (Array.isArray(v) && v.length && v.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
      for (const x of v) out.push(x);
    } else if (v && typeof v === 'object') flattenJsonRecords(v, out);
  }
  return out;
}

function walk(dir, depth = 0, out = []) {
  if (depth > 6 || !fs.existsSync(dir)) return out;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of ents) {
    if (['node_modules', '.git', 'ARCHIVE', 'BACKUPS', 'recovery'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, depth + 1, out);
    else if (/\.(csv|json|jsonl)$/i.test(e.name)) {
      const n = e.name.toLowerCase();
      if (/(master|segment|contractor|award|federal|gsa|va|fss|sdvosb|vosb|wosb|hub|8a|sbs|sam|lead|verified)/i.test(n)) out.push(p);
    }
  }
  return out;
}

function fieldMap(row) {
  const m = {};
  for (const [k, v] of Object.entries(row || {})) m[lower(k).replace(/[^a-z0-9]/g, '')] = v;
  return m;
}
function firstField(m, names) {
  for (const n of names) {
    const k = n.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (Object.prototype.hasOwnProperty.call(m, k) && norm(m[k]) !== '') return m[k];
  }
  return null;
}
function truthy(v) {
  const s = lower(v);
  return ['1','true','yes','y','active','x','certified','current'].includes(s) || (typeof v === 'number' && v > 0);
}

function revenueFromRow(row) {
  const m = fieldMap(row);
  const v = firstField(m, [
    'federal_revenue','federal_sales','federal_award_revenue','award_revenue','total_federal_revenue',
    'federal_obligated_amount','total_obligated_amount','total_award_amount','award_amount','contract_value',
    'prime_award_revenue','prime_revenue','usaspending_revenue','sales'
  ]);
  return parseMoney(v);
}

function textBlob(row) {
  return Object.values(row || {}).map(v => Array.isArray(v) ? v.join('|') : String(v == null ? '' : v)).join(' | ').toUpperCase();
}

function familiesFromRow(row, fileName) {
  const m = fieldMap(row);
  const blob = `${textBlob(row)} | ${String(fileName || '').toUpperCase()}`;
  const found = new Set();

  const vehicle = String(firstField(m, ['vehicle','contract_vehicle','vehicle_type','schedule','segment','segments','primary_segment','source_segments']) || '').toUpperCase();
  const certs = String(firstField(m, ['certifications','certification','business_types','socioeconomic','socioeconomic_status']) || '').toUpperCase();

  if (/\bGSA\b|MAS|MULTIPLE AWARD SCHEDULE/.test(`${vehicle} ${blob}`)) found.add('GSA');
  if (/\bVA\b|\bFSS\b|VETERANS AFFAIRS|FEDERAL SUPPLY SCHEDULE/.test(`${vehicle} ${blob}`)) found.add('VA_FSS');

  const checks = [
    ['SDVOSB', /SDVOSB|SERVICE[- ]DISABLED VETERAN/],
    ['VOSB', /(^|[^D])VOSB|VETERAN[- ]OWNED/],
    ['WOSB', /WOSB|WOMEN[- ]OWNED/],
    ['HUBZONE', /HUB ?ZONE/],
    ['8A', /\b8\(?A\)?\b|8A FIRM|8\(A\)/]
  ];
  for (const [name, re] of checks) if (re.test(`${certs} ${blob}`)) found.add(name);

  if (/\bSBS\b|\bSAM\b|SAM\.GOV|SMALL BUSINESS/.test(blob)) found.add('SBS_SAM');

  const direct = [
    ['GSA', ['gsa','gsa_holder','has_gsa']],
    ['VA_FSS', ['va_fss','fss','va_schedule','has_va_fss']],
    ['SDVOSB', ['sdvosb']], ['VOSB', ['vosb']], ['WOSB', ['wosb']],
    ['HUBZONE', ['hubzone']], ['8A', ['8a','eight_a']], ['SBS_SAM', ['sbs','sam_active','sam_registered']]
  ];
  for (const [name, keys] of direct) {
    for (const k of keys) {
      const v = firstField(m, [k]);
      if (v != null && truthy(v)) found.add(name);
    }
  }
  return [...found];
}

function identityKey(row) {
  const m = fieldMap(row);
  const uei = lower(firstField(m, ['uei','unique_entity_id','uei_sam']));
  if (uei) return `UEI:${uei}`;
  const email = lower(firstField(m, ['email','email_address','contact_email','verified_email']));
  if (email && email.includes('@')) return `EMAIL:${email}`;
  const company = lower(firstField(m, ['legal_name','company','company_name','business_name','entity_name']));
  const state = lower(firstField(m, ['state','physical_state','address_state']));
  if (company) return `NAME:${company}|${state}`;
  return null;
}

function loadCandidateRecords() {
  const roots = [
    path.join(ROOT, 'DATA'),
    path.join(ROOT, 'GOOD_FILES'),
    path.join(ROOT, 'DATASETS')
  ].filter(fs.existsSync);
  const files = [...new Set(roots.flatMap(r => walk(r)))];
  const records = [];
  const sourceStats = [];

  for (const file of files) {
    let rows = [];
    try {
      const stat = fs.statSync(file);
      if (stat.size > 350 * 1024 * 1024) continue;
      if (/\.csv$/i.test(file)) rows = parseCsv(fs.readFileSync(file, 'utf8'));
      else if (/\.jsonl$/i.test(file)) rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap(line => { try { const j = JSON.parse(line); return j && typeof j === 'object' ? [j] : []; } catch (_) { return []; } });
      else {
        const j = JSON.parse(fs.readFileSync(file, 'utf8'));
        rows = Array.isArray(j) ? j : flattenJsonRecords(j);
      }
    } catch (_) { continue; }

    let relevant = 0;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const families = familiesFromRow(row, path.basename(file));
      if (!families.length) continue;
      const key = identityKey(row);
      if (!key) continue;
      relevant++;
      records.push({ key, families, revenue: revenueFromRow(row), sourceFile: file, row });
    }
    if (relevant) sourceStats.push({ file, recordsUsed: relevant });
  }
  return { records, sourceStats };
}

function consolidate(records) {
  const byKey = new Map();
  for (const r of records) {
    if (!byKey.has(r.key)) byKey.set(r.key, { key:r.key, families:new Set(), revenueValues:[], sources:new Set() });
    const x = byKey.get(r.key);
    r.families.forEach(f => x.families.add(f));
    if (r.revenue != null) x.revenueValues.push(r.revenue);
    x.sources.add(r.sourceFile);
  }

  const cells = {};
  for (const f of FAMILIES) cells[f] = Object.fromEntries(TIERS.map(t => [t, 0]));
  const unknownRevenue = [];
  const conflicts = [];

  for (const x of byKey.values()) {
    const uniqueRevenue = [...new Set(x.revenueValues.map(Number))];
    let revenue = null;
    if (uniqueRevenue.length) revenue = Math.max(...uniqueRevenue);
    if (uniqueRevenue.length > 1) conflicts.push({ identity:x.key, revenueValues:uniqueRevenue, sources:[...x.sources] });
    const tier = tierForRevenue(revenue);
    for (const f of x.families) if (cells[f]) cells[f][tier]++;
    if (tier === 'UNKNOWN') unknownRevenue.push({ identity:x.key, families:[...x.families], sources:[...x.sources] });
  }

  return { uniqueCompanies: byKey.size, cells, unknownRevenue, conflictingRevenueEvidence: conflicts };
}

function extractAccounts(resp) {
  const candidates = [resp, resp?.accounts, resp?.result, resp?.result?.accounts, resp?.items, resp?.data];
  for (const c of candidates) if (Array.isArray(c)) return c;
  return [];
}

async function readInstantlyAccounts() {
  const attempts = ['accountInventory','listAccounts','getAccountInventory','accounts'];
  const errors = [];
  for (const action of attempts) {
    try {
      const r = await instantlyConnector.execute({ action, payload: { limit: 1000 } });
      const accounts = extractAccounts(r);
      if (accounts.length || r) return { actionUsed: action, accounts, rawShapeObserved: true, errors };
    } catch (e) { errors.push({ action, error: e.message }); }
  }
  return { actionUsed: null, accounts: [], rawShapeObserved: false, errors };
}

function emailOfAccount(a) {
  return lower(a?.email || a?.email_address || a?.account || a?.from_email || a?.address || a?.eaccount);
}
function accountStatus(a) {
  return norm(a?.status || a?.status_label || a?.account_status || a?.state || 'UNKNOWN');
}
function usableAccount(a) {
  const e = emailOfAccount(a);
  if (!e.includes('@')) return false;
  const s = lower(accountStatus(a));
  if (/(disabled|error|failed|disconnected|pending|inactive)/.test(s)) return false;
  return true;
}

function mailboxAudit(accounts) {
  const byDomain = {};
  for (const d of TARGET_DOMAINS) byDomain[d] = { target: TARGET_MAILBOXES_PER_DOMAIN, all: [], usable: [] };
  const protectedPrimaryObserved = [];
  const otherDomains = {};

  for (const a of accounts) {
    const email = emailOfAccount(a);
    if (!email.includes('@')) continue;
    const domain = email.split('@').pop();
    const summary = { email, status: accountStatus(a), usable: usableAccount(a) };
    if (domain === PROTECTED_PRIMARY_DOMAIN) protectedPrimaryObserved.push(summary);
    else if (byDomain[domain]) {
      byDomain[domain].all.push(summary);
      if (summary.usable) byDomain[domain].usable.push(summary);
    } else {
      otherDomains[domain] = otherDomains[domain] || [];
      otherDomains[domain].push(summary);
    }
  }

  const domains = TARGET_DOMAINS.map(domain => {
    const x = byDomain[domain];
    const emails = [...new Set(x.usable.map(v => v.email))];
    return {
      domain,
      targetMailboxes: TARGET_MAILBOXES_PER_DOMAIN,
      observedAccounts: x.all.length,
      usableMailboxes: emails.length,
      missingToTarget: Math.max(0, TARGET_MAILBOXES_PER_DOMAIN - emails.length),
      excessOverTarget: Math.max(0, emails.length - TARGET_MAILBOXES_PER_DOMAIN),
      usableEmails: emails,
      nonUsableObserved: x.all.filter(v => !v.usable)
    };
  });

  const totalUsableTargetDomains = domains.reduce((n,d) => n + d.usableMailboxes, 0);
  const totalMissing = domains.reduce((n,d) => n + d.missingToTarget, 0);
  return {
    protectedPrimaryDomain: PROTECTED_PRIMARY_DOMAIN,
    protectedPrimaryDomainObservedInInstantly: protectedPrimaryObserved,
    targetDomains: domains,
    otherDomains,
    totals: {
      targetDomains: TARGET_DOMAINS.length,
      targetMailboxes: TARGET_DOMAINS.length * TARGET_MAILBOXES_PER_DOMAIN,
      usableTargetDomainMailboxes: totalUsableTargetDomains,
      missingMailboxes: totalMissing,
      capacityAt25PerMailboxIfTargetMet: TARGET_DOMAINS.length * TARGET_MAILBOXES_PER_DOMAIN * 25,
      currentCapacityAt25PerUsableMailbox: totalUsableTargetDomains * 25
    },
    mailboxCreationNeeded: domains.flatMap(d => Array.from({length:d.missingToTarget}, (_,i) => ({ domain:d.domain, slot:i+1, action:'CREATE_OR_CONNECT_ONE_GOOGLE_WORKSPACE_SENDER' })))
  };
}

async function run() {
  const source = loadCandidateRecords();
  const federal = consolidate(source.records);
  const instantly = await readInstantlyAccounts();
  const mailboxes = mailboxAudit(instantly.accounts);

  const result = {
    ok: true,
    gate: 'P1.5K_FEDERAL_REVENUE_SEGMENTATION_AND_MAILBOX_AUDIT',
    version: '1.0-read-only',
    generatedAt: new Date().toISOString(),
    revenueTierPolicy: {
      NO_SALES: '$0',
      ONE_TO_LT_3M: '$1 to <$3,000,000',
      THREE_TO_LT_10M: '$3,000,000 to <$10,000,000',
      TEN_M_PLUS: '$10,000,000+',
      UNKNOWN: 'No trustworthy federal revenue value found'
    },
    federalSegmentation: {
      families: FAMILIES,
      sourceFilesUsed: source.sourceStats,
      candidateRowsUsed: source.records.length,
      uniqueCompaniesObserved: federal.uniqueCompanies,
      cells: federal.cells,
      unknownRevenueCount: federal.unknownRevenue.length,
      unknownRevenueExamples: federal.unknownRevenue.slice(0, 100),
      conflictingRevenueEvidenceCount: federal.conflictingRevenueEvidence.length,
      conflictingRevenueEvidenceExamples: federal.conflictingRevenueEvidence.slice(0, 100),
      authoritativeEnoughToMutateCampaigns: federal.uniqueCompanies > 0 && federal.unknownRevenue.length === 0 && federal.conflictingRevenueEvidence.length === 0,
      note: 'Certification/vehicle families may overlap in intelligence. Outbound campaign assignment must remain one-primary-route-per-contact.'
    },
    instantlyMailboxInventory: {
      actionUsed: instantly.actionUsed,
      readErrors: instantly.errors,
      accountsObserved: instantly.accounts.length,
      ...mailboxes
    },
    decisions: {
      federalSegmentationNext: federal.uniqueCompanies === 0
        ? 'AUTHORITATIVE_FEDERAL_REVENUE_SOURCE_NOT_FOUND_BY_AUDIT'
        : (federal.unknownRevenue.length || federal.conflictingRevenueEvidence.length)
          ? 'RECONCILE_UNKNOWN_OR_CONFLICTING_REVENUE_BEFORE_CAMPAIGN_RESEGMENTATION'
          : 'READY_TO_BUILD_CANONICAL_FOUR_TIER_SEGMENT_MASTER',
      mailboxNext: mailboxes.totals.missingMailboxes > 0
        ? 'CREATE_OR_CONNECT_ONLY_MISSING_GOOGLE_WORKSPACE_MAILBOXES_THEN_WARM_AND_VERIFY'
        : 'TARGET_30_MAILBOX_CONFIGURATION_PRESENT'
    },
    safety: {
      readOnly: true,
      createGoogleWorkspaceUsers: false,
      changeDns: false,
      connectInstantlyAccounts: false,
      mutateCampaigns: false,
      moveLeads: false,
      uploadLeads: false,
      activateCampaigns: false,
      sendEmails: false,
      protectedPrimaryDomainExcludedFromOutboundTarget: true
    }
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  result.outputFile = OUTPUT;
  fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2));
  return result;
}

module.exports = { run, tierForRevenue, familiesFromRow, parseCsv };
