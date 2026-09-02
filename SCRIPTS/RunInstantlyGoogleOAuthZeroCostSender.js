'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.MILES_ROOT || path.resolve(__dirname, '..'));
process.env.MILES_ROOT = ROOT;
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env'), override: false, quiet: true });

const instantly = require(path.join(ROOT, 'CONNECTORS', 'INSTANTLY', 'instantly.js'));

const ZERO_COST_PAID_TARGETS = Object.freeze([
  'cora@pathwaysgovcon.com',
  'evan@pathwaysgovcon.com',
  'maya@pathwaysgovcon.com',
  'silvia@pathwaysgovcon.com',
  'victoria@pathwaysgovcon.com',
  'chris@pathwaysgsa.com',
  'evan@pathwaysgsa.com',
  'jake@pathwaysgsa.com',
  'kevin@pathwaysgsa.com',
  'ryan@pathwaysgsa.com',
  'aden@pathwaysgov.com',
  'alexis@pathwaysgov.com',
  'jeff@pathwaysgov.com'
]);
const PROTECTED_PRIMARY_DOMAIN = 'pathways2gc.com';
const REQUIRED_AUTHORIZATION = 'AUTHORIZE_ZERO_COST_PAID_SENDER_GOOGLE_OAUTH';
const OUTPUT_DIR = path.join(ROOT, 'DATA', 'runtime', 'revenue', 'deliverability');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'instantly_google_oauth_zero_cost_sender_latest.json');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]).trim() : '';
}
function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function unwrapAccounts(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['items', 'data', 'accounts', 'results']) {
    if (Array.isArray(value[key])) return value[key];
    const nested = unwrapAccounts(value[key]);
    if (nested.length) return nested;
  }
  return [];
}
function emailOf(account) {
  return normalizeEmail(account?.email || account?.email_address || account?.account || account?.from_email || account?.address || account?.eaccount);
}
function writeEvidence(value) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(value, null, 2), 'utf8');
}

async function listAllAccounts() {
  const out = [];
  let startingAfter = null;
  for (let page = 0; page < 10; page += 1) {
    const params = { limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;
    const response = await instantly.listAccounts(params);
    const items = unwrapAccounts(response);
    out.push(...items);
    startingAfter = response?.next_starting_after || response?.nextStartingAfter || null;
    if (!startingAfter || items.length === 0) break;
  }
  return out;
}

async function init(intendedEmail, authorization) {
  const email = normalizeEmail(intendedEmail);
  if (!ZERO_COST_PAID_TARGETS.includes(email)) {
    throw new Error(`TARGET_NOT_IN_ZERO_COST_PAID_SENDER_ALLOWLIST:${email || 'EMPTY'}`);
  }
  if (email.endsWith(`@${PROTECTED_PRIMARY_DOMAIN}`)) {
    throw new Error('PROTECTED_PRIMARY_DOMAIN_OAUTH_BLOCKED');
  }
  if (authorization !== REQUIRED_AUTHORIZATION) {
    throw new Error('EXACT_ZERO_COST_OAUTH_AUTHORIZATION_REQUIRED');
  }

  const accounts = await listAllAccounts();
  if (accounts.some(account => emailOf(account) === email)) {
    const result = {
      ok: true,
      status: 'ACCOUNT_ALREADY_CONNECTED',
      intendedEmail: email,
      oauthSessionCreated: false,
      recurringWorkspaceCostChanged: false,
      aliasesCountAsIndependentSenders: false,
      protectedPrimaryDomainExcluded: true,
      generatedAt: new Date().toISOString()
    };
    writeEvidence(result);
    return result;
  }

  const session = await instantly.request('/oauth/google/init', { method: 'POST', body: {} });
  if (!session?.session_id || !session?.auth_url || !session?.expires_at) {
    throw new Error('INSTANTLY_GOOGLE_OAUTH_INIT_RESPONSE_INVALID');
  }

  const result = {
    ok: true,
    status: 'OAUTH_USER_CONSENT_REQUIRED',
    intendedEmail: email,
    sessionId: session.session_id,
    authorizationUrl: session.auth_url,
    expiresAt: session.expires_at,
    oauthSessionCreated: true,
    browserAutomationRequired: false,
    userGoogleConsentRequired: true,
    instructions: `Open authorizationUrl and authenticate specifically as ${email}. Instantly will connect the account after Google consent.`,
    recurringWorkspaceCostChanged: false,
    newGoogleWorkspaceLicenseAuthorized: false,
    aliasesCountAsIndependentSenders: false,
    protectedPrimaryDomainExcluded: true,
    tokenExposure: false,
    generatedAt: new Date().toISOString()
  };
  writeEvidence(result);
  return result;
}

async function status(sessionId, intendedEmail) {
  const session = String(sessionId || '').trim();
  const email = normalizeEmail(intendedEmail);
  if (!session) throw new Error('SESSION_ID_REQUIRED');
  if (email && !ZERO_COST_PAID_TARGETS.includes(email)) throw new Error(`TARGET_NOT_IN_ZERO_COST_PAID_SENDER_ALLOWLIST:${email}`);
  const provider = await instantly.request(`/oauth/session/status/${encodeURIComponent(session)}`, { method: 'GET' });
  const connectedEmail = normalizeEmail(provider?.email);
  const targetMismatch = provider?.status === 'success' && email && connectedEmail !== email;
  const result = {
    ok: provider?.status === 'success' && !targetMismatch,
    status: targetMismatch ? 'OAUTH_CONNECTED_WRONG_ACCOUNT' : String(provider?.status || 'unknown').toUpperCase(),
    intendedEmail: email || null,
    connectedEmail: connectedEmail || null,
    targetMismatch,
    providerStatus: provider?.status || null,
    providerError: provider?.error || null,
    providerErrorDescription: provider?.error_description || null,
    recurringWorkspaceCostChanged: false,
    protectedPrimaryDomainExcluded: true,
    generatedAt: new Date().toISOString()
  };
  writeEvidence(result);
  return result;
}

async function main() {
  const mode = String(process.argv[2] || '').trim().toLowerCase();
  let result;
  if (mode === 'init') {
    result = await init(argValue('--email'), argValue('--authorization') || process.env.MILES_ZERO_COST_SENDER_OAUTH_AUTHORIZATION || '');
  } else if (mode === 'status') {
    result = await status(argValue('--session-id'), argValue('--email'));
  } else {
    throw new Error('USAGE: init --email <paid-user> --authorization AUTHORIZE_ZERO_COST_PAID_SENDER_GOOGLE_OAUTH | status --session-id <id> --email <paid-user>');
  }
  console.log('INSTANTLY_GOOGLE_OAUTH_ZERO_COST_SENDER');
  console.log(JSON.stringify(result, null, 2));
  if (mode === 'status' && result.ok !== true) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    const result = {
      ok: false,
      status: 'FAILED',
      error: String(error?.message || error),
      recurringWorkspaceCostChanged: false,
      protectedPrimaryDomainExcluded: true,
      generatedAt: new Date().toISOString()
    };
    try { writeEvidence(result); } catch {}
    console.error('INSTANTLY_GOOGLE_OAUTH_ZERO_COST_SENDER_FAILED');
    console.error(result.error);
    process.exitCode = 2;
  });
}

module.exports = {
  ZERO_COST_PAID_TARGETS,
  PROTECTED_PRIMARY_DOMAIN,
  REQUIRED_AUTHORIZATION,
  normalizeEmail,
  unwrapAccounts,
  emailOf,
  init,
  status
};
