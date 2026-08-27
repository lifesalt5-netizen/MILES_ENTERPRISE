'use strict';

const path = require('path');
const fs = require('fs');

const root = path.resolve(process.argv[2] || process.env.MILES_ROOT || process.cwd());
process.env.MILES_ROOT = root;
const dotenv = require(path.join(root, 'node_modules', 'dotenv'));
dotenv.config({ path: path.join(root, '.env'), override: false, quiet: true });

const instantly = require(path.join(root, 'CONNECTORS', 'INSTANTLY', 'connector.js'));

const OUTREACH_DOMAINS = [
  'pathways2gc.co',
  'pathwaysfederal.com',
  'pathwaysgov.com',
  'pathwaysgovcon.com',
  'pathwaysgsa.com',
  'pathwaystogc.com'
];
const PROTECTED_PRIMARY_DOMAIN = 'pathways2gc.com';
const GOVERNED_DAILY_LIMIT_PER_ACCOUNT = 25;
const PLACEMENT_EVIDENCE_MAX_AGE_HOURS = Number(process.env.MILES_PLACEMENT_EVIDENCE_MAX_AGE_HOURS || 24);

function deepArray(v) {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== 'object') return [];
  for (const key of ['items','data','accounts','results']) {
    const child = v[key];
    if (Array.isArray(child)) return child;
    const nested = deepArray(child);
    if (nested.length) return nested;
  }
  return [];
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function ageHours(iso) {
  const ms = Date.parse(iso || '');
  return Number.isFinite(ms) ? (Date.now() - ms) / 3600000 : null;
}

function emailOf(a) {
  return String(a?.email || a?.email_address || a?.account || a?.from_email || a?.address || a?.eaccount || '').trim().toLowerCase();
}

function statusOf(a) {
  return String(a?.status ?? a?.status_label ?? a?.account_status ?? a?.state ?? 'UNKNOWN');
}

function providerUsable(a) {
  const email = emailOf(a);
  if (!email.includes('@')) return false;
  const status = statusOf(a).toLowerCase();
  return !/(disabled|error|failed|disconnected|pending|inactive)/.test(status);
}

function loadPlacementGovernance() {
  const file = path.join(root, 'DATA', 'runtime', 'revenue', 'deliverability', 'instantly_inbox_placement_latest.json');
  const report = readJson(file);
  const reportAgeHours = ageHours(report?.generatedAt);
  const fresh = reportAgeHours !== null && reportAgeHours >= 0 && reportAgeHours <= PLACEMENT_EVIDENCE_MAX_AGE_HOURS;
  const senderMap = new Map();
  if (fresh && Array.isArray(report?.senders)) {
    for (const sender of report.senders) {
      const email = String(sender?.sender || '').trim().toLowerCase();
      if (email) senderMap.set(email, sender);
    }
  }
  return {
    file,
    exists: Boolean(report),
    generatedAt: report?.generatedAt || null,
    ageHours: reportAgeHours,
    fresh,
    scope: report?.testScope || report?.scope || null,
    verificationStatus: report?.verificationStatus || null,
    truth: report?.truth || null,
    senderMap
  };
}

