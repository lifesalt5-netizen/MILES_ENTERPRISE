'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const ROOT = process.env.MILES_ROOT || process.cwd();
const ROUTING_FILE = path.join(ROOT, 'DATA', 'OUTBOUND', 'GOVERNED_LEAD_REPOSITORY', 'MASTER_GOVERNED_VERIFIED_ROUTING.csv');
const OUT_DIR = path.join(ROOT, 'DATA', 'OUTBOUND', 'GOVERNED_REVENUE_PLAN');
const OUT_FILE = path.join(OUT_DIR, 'VA_LOW_SALES_DIAGNOSTIC_LATEST.json');

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
      values.push(current);
      current = '';
    } else current += ch;
  }
  values.push(current);
  return values;
}

function readCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const vals = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => row[h] = vals[i] ?? '');
    return row;
  });
}

function norm(v) { return String(v || '').trim(); }
function lower(v) { return norm(v).toLowerCase(); }
function compact(v) { return lower(v).replace(/[^a-z0-9]/g, ''); }
function emailDomain(email) { const e = lower(email); const i = e.lastIndexOf('@'); return i > -1 ? e.slice(i + 1) : ''; }

function candidateCompanyKey(row) {
  const uei = compact(row.uei);
  if (uei) return `UEI:${uei}`;
  const companyId = compact(row.company_id);
  if (companyId) return `CID:${companyId}`;
  const domain = lower(row.domain || emailDomain(row.email));
  if (domain) return `DOMAIN:${domain}`;
  const company = compact(row.company_name);
  if (company) return `NAME:${company}`;
  const email = lower(row.email);
  return email ? `EMAIL:${email}` : '';
}

function bucketFromMemberships(text) {
  const s = lower(text).replace(/[^a-z0-9]+/g, ' ');
  if (/va.*no sales|no sales.*va/.test(s)) return 'VA_NO_SALES';
  if (/va.*0 500|0 500.*va|va.*500k/.test(s)) return 'VA_0_500K';
  if (/va.*501k|va.*500k 3m|va.*1m 3m|va.*lt3m/.test(s)) return 'VA_500K_3M';
  if (/va.*3 5m|va.*3m 5m/.test(s)) return 'VA_3M_5M';
  if (/va.*5m|va.*10m|va.*plus/.test(s)) return 'VA_5M_PLUS';
  return 'UNRESOLVED';
}

function countBy(rows, selector) {
  const m = new Map();
  for (const row of rows) {
    const key = selector(row) || '(blank)';
    m.set(key, (m.get(key) || 0) + 1);
  }
  return [...m.entries()].sort((a,b) => b[1] - a[1]).map(([value,count]) => ({ value, count }));
}

function run() {
  if (!fs.existsSync(ROUTING_FILE)) throw new Error(`Missing governed routing file: ${ROUTING_FILE}`);
  const all = readCsv(ROUTING_FILE);
  const rows = all.filter(r => norm(r.assigned_segment).toUpperCase() === 'VA_LOW_SALES');

  const storedKeys = new Set(rows.map(r => norm(r.company_key)).filter(Boolean));
  const recomputedKeys = new Set(rows.map(candidateCompanyKey).filter(Boolean));
  const ueiValues = new Set(rows.map(r => compact(r.uei)).filter(Boolean));
  const companyIds = new Set(rows.map(r => compact(r.company_id)).filter(Boolean));
  const domains = new Set(rows.map(r => lower(r.domain || emailDomain(r.email))).filter(Boolean));
  const companyNames = new Set(rows.map(r => lower(r.company_name)).filter(Boolean));
  const emails = new Set(rows.map(r => lower(r.email)).filter(Boolean));

  const segmentBuckets = countBy(rows, r => bucketFromMemberships(r.all_segment_memberships));
  const suspiciousStoredKeys = countBy(rows, r => norm(r.company_key)).slice(0, 10);
  const companyIdTop = countBy(rows, r => compact(r.company_id)).slice(0, 10);
  const domainTop = countBy(rows, r => lower(r.domain || emailDomain(r.email))).slice(0, 10);

  const sample = rows.slice(0, 20).map(r => ({
    company_key: r.company_key,
    recomputed_company_key: candidateCompanyKey(r),
    uei: r.uei,
    company_id: r.company_id,
    company_name: r.company_name,
    email: r.email,
    domain: r.domain || emailDomain(r.email),
    assigned_segment: r.assigned_segment,
    all_segment_memberships: r.all_segment_memberships,
    inferred_va_bucket: bucketFromMemberships(r.all_segment_memberships)
  }));

  const result = {
    ok: true,
    gate: 'VA_LOW_SALES_GOVERNANCE_DIAGNOSTIC',
    generatedAt: new Date().toISOString(),
    readOnly: true,
    counts: {
      rows: rows.length,
      uniqueEmails: emails.size,
      storedUniqueCompanyKeys: storedKeys.size,
      recomputedUniqueCompanyKeys: recomputedKeys.size,
      uniqueUeis: ueiValues.size,
      uniqueCompanyIds: companyIds.size,
      uniqueDomains: domains.size,
      uniqueCompanyNames: companyNames.size
    },
    vaSubsegmentInference: segmentBuckets,
    topStoredCompanyKeys: suspiciousStoredKeys,
    topCompanyIds: companyIdTop,
    topDomains: domainTop,
    sample,
    diagnosis: storedKeys.size <= 2 && recomputedKeys.size > storedKeys.size
      ? 'STORED_COMPANY_KEY_COLLAPSE_DETECTED'
      : storedKeys.size <= 2 && recomputedKeys.size <= 2
        ? 'SOURCE_IDENTITY_FIELDS_COLLAPSED_OR_SINGLE_ENTITY'
        : 'NO_COMPANY_KEY_COLLAPSE_DETECTED',
    nextAction: segmentBuckets.some(x => x.value === 'UNRESOLVED' && x.count > 0)
      ? 'FIX_COMPANY_IDENTITY_THEN_RECONSTRUCT_VA_SUBSEGMENTS_FROM_AUTHORITATIVE_FIELDS'
      : 'FIX_COMPANY_IDENTITY_THEN_MAP_VA_SUBSEGMENTS_TO_EXISTING_CAMPAIGNS',
    safety: { liveCampaignsMutated: false, uploads: false, activations: false, updates: false, deletes: false }
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), 'utf8');
  result.outputFile = OUT_FILE;
  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (require.main === module) {
  try { run(); }
  catch (err) { console.error(err.stack || err.message); process.exit(1); }
}

module.exports = { run };
