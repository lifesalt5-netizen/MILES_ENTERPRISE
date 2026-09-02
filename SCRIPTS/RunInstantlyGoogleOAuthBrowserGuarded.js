'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.MILES_ROOT || path.resolve(__dirname, '..'));
process.env.MILES_ROOT = ROOT;
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env'), override: false, quiet: true });

const browser = require(path.join(ROOT, 'CORE', 'BROWSER', 'BrowserManager.js'));
const batch = require(path.join(ROOT, 'SCRIPTS', 'RunInstantlyGoogleOAuthZeroCostMissingBatch.js'));
const single = require(path.join(ROOT, 'SCRIPTS', 'RunInstantlyGoogleOAuthZeroCostSender.js'));

const REQUIRED_BROWSER_AUTHORIZATION = 'AUTHORIZE_EXISTING_AUTHENTICATED_GOOGLE_OAUTH_CONSENT';
const OUTPUT_DIR = path.join(ROOT, 'DATA', 'runtime', 'revenue', 'deliverability');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'instantly_google_oauth_browser_guarded_latest.json');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]).trim() : '';
}

function writeEvidence(value) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(value, null, 2), 'utf8');
}

async function safeBodyText(page) {
  try { return await page.locator('body').innerText({ timeout: 10000 }); }
  catch { return ''; }
}

async function hasPasswordOrChallenge(page) {
  const url = String(page.url() || '').toLowerCase();
  const passwordInputs = await page.locator('input[type="password"]').count().catch(() => 0);
  const challenge = /\/challenge\//.test(url) || /signin\/v2\/challenge/.test(url);
  return passwordInputs > 0 || challenge;
}

async function clickExactAccountIfChooser(page, intendedEmail) {
  const url = String(page.url() || '').toLowerCase();
  const chooser = /oauthchooser|accountchooser|account\/chooser/.test(url);
  if (!chooser) return { chooser: false, clicked: false };

  const exact = page.getByText(intendedEmail, { exact: true }).first();
  const count = await exact.count().catch(() => 0);
  if (count < 1) return { chooser: true, clicked: false };
  await exact.click({ timeout: 10000 });
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  return { chooser: true, clicked: true };
}

