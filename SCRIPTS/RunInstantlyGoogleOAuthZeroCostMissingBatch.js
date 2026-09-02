'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.MILES_ROOT || path.resolve(__dirname, '..'));
process.env.MILES_ROOT = ROOT;
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env'), override: false, quiet: true });

const instantly = require(path.join(ROOT, 'CONNECTORS', 'INSTANTLY', 'instantly.js'));
const single = require(path.join(ROOT, 'SCRIPTS', 'RunInstantlyGoogleOAuthZeroCostSender.js'));

const {
  ZERO_COST_PAID_TARGETS,
  PROTECTED_PRIMARY_DOMAIN,
  REQUIRED_AUTHORIZATION,
  normalizeEmail,
  unwrapAccounts,
  emailOf
} = single;

const OUTPUT_DIR = path.join(ROOT, 'DATA', 'runtime', 'revenue', 'deliverability');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'instantly_google_oauth_zero_cost_missing_batch_latest.json');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]).trim() : '';
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

async function initMissing(authorization) {
  if (String(authorization || '').trim() !== REQUIRED_AUTHORIZATION) {
    throw new Error('EXACT_ZERO_COST_OAUTH_AUTHORIZATION_REQUIRED');
  }

  const accounts = await listAllAccounts();
  const connected = new Set(accounts.map(emailOf).filter(Boolean));
  const targets = ZERO_COST_PAID_TARGETS.filter(email => !email.endsWith(`@${PROTECTED_PRIMARY_DOMAIN}`));
  const alreadyConnected = targets.filter(email => connected.has(email));
  const missing = targets.filter(email => !connected.has(email));
  const sessions = [];
  const errors = [];

  for (const intendedEmail of missing) {
    try {
      const session = await instantly.request('/oauth/google/init', { method: 'POST', body: {} });
      if (!session?.session_id || !session?.auth_url || !session?.expires_at) {
        throw new Error('INSTANTLY_GOOGLE_OAUTH_INIT_RESPONSE_INVALID');
      }
      sessions.push({
        intendedEmail,
        sessionId: session.session_id,
        authorizationUrl: session.auth_url,
        expiresAt: session.expires_at,
        userGoogleConsentRequired: true,
        instruction: `Open authorizationUrl and authenticate specifically as ${intendedEmail}.`
      });
    } catch (error) {
      errors.push({ intendedEmail, error: String(error?.message || error) });
    }
  }

  const result = {
    ok: errors.length === 0,
    status: errors.length
      ? 'ZERO_COST_OAUTH_BATCH_PARTIAL_INIT_FAILURE'
      : missing.length
        ? 'ZERO_COST_OAUTH_USER_CONSENT_REQUIRED'
        : 'ZERO_COST_SENDER_TARGET_ALREADY_CONNECTED',
    targetIndependentPaidMailboxes: targets.length,
    alreadyConnectedCount: alreadyConnected.length,
    alreadyConnected,
    missingCount: missing.length,
    missing,
    oauthSessionsCreated: sessions.length,
    sessions,
    errors,
    followUp: missing.length
      ? 'Each authorization URL requires Google user consent for the exact intended mailbox; then run the 13-seat sender-capacity and placement gates again.'
      : 'No OAuth initialization required; continue sender health and placement acceptance.',
    recurringWorkspaceCostChanged: false,
    newGoogleWorkspaceLicenseAuthorized: false,
    aliasesCountAsIndependentSenders: false,
    protectedPrimaryDomainExcluded: true,
    googlePasswordsAcceptedOrStored: false,
    oauthRefreshTokensExposedToMiles: false,
    campaignMutation: false,
    prospectSend: false,
    dnsMutation: false,
    generatedAt: new Date().toISOString()
  };
  writeEvidence(result);
  return result;
}

async function main() {
  const authorization = argValue('--authorization') || process.env.MILES_ZERO_COST_SENDER_OAUTH_AUTHORIZATION || '';
  const result = await initMissing(authorization);
  console.log('INSTANTLY_GOOGLE_OAUTH_ZERO_COST_MISSING_BATCH');
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    const result = {
      ok: false,
      status: 'ZERO_COST_OAUTH_BATCH_FAILED',
      error: String(error?.message || error),
      recurringWorkspaceCostChanged: false,
      newGoogleWorkspaceLicenseAuthorized: false,
      aliasesCountAsIndependentSenders: false,
      protectedPrimaryDomainExcluded: true,
      googlePasswordsAcceptedOrStored: false,
      generatedAt: new Date().toISOString()
    };
    try { writeEvidence(result); } catch {}
    console.error('INSTANTLY_GOOGLE_OAUTH_ZERO_COST_MISSING_BATCH_FAILED');
    console.error(result.error);
    process.exitCode = 2;
  });
}

module.exports = { initMissing, listAllAccounts };
