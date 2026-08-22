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

function emailOf(a) {
  return String(a?.email || a?.email_address || a?.account || a?.from_email || a?.address || a?.eaccount || '').trim().toLowerCase();
}

function statusOf(a) {
  return String(a?.status ?? a?.status_label ?? a?.account_status ?? a?.state ?? 'UNKNOWN');
}

function usable(a) {
  const email = emailOf(a);
  if (!email.includes('@')) return false;
  const status = statusOf(a).toLowerCase();
  return !/(disabled|error|failed|disconnected|pending|inactive)/.test(status);
}

async function main() {
  const response = await instantly.execute(
    { action: 'listAccounts', payload: { limit: 100 } },
    { audit: true, readOnly: true }
  );
  const accounts = deepArray(response);
  if (!accounts.length) throw new Error('INSTANTLY_ACCOUNT_INVENTORY_EMPTY_OR_UNPARSEABLE');

  const byDomain = Object.fromEntries(OUTREACH_DOMAINS.map(domain => [domain, []]));
  const protectedAccounts = [];
  const otherDomains = {};

  for (const account of accounts) {
    const email = emailOf(account);
    if (!email.includes('@')) continue;
    const domain = email.split('@').pop();
    const row = { email, status: statusOf(account), usable: usable(account) };
    if (domain === PROTECTED_PRIMARY_DOMAIN) protectedAccounts.push(row);
    else if (byDomain[domain]) byDomain[domain].push(row);
    else (otherDomains[domain] ||= []).push(row);
  }

  const domains = OUTREACH_DOMAINS.map(domain => {
    const observed = byDomain[domain];
    const usableEmails = [...new Set(observed.filter(x => x.usable).map(x => x.email))];
    return {
      domain,
      observedAccounts: observed.length,
      usableMailboxes: usableEmails.length,
      usableEmails,
      nonUsableObserved: observed.filter(x => !x.usable),
      governedCapacityAt25PerUsableMailbox: usableEmails.length * GOVERNED_DAILY_LIMIT_PER_ACCOUNT
    };
  });

  const usableTotal = domains.reduce((n, d) => n + d.usableMailboxes, 0);
  const report = {
    ok: true,
    gate: 'OUTBOUND_SENDER_CAPACITY_AUDIT_V2',
    mode: 'READ_ONLY',
    generatedAt: new Date().toISOString(),
    policy: 'REUSE_EXISTING_PAID_WORKSPACE_SEATS_FIRST',
    fixedSenderTarget: null,
    newPaidWorkspaceSeatsAuthorized: false,
    instantlyAction: 'listAccounts',
    accountsObserved: accounts.length,
    protectedPrimaryDomain: PROTECTED_PRIMARY_DOMAIN,
    protectedPrimaryDomainObservedInInstantly: protectedAccounts,
    domains,
    otherDomains,
    totals: {
      outreachDomainsObserved: OUTREACH_DOMAINS.length,
      usableOutreachMailboxes: usableTotal,
      governedDailyCapacity: usableTotal * GOVERNED_DAILY_LIMIT_PER_ACCOUNT
    },
    acceptance: {
      name: 'REUSE_FIRST_SENDER_CAPACITY',
      rule: 'Measure actual healthy independent outreach accounts. Do not require an arbitrary mailbox count and do not create paid Workspace seats without explicit approval.'
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
  for (const d of domains) console.log(`${d.domain}: usable=${d.usableMailboxes} capacity=${d.governedCapacityAt25PerUsableMailbox}/day`);
  console.log(`Protected primary-domain accounts observed: ${protectedAccounts.length}`);
  console.log(`Usable outreach senders: ${usableTotal}`);
  console.log(`Current governed capacity at 25/day: ${usableTotal * GOVERNED_DAILY_LIMIT_PER_ACCOUNT}/day`);
  console.log('Fixed sender target: NONE (reuse-first policy)');
  console.log('New paid Workspace seats authorized: False');
  console.log('External writes performed: False');
  console.log(`Report: ${out}`);
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
