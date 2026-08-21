'use strict';

const path = require('path');
const fs = require('fs');

const root = path.resolve(process.argv[2] || process.env.MILES_ROOT || process.cwd());
process.env.MILES_ROOT = root;
const dotenv = require(path.join(root, 'node_modules', 'dotenv'));
dotenv.config({ path: path.join(root, '.env'), override: false, quiet: true });

const instantly = require(path.join(root, 'CONNECTORS', 'INSTANTLY', 'connector.js'));

const TARGET_DOMAINS = [
  'pathways2gc.co',
  'pathwaysfederal.com',
  'pathwaysgov.com',
  'pathwaysgovcon.com',
  'pathwaysgsa.com',
  'pathwaystogc.com'
];
const PROTECTED_PRIMARY_DOMAIN = 'pathways2gc.com';
const TARGET_PER_DOMAIN = 5;

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

  const target = Object.fromEntries(TARGET_DOMAINS.map(domain => [domain, []]));
  const protectedAccounts = [];
  const otherDomains = {};

  for (const account of accounts) {
    const email = emailOf(account);
    if (!email.includes('@')) continue;
    const domain = email.split('@').pop();
    const row = { email, status: statusOf(account), usable: usable(account) };
    if (domain === PROTECTED_PRIMARY_DOMAIN) protectedAccounts.push(row);
    else if (target[domain]) target[domain].push(row);
    else (otherDomains[domain] ||= []).push(row);
  }

  const domains = TARGET_DOMAINS.map(domain => {
    const observed = target[domain];
    const usableEmails = [...new Set(observed.filter(x => x.usable).map(x => x.email))];
    return {
      domain,
      targetMailboxes: TARGET_PER_DOMAIN,
      observedAccounts: observed.length,
      usableMailboxes: usableEmails.length,
      missingToTarget: Math.max(0, TARGET_PER_DOMAIN - usableEmails.length),
      usableEmails,
      nonUsableObserved: observed.filter(x => !x.usable)
    };
  });

  const usableTotal = domains.reduce((n, d) => n + d.usableMailboxes, 0);
  const missingTotal = domains.reduce((n, d) => n + d.missingToTarget, 0);
  const report = {
    ok: true,
    gate: 'OUTBOUND_SENDER_CAPACITY_AUDIT_V2',
    mode: 'READ_ONLY',
    generatedAt: new Date().toISOString(),
    instantlyAction: 'listAccounts',
    accountsObserved: accounts.length,
    protectedPrimaryDomain: PROTECTED_PRIMARY_DOMAIN,
    protectedPrimaryDomainObservedInInstantly: protectedAccounts,
    domains,
    otherDomains,
    totals: {
      targetDomains: TARGET_DOMAINS.length,
      targetMailboxes: TARGET_DOMAINS.length * TARGET_PER_DOMAIN,
      usableTargetDomainMailboxes: usableTotal,
      missingMailboxes: missingTotal,
      currentCapacityAt25PerUsableMailbox: usableTotal * 25,
      capacityAt25PerMailboxIfTargetMet: TARGET_DOMAINS.length * TARGET_PER_DOMAIN * 25
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
  for (const d of domains) console.log(`${d.domain}: usable=${d.usableMailboxes} target=${d.targetMailboxes} missing=${d.missingToTarget}`);
  console.log(`Protected primary-domain accounts observed: ${protectedAccounts.length}`);
  console.log(`Usable outreach senders: ${usableTotal}`);
  console.log(`Missing to 30-sender target: ${missingTotal}`);
  console.log(`Current governed capacity at 25/day: ${usableTotal * 25}/day`);
  console.log(`Target governed capacity at 25/day: ${TARGET_DOMAINS.length * TARGET_PER_DOMAIN * 25}/day`);
  console.log('External writes performed: False');
  console.log(`Report: ${out}`);
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