async function main() {
  const response = await instantly.execute(
    { action: 'listAccounts', payload: { limit: 100 } },
    { audit: true, readOnly: true }
  );
  const accounts = deepArray(response);
  if (!accounts.length) throw new Error('INSTANTLY_ACCOUNT_INVENTORY_EMPTY_OR_UNPARSEABLE');

  const placement = loadPlacementGovernance();
  const byDomain = Object.fromEntries(OUTREACH_DOMAINS.map(domain => [domain, []]));
  const protectedAccounts = [];
  const otherDomains = {};

  for (const account of accounts) {
    const email = emailOf(account);
    if (!email.includes('@')) continue;
    const domain = email.split('@').pop();
    const providerOk = providerUsable(account);
    const placementEvidence = placement.senderMap.get(email) || null;
    const placementStatus = placementEvidence?.status || 'UNVERIFIED';
    const governedUsable = providerOk && placement.fresh && placementStatus === 'ACTIVE';
    const row = {
      email,
      status: statusOf(account),
      providerUsable: providerOk,
      placementStatus,
      placementEvidenceFresh: placement.fresh,
      governedUsable
    };
    if (domain === PROTECTED_PRIMARY_DOMAIN) protectedAccounts.push(row);
    else if (byDomain[domain]) byDomain[domain].push(row);
    else (otherDomains[domain] ||= []).push(row);
  }

  const domains = OUTREACH_DOMAINS.map(domain => {
    const observed = byDomain[domain];
    const providerUsableEmails = [...new Set(observed.filter(x => x.providerUsable).map(x => x.email))];
    const governedUsableEmails = [...new Set(observed.filter(x => x.governedUsable).map(x => x.email))];
    return {
      domain,
      observedAccounts: observed.length,
      providerUsableMailboxes: providerUsableEmails.length,
      providerUsableEmails,
      usableMailboxes: governedUsableEmails.length,
      usableEmails: governedUsableEmails,
      placementWatchOrUnverified: observed.filter(x => x.providerUsable && !x.governedUsable),
      nonUsableObserved: observed.filter(x => !x.providerUsable),
      governedCapacityAt25PerUsableMailbox: governedUsableEmails.length * GOVERNED_DAILY_LIMIT_PER_ACCOUNT
    };
  });

  const providerUsableTotal = domains.reduce((n, d) => n + d.providerUsableMailboxes, 0);
  const governedUsableTotal = domains.reduce((n, d) => n + d.usableMailboxes, 0);
  const report = {
    ok: true,
    gate: 'OUTBOUND_SENDER_CAPACITY_AUDIT_V2',
    mode: 'READ_ONLY',
    generatedAt: new Date().toISOString(),
    policy: 'REUSE_EXISTING_PAID_WORKSPACE_SEATS_FIRST_WITH_CURRENT_PLACEMENT_AUTH_GATE',
    fixedSenderTarget: null,
    newPaidWorkspaceSeatsAuthorized: false,
    instantlyAction: 'listAccounts',
    accountsObserved: accounts.length,
    placementGovernance: {
      file: path.relative(root, placement.file),
      exists: placement.exists,
      generatedAt: placement.generatedAt,
      ageHours: placement.ageHours,
      fresh: placement.fresh,
      maxAgeHours: PLACEMENT_EVIDENCE_MAX_AGE_HOURS,
      truth: placement.truth,
      verificationStatus: placement.verificationStatus,
      rule: 'Governed usable requires provider-usable account plus fresh sender placement status ACTIVE. WATCH or UNVERIFIED senders contribute zero governed capacity.'
    },
    protectedPrimaryDomain: PROTECTED_PRIMARY_DOMAIN,
    protectedPrimaryDomainObservedInInstantly: protectedAccounts,
    domains,
    otherDomains,
    totals: {
      outreachDomainsObserved: OUTREACH_DOMAINS.length,
      providerUsableOutreachMailboxes: providerUsableTotal,
      usableOutreachMailboxes: governedUsableTotal,
      governedDailyCapacity: governedUsableTotal * GOVERNED_DAILY_LIMIT_PER_ACCOUNT
    },
    acceptance: {
      name: 'REUSE_FIRST_SENDER_CAPACITY_WITH_PLACEMENT_GATE',
      rule: 'Measure actual healthy independent outreach accounts, but count capacity only where current placement/authentication evidence marks the sender ACTIVE. Do not create paid Workspace seats without explicit approval.'
    },
    safety: {
      externalWritesPerformed: false,
      instantlyMutated: false,
      googleWorkspaceMutated: false,
      dnsMutated: false,
      campaignsMutated: false,
      protectedPrimaryDomainExcludedFromOutboundTarget: true
    }
  };

  const outDir = path.join(root, 'DATA', 'OUTBOUND', 'INSTANTLY_MASTER_RECONCILIATION');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'OUTBOUND_SENDER_CAPACITY_AUDIT_V2_LATEST.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');

  console.log('============================================================');
  console.log('MILES OUTBOUND SENDER CAPACITY AUDIT V2 - READ ONLY');
  console.log('============================================================');
  console.log(`Instantly accounts observed: ${accounts.length}`);
  console.log(`Placement evidence fresh: ${placement.fresh}`);
  for (const d of domains) console.log(`${d.domain}: providerUsable=${d.providerUsableMailboxes} governedUsable=${d.usableMailboxes} capacity=${d.governedCapacityAt25PerUsableMailbox}/day`);
  console.log(`Protected primary-domain accounts observed: ${protectedAccounts.length}`);
  console.log(`Provider-usable outreach senders: ${providerUsableTotal}`);
  console.log(`Governed ACTIVE outreach senders: ${governedUsableTotal}`);
  console.log(`Current governed capacity at 25/day: ${governedUsableTotal * GOVERNED_DAILY_LIMIT_PER_ACCOUNT}/day`);
  console.log('Fixed sender target: NONE (reuse-first policy)');
  console.log('New paid Workspace seats authorized: False');
  console.log('External writes performed: False');
  console.log(`Report: ${out}`);
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

module.exports = { providerUsable, ageHours };
