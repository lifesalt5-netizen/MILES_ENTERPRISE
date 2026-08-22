'use strict';

const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const ROOT = path.resolve(process.env.MILES_ROOT || process.cwd());
const PRIMARY_DOMAIN = 'pathways2gc.com';
const REQUIRED_INBOXES = ['info@pathways2gc.com', 'kevin@pathways2gc.com'];
const accountManager = require('../CONNECTORS/GOOGLE/account_manager');

function emailOf(account = {}) {
  return String(account.email || account.accountKey || account.address || '').trim().toLowerCase();
}

async function safeMx(domain) {
  try { return { ok: true, rows: await dns.resolveMx(domain) }; }
  catch (error) { return { ok: false, rows: [], error: error.code || error.message }; }
}

async function main() {
  const mx = await safeMx(PRIMARY_DOMAIN);
  const mxHosts = (mx.rows || []).map(row => String(row.exchange || '').toLowerCase());
  const googleMx = mxHosts.length > 0 && mxHosts.every(host => /(^|\.)google\.com\.?$/.test(host));
  const ionosLikeMx = mxHosts.some(host => /ionos|1and1|registrar-servers/.test(host));

  const accounts = accountManager.listAccounts().filter(account => account.valid);
  const readableEmails = [...new Set(accounts.map(emailOf).filter(Boolean))];
  const coverage = REQUIRED_INBOXES.map(email => ({
    email,
    registeredGmailAccount: readableEmails.includes(email)
  }));

  const blockers = [];
  if (!mx.ok || mxHosts.length === 0) blockers.push('PRIMARY_DOMAIN_MX_UNREADABLE');
  if (!googleMx) blockers.push('PRIMARY_DOMAIN_NOT_EXCLUSIVELY_GOOGLE_MX');
  for (const item of coverage) {
    if (!item.registeredGmailAccount) blockers.push(`PRIMARY_INBOX_NOT_REGISTERED_IN_MILES_GMAIL:${item.email}`);
  }
  if (ionosLikeMx) blockers.push('IONOS_OR_FORWARDING_MX_ROUTE_DETECTED');

  const result = {
    ok: blockers.length === 0,
    gate: 'PRIMARY_INBOX_REPLY_COVERAGE',
    generatedAt: new Date().toISOString(),
    primaryDomain: PRIMARY_DOMAIN,
    mx: { readable: mx.ok, hosts: mxHosts, exclusivelyGoogle: googleMx, ionosLikeDetected: ionosLikeMx },
    requiredInboxes: coverage,
    registeredReadableGmailAccounts: readableEmails,
    conclusion: blockers.length === 0
      ? 'PRIMARY_DOMAIN_MAIL_ROUTES_TO_GOOGLE_AND_REQUIRED_INBOXES_ARE_REGISTERED_WITH_MILES'
      : 'INBOUND_REPLY_COVERAGE_NOT_PROVEN',
    blockers,
    safety: { readOnly: true, dnsMutated: false, gmailMutated: false, forwardingMutated: false, instantlyMutated: false }
  };

  const outDir = path.join(ROOT, 'DATA', 'operational_acceptance', 'primary_inbox_coverage');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, 'PRIMARY_INBOX_COVERAGE_LATEST.json');
  result.outputFile = out;
  fs.writeFileSync(out, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
