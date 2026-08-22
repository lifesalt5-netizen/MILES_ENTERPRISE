'use strict';

const dns = require('dns').promises;
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const ROOT = path.resolve(process.env.MILES_ROOT || process.cwd());
const PRIMARY_DOMAIN = 'pathways2gc.com';
const REQUIRED_INBOXES = ['info@pathways2gc.com', 'kevin@pathways2gc.com'];
const accountManager = require('../CONNECTORS/GOOGLE/account_manager');
const ionos = require('../CONNECTORS/IONOS/imap_readonly');

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
  const gmailCoverage = REQUIRED_INBOXES.map(email => ({ email, registeredGmailAccount: readableEmails.includes(email) }));

  let ionosCheck = null;
  if (ionosLikeMx) ionosCheck = await ionos.healthCheckAll();
  const ionosByEmail = new Map((ionosCheck?.mailboxes || []).map(row => [String(row.email || '').toLowerCase(), row]));

  const coverage = REQUIRED_INBOXES.map(email => {
    const gmail = gmailCoverage.find(item => item.email === email);
    const i = ionosByEmail.get(email);
    const route = googleMx && gmail?.registeredGmailAccount
      ? 'GOOGLE'
      : ionosLikeMx && i?.ok === true
        ? 'IONOS_IMAP_READ_ONLY'
        : 'UNPROVEN';
    return {
      email,
      route,
      registeredGmailAccount: gmail?.registeredGmailAccount === true,
      ionosReadable: i?.ok === true,
      ionosInboxExists: i?.inboxExists ?? null
    };
  });

  const blockers = [];
  if (!mx.ok || mxHosts.length === 0) blockers.push('PRIMARY_DOMAIN_MX_UNREADABLE');
  if (!googleMx && !ionosLikeMx) blockers.push('PRIMARY_DOMAIN_MX_ROUTE_UNSUPPORTED');
  for (const item of coverage) {
    if (item.route === 'UNPROVEN') blockers.push(`PRIMARY_INBOX_ROUTE_NOT_PROVEN:${item.email}`);
  }
  if (ionosLikeMx && ionosCheck?.ok !== true) blockers.push('IONOS_PRIMARY_INBOX_READABILITY_FAILED');

  const result = {
    ok: blockers.length === 0,
    gate: 'PRIMARY_INBOX_REPLY_COVERAGE',
    generatedAt: new Date().toISOString(),
    primaryDomain: PRIMARY_DOMAIN,
    mx: { readable: mx.ok, hosts: mxHosts, exclusivelyGoogle: googleMx, ionosLikeDetected: ionosLikeMx },
    requiredInboxes: coverage,
    registeredReadableGmailAccounts: readableEmails,
    ionos: ionosCheck ? {
      ok: ionosCheck.ok === true,
      readOnly: true,
      mailboxes: ionosCheck.mailboxes
    } : null,
    conclusion: blockers.length === 0
      ? 'PRIMARY_DOMAIN_INBOUND_ROUTES_ARE_PROVEN_READABLE_BY_MILES'
      : 'INBOUND_REPLY_COVERAGE_NOT_PROVEN',
    blockers,
    safety: {
      readOnly: true,
      dnsMutated: false,
      gmailMutated: false,
      ionosMailboxMutated: false,
      forwardingMutated: false,
      instantlyMutated: false
    }
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