async function clickConsentControl(page, intendedEmail) {
  const body = await safeBodyText(page);
  const lower = body.toLowerCase();
  const identityProven = lower.includes(intendedEmail.toLowerCase());
  const instantlyProven = lower.includes('instantly');

  if (/google hasn.t verified this app|this app is blocked|access blocked/.test(lower)) {
    return { acted: false, terminal: true, status: 'GOOGLE_SECURITY_BLOCKED', identityProven, instantlyProven };
  }

  if (!identityProven && /(continue|allow|select all)/.test(lower)) {
    return { acted: false, terminal: true, status: 'ACCOUNT_IDENTITY_NOT_PROVEN', identityProven, instantlyProven };
  }

  if (!instantlyProven && /(continue|allow)/.test(lower)) {
    return { acted: false, terminal: true, status: 'OAUTH_CLIENT_NOT_PROVEN', identityProven, instantlyProven };
  }

  const selectAll = page.getByText(/^Select all$/i, { exact: true }).first();
  if (identityProven && instantlyProven && await selectAll.count().catch(() => 0)) {
    await selectAll.click({ timeout: 10000 });
    return { acted: true, terminal: false, action: 'SELECT_ALL_REQUESTED_SCOPES', identityProven, instantlyProven };
  }

  for (const label of [/^Continue$/i, /^Allow$/i]) {
    const button = page.getByRole('button', { name: label }).first();
    if (identityProven && instantlyProven && await button.count().catch(() => 0)) {
      await button.click({ timeout: 10000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
      return { acted: true, terminal: false, action: String(label), identityProven, instantlyProven };
    }
  }

  return { acted: false, terminal: false, status: 'NO_SAFE_CONSENT_CONTROL_FOUND', identityProven, instantlyProven };
}

async function pollProviderStatus(sessionId, intendedEmail, attempts = 6) {
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      last = await single.status(sessionId, intendedEmail);
      if (last?.ok === true) return last;
    } catch (error) {
      last = { ok: false, status: 'STATUS_CHECK_ERROR', error: String(error?.message || error) };
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return last;
}

async function processSession(context, session) {
  const intendedEmail = single.normalizeEmail(session?.intendedEmail);
  const outcome = {
    intendedEmail,
    status: 'NOT_STARTED',
    completed: false,
    wrongAccountPrevented: false,
    credentialEntryAttempted: false,
    mfaBypassAttempted: false,
    consentClicks: []
  };

  if (!single.ZERO_COST_PAID_TARGETS.includes(intendedEmail) || intendedEmail.endsWith(`@${single.PROTECTED_PRIMARY_DOMAIN}`)) {
    return { ...outcome, status: 'TARGET_NOT_AUTHORIZED' };
  }

  const page = await context.newPage();
  try {
    await page.goto(session.authorizationUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    for (let step = 0; step < 10; step += 1) {
      await new Promise(resolve => setTimeout(resolve, 800));

      if (await hasPasswordOrChallenge(page)) {
        return { ...outcome, status: 'USER_LOGIN_OR_MFA_REQUIRED', finalUrlHost: new URL(page.url()).hostname };
      }

      const url = String(page.url() || '');
      if (/iapi\.instantly\.ai\/oauth\/google\/redirect/i.test(url)) break;

      const chooser = await clickExactAccountIfChooser(page, intendedEmail);
      if (chooser.chooser && !chooser.clicked) {
        return { ...outcome, status: 'INTENDED_ACCOUNT_NOT_AUTHENTICATED_IN_PROFILE', finalUrlHost: new URL(page.url()).hostname };
      }
      if (chooser.clicked) continue;

      const body = await safeBodyText(page);
      const lower = body.toLowerCase();
      if (/sign in|use another account/.test(lower) && !lower.includes(intendedEmail.toLowerCase()) && /accounts\.google\.com/i.test(url)) {
        return { ...outcome, status: 'INTENDED_ACCOUNT_NOT_AUTHENTICATED_IN_PROFILE', finalUrlHost: new URL(page.url()).hostname };
      }

      const action = await clickConsentControl(page, intendedEmail);
      if (action.terminal) {
        return { ...outcome, status: action.status, wrongAccountPrevented: action.status === 'ACCOUNT_IDENTITY_NOT_PROVEN' };
      }
      if (action.acted) {
        outcome.consentClicks.push(action.action);
        continue;
      }

      if (/iapi\.instantly\.ai|app\.instantly\.ai/i.test(url)) break;
    }

    const provider = await pollProviderStatus(session.sessionId, intendedEmail);
    if (provider?.ok === true && single.normalizeEmail(provider.connectedEmail) === intendedEmail) {
      return {
        ...outcome,
        status: 'OAUTH_CONNECTED_EXACT_ACCOUNT',
        completed: true,
        connectedEmail: intendedEmail,
        providerStatus: provider.providerStatus || provider.status || 'success'
      };
    }

    return {
      ...outcome,
      status: provider?.status || 'OAUTH_NOT_COMPLETED',
      connectedEmail: provider?.connectedEmail || null,
      providerStatus: provider?.providerStatus || null,
      targetMismatch: provider?.targetMismatch === true
    };
  } catch (error) {
    return { ...outcome, status: 'BROWSER_AUTOMATION_ERROR', error: String(error?.message || error) };
  } finally {
    await page.close().catch(() => {});
  }
}

async function execute(authorization) {
  if (String(authorization || '').trim() !== REQUIRED_BROWSER_AUTHORIZATION) {
    throw new Error('EXACT_BROWSER_OAUTH_AUTHORIZATION_REQUIRED');
  }

  const init = await batch.initMissing(single.REQUIRED_AUTHORIZATION);
  const sessions = Array.isArray(init?.sessions) ? init.sessions : [];
  const results = [];
  let context = null;

  try {
    context = await browser.launch(true);
    for (const session of sessions) results.push(await processSession(context, session));
  } catch (error) {
    const result = {
      ok: false,
      status: 'MILES_BROWSER_PROFILE_UNAVAILABLE',
      error: String(error?.message || error),
      targetIndependentPaidMailboxes: single.ZERO_COST_PAID_TARGETS.length,
      missingAtStart: init?.missing || [],
      completedCount: 0,
      requiresUserLoginOrMfa: init?.missing || [],
      recurringWorkspaceCostChanged: false,
      newGoogleWorkspaceLicenseAuthorized: false,
      aliasesCountAsIndependentSenders: false,
      passwordsReadOrEntered: false,
      cookiesOrTokensExposed: false,
      mfaBypassAttempted: false,
      prospectSend: false,
      campaignMutation: false,
      dnsMutation: false,
      generatedAt: new Date().toISOString()
    };
    writeEvidence(result);
    return result;
  } finally {
    if (context) await browser.close().catch(() => {});
  }

  const completed = results.filter(item => item.completed === true);
  const requiresLogin = results.filter(item => ['USER_LOGIN_OR_MFA_REQUIRED','INTENDED_ACCOUNT_NOT_AUTHENTICATED_IN_PROFILE'].includes(item.status));
  const blocked = results.filter(item => !item.completed && !requiresLogin.includes(item));
  const result = {
    ok: blocked.length === 0,
    status: completed.length === sessions.length
      ? 'ALL_MISSING_PAID_MAILBOXES_OAUTH_CONNECTED'
      : requiresLogin.length
        ? 'USER_LOGIN_OR_MFA_REQUIRED_FOR_REMAINDER'
        : 'OAUTH_BROWSER_GUARD_BLOCKED',
    targetIndependentPaidMailboxes: single.ZERO_COST_PAID_TARGETS.length,
    alreadyConnectedAtStart: init?.alreadyConnected || [],
    missingAtStart: init?.missing || [],
    oauthSessionsCreated: sessions.length,
    completedCount: completed.length,
    completedMailboxes: completed.map(item => item.intendedEmail),
    requiresUserLoginOrMfa: requiresLogin.map(item => item.intendedEmail),
    blockedMailboxes: blocked.map(item => ({ intendedEmail: item.intendedEmail, status: item.status })),
    results,
    recurringWorkspaceCostChanged: false,
    newGoogleWorkspaceLicenseAuthorized: false,
    aliasesCountAsIndependentSenders: false,
    protectedPrimaryDomainExcluded: true,
    passwordsReadOrEntered: false,
    cookiesOrTokensExposed: false,
    mfaBypassAttempted: false,
    wrongAccountConsentPrevented: results.some(item => item.wrongAccountPrevented === true || item.targetMismatch === true),
    prospectSend: false,
    campaignMutation: false,
    dnsMutation: false,
    generatedAt: new Date().toISOString()
  };
  writeEvidence(result);
  return result;
}

async function main() {
  const authorization = argValue('--authorization') || process.env.MILES_BROWSER_OAUTH_AUTHORIZATION || '';
  const result = await execute(authorization);
  console.log('INSTANTLY_GOOGLE_OAUTH_BROWSER_GUARDED');
  console.log(JSON.stringify(result, null, 2));
  if (result.ok !== true || result.status !== 'ALL_MISSING_PAID_MAILBOXES_OAUTH_CONNECTED') process.exitCode = 2;
}

if (require.main === module) {
  main().catch(error => {
    const result = {
      ok: false,
      status: 'INSTANTLY_GOOGLE_OAUTH_BROWSER_GUARDED_FAILED',
      error: String(error?.message || error),
      passwordsReadOrEntered: false,
      cookiesOrTokensExposed: false,
      mfaBypassAttempted: false,
      prospectSend: false,
      campaignMutation: false,
      dnsMutation: false,
      generatedAt: new Date().toISOString()
    };
    try { writeEvidence(result); } catch {}
    console.error('INSTANTLY_GOOGLE_OAUTH_BROWSER_GUARDED_FAILED');
    console.error(result.error);
    process.exitCode = 2;
  });
}

module.exports = {
  REQUIRED_BROWSER_AUTHORIZATION,
  execute,
  processSession,
  clickExactAccountIfChooser,
  clickConsentControl,
  hasPasswordOrChallenge,
  pollProviderStatus
};
