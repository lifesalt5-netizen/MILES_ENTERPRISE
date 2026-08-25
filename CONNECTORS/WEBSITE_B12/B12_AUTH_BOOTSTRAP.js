'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');
const { detectSession } = require('./modules/session');

function clean(v) { return String(v || '').trim(); }

async function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, answer => {
    rl.close();
    resolve(answer);
  }));
}

async function main() {
  const root = path.resolve(process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
  const profile = clean(process.env.B12_USER_DATA_DIR) || path.join(root, 'DATA', 'browser_profiles', 'b12_miles');
  const outputDir = path.join(root, 'DATA', 'website_ops', 'b12_auth');
  const outputFile = path.join(outputDir, 'latest.json');
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const report = {
    ok: false,
    service: 'B12_AUTH_BOOTSTRAP',
    generatedAt: new Date().toISOString(),
    profile,
    credentialsCaptured: false,
    credentialsPersistedByMiles: false,
    browserSessionPersistent: true
  };

  let context;
  try {
    context = await chromium.launchPersistentContext(profile, { headless: false, slowMo: 50 });
    let page = context.pages()[0] || await context.newPage();
    await page.goto('https://b12.io/dashboard/', { waitUntil: 'domcontentloaded', timeout: 60000 });

    let session = await detectSession(page);
    if (!session.loggedIn) {
      console.log('');
      console.log('B12 AUTHENTICATION REQUIRED');
      console.log('A browser window is open using the persistent MILES B12 profile.');
      console.log('Log into B12 yourself. MILES does not read, store, or print your password.');
      console.log('When the B12 dashboard/site editor is visible, return to this terminal.');
      await waitForEnter('Press ENTER after you are logged into B12: ');

      const pages = context.pages();
      for (const candidate of [...pages].reverse()) {
        const candidateSession = await detectSession(candidate).catch(() => null);
        if (candidateSession?.loggedIn) {
          page = candidate;
          session = candidateSession;
          break;
        }
      }
      if (!session.loggedIn) session = await detectSession(page);
    }

    report.session = {
      url: session.url,
      title: session.title,
      loggedIn: session.loggedIn === true,
      loggedOut: session.loggedOut === true
    };

    if (!session.loggedIn) {
      report.status = 'B12_AUTH_NOT_CONFIRMED';
      return report;
    }

    report.screenshot = path.join(outputDir, `authenticated_${Date.now()}.png`);
    await page.screenshot({ path: report.screenshot, fullPage: true }).catch(() => null);
    report.ok = true;
    report.status = 'B12_AUTHENTICATED_PERSISTENT_SESSION_READY';
    return report;
  } catch (error) {
    report.status = 'B12_AUTH_BOOTSTRAP_EXCEPTION';
    report.error = error.message;
    return report;
  } finally {
    fs.writeFileSync(outputFile, JSON.stringify(report, null, 2), 'utf8');
    if (context) await context.close().catch(() => null);
  }
}

main().then(result => {
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}).catch(error => {
  console.error(error);
  process.exit(2);
});
