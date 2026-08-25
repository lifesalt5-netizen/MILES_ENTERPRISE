'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');
const B12Publisher = require('./B12_CONTROLLED_PUBLISHER_V8');
const { detectSession } = require('./modules/session');

function clean(v) { return String(v || '').trim(); }
function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(raw).trim().toLowerCase());
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, answer => {
    rl.close();
    resolve(answer);
  }));
}

async function chooseAuthenticatedPage(context, fallbackPage) {
  const pages = context.pages();
  for (const candidate of [...pages].reverse()) {
    const session = await detectSession(candidate).catch(() => null);
    if (session?.loggedIn) return { page: candidate, session };
  }
  return { page: fallbackPage, session: await detectSession(fallbackPage) };
}

async function editorObservation(publisher) {
  const ui = await publisher.uiInventory().catch(() => null);
  const frames = Array.isArray(ui?.frames) ? ui.frames : [];
  const firstPartyFrames = frames.filter(frame => /^https:\/\/b12\.io\/client\//i.test(clean(frame?.url)));
  const firstPartyBody = firstPartyFrames.map(frame => clean(frame?.bodyPreview)).filter(Boolean).join('\n');
  const currentUiEvidence = /\b(Dashboard|Website|Agent|Chat|Scheduling|Domains|Preview|Publish)\b/i.test(firstPartyBody);
  const firstPartyVisibleControls = firstPartyFrames.reduce((total, frame) => {
    const buttons = (frame?.buttons || []).filter(x => clean(x)).length;
    const links = (frame?.links || []).filter(x => clean(x)).length;
    return total + buttons + links;
  }, 0);
  const firstPartyVisibleInputs = firstPartyFrames.reduce((total, frame) => total + (frame?.placeholders || []).filter(x => {
    const type = clean(x?.type).toLowerCase();
    return type !== 'hidden' && (clean(x?.placeholder) || clean(x?.aria) || clean(x?.role) || clean(x?.contenteditable));
  }).length, 0);
  const visibleControls = Number(ui?.buttons?.length || 0) + Number(ui?.links?.length || 0);
  const visibleInputs = (ui?.placeholders || []).filter(x => String(x.type || '').toLowerCase() !== 'hidden').length;
  return {
    ok: Boolean(ui) && (currentUiEvidence || firstPartyVisibleControls > 0 || firstPartyVisibleInputs > 0),
    ui,
    currentUiEvidence,
    visibleControls,
    visibleInputs,
    firstPartyFrameCount: firstPartyFrames.length,
    firstPartyVisibleControls,
    firstPartyVisibleInputs
  };
}

async function main() {
  const root = path.resolve(process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
  const profile = clean(process.env.B12_USER_DATA_DIR) || path.join(root, 'DATA', 'browser_profiles', 'b12_miles');
  const outputDir = path.join(root, 'DATA', 'website_ops', 'b12_auth');
  const authOutputFile = path.join(outputDir, 'latest.json');
  fs.mkdirSync(profile, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const authReport = {
    ok: false,
    service: 'B12_AUTH_AND_STAGE_SINGLE_SESSION',
    generatedAt: new Date().toISOString(),
    profile,
    credentialsCaptured: false,
    credentialsPersistedByMiles: false,
    browserSessionPersistent: true,
    singleBrowserSession: true,
    publicPublishRequested: envBool('P2GC_B12_PUBLISH', false)
  };

  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      slowMo: 75
    });
    let page = context.pages()[0] || await context.newPage();
    await page.goto('https://b12.io/dashboard/', { waitUntil: 'domcontentloaded', timeout: 60000 });

    let selected = await chooseAuthenticatedPage(context, page);
    page = selected.page;
    let session = selected.session;

    if (!session.loggedIn) {
      console.log('');
      console.log('B12 AUTHENTICATION REQUIRED');
      console.log('A browser window is open using the persistent MILES B12 profile.');
      console.log('Log into B12 yourself. MILES does not read, store, or print your password.');
      console.log('When the B12 dashboard/site editor is visible, return to this terminal.');
      await waitForEnter('Press ENTER after you are logged into B12: ');
      selected = await chooseAuthenticatedPage(context, page);
      page = selected.page;
      session = selected.session;
    }

    authReport.session = {
      url: session.url,
      title: session.title,
      loggedIn: session.loggedIn === true,
      loggedOut: session.loggedOut === true
    };

    if (!session.loggedIn) {
      authReport.status = 'B12_AUTH_NOT_CONFIRMED';
      fs.writeFileSync(authOutputFile, JSON.stringify(authReport, null, 2), 'utf8');
      console.log(JSON.stringify(authReport, null, 2));
      return 2;
    }

    const publisher = new B12Publisher({ rootDir: root });
    publisher.context = context;
    publisher.page = page;
    publisher.ownsBrowser = false;
    publisher.open = async () => page;
    publisher.close = async () => {};

    await sleep(1500);
    let observed = await editorObservation(publisher);
    if (!observed.ok) {
      console.log('');
      console.log('B12 EDITOR UI IS AUTHENTICATED BUT REAL FIRST-PARTY EDITOR CONTROLS ARE NOT YET OBSERVABLE TO MILES.');
      console.log('A support/chat widget or other third-party frame does NOT count as editor readiness.');
      console.log('In the browser window opened by this command, make sure the B12 site builder is visibly loaded.');
      console.log('Click the Chat tab at the top once so the B12 Agent input is visibly open.');
      console.log('Do not publish anything manually.');
      await waitForEnter('Press ENTER after the B12 Chat/Agent input is visibly open: ');
      await sleep(1500);
      observed = await editorObservation(publisher);
    }

    authReport.editorObservation = {
      ok: observed.ok,
      currentUiEvidence: observed.currentUiEvidence,
      visibleControls: observed.visibleControls,
      visibleInputs: observed.visibleInputs,
      firstPartyFrameCount: observed.firstPartyFrameCount,
      firstPartyVisibleControls: observed.firstPartyVisibleControls,
      firstPartyVisibleInputs: observed.firstPartyVisibleInputs,
      frameCount: observed.ui?.frameCount || 0,
      url: observed.ui?.url || page.url(),
      title: observed.ui?.title || await page.title().catch(() => '')
    };

    authReport.screenshot = path.join(outputDir, `single_session_${Date.now()}.png`);
    await page.screenshot({ path: authReport.screenshot, fullPage: true }).catch(() => null);

    if (!observed.ok) {
      authReport.status = 'B12_FIRST_PARTY_EDITOR_UI_NOT_OBSERVABLE_IN_AUTOMATION_SESSION';
      fs.writeFileSync(authOutputFile, JSON.stringify(authReport, null, 2), 'utf8');
      console.log(JSON.stringify(authReport, null, 2));
      return 3;
    }

    authReport.ok = true;
    authReport.status = 'B12_AUTHENTICATED_SINGLE_SESSION_EDITOR_READY';
    fs.writeFileSync(authOutputFile, JSON.stringify(authReport, null, 2), 'utf8');
    console.log(JSON.stringify(authReport, null, 2));

    const apply = envBool('P2GC_B12_APPLY', false);
    const publish = envBool('P2GC_B12_PUBLISH', false);
    const result = await publisher.run({ apply, publish });
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  } catch (error) {
    authReport.status = 'B12_AUTH_AND_STAGE_SINGLE_SESSION_EXCEPTION';
    authReport.error = error.message;
    fs.writeFileSync(authOutputFile, JSON.stringify(authReport, null, 2), 'utf8');
    console.log(JSON.stringify(authReport, null, 2));
    return 2;
  } finally {
    if (context) await context.close().catch(() => null);
  }
}

main().then(code => {
  process.exitCode = code;
}).catch(error => {
  console.error(error);
  process.exitCode = 2;
});
