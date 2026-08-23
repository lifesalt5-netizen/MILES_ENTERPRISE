'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { detectSession } = require('./modules/session');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1','true','yes','y','on'].includes(String(raw).trim().toLowerCase());
}
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function clean(v) { return String(v || '').trim(); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

class B12ControlledPublisher {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.manifestPath = options.manifestPath || path.join(this.rootDir, 'CONFIG', 'p2gc_b12_conversion_publish_v2.json');
    this.manifest = options.manifest || readJson(this.manifestPath);
    this.outputDir = options.outputDir || path.join(this.rootDir, 'DATA', 'website_ops', 'b12_conversion_v2');
    this.dashboardUrl = options.dashboardUrl || 'https://b12.io/dashboard/';
    this.headless = options.headless !== undefined ? Boolean(options.headless) : envBool('B12_HEADLESS', false);
    this.browser = null;
    this.context = null;
    this.page = null;
    this.ownsBrowser = false;
  }

  gates() {
    return {
      dryRun: envBool('MILES_DRY_RUN', true),
      controlledWrite: envBool('MILES_CONTROLLED_WRITE_ENABLED', false),
      b12Write: envBool('B12_WRITE_ENABLED', false),
      b12Publish: envBool('B12_PUBLISH_ENABLED', false)
    };
  }

  mayEdit() {
    const g = this.gates();
    return g.dryRun === false && g.controlledWrite && g.b12Write;
  }

  mayPublish() {
    const g = this.gates();
    return this.mayEdit() && g.b12Publish;
  }

  async open() {
    const cdp = clean(process.env.B12_CDP_URL);
    const userDataDir = clean(process.env.B12_USER_DATA_DIR);

    if (cdp) {
      this.browser = await chromium.connectOverCDP(cdp);
      const contexts = this.browser.contexts();
      if (!contexts.length) throw new Error('B12_CDP_URL connected but no browser context is available.');
      this.context = contexts[0];
      this.page = this.context.pages()[0] || await this.context.newPage();
      this.ownsBrowser = false;
    } else if (userDataDir) {
      this.context = await chromium.launchPersistentContext(userDataDir, { headless: this.headless, slowMo: 75 });
      this.page = this.context.pages()[0] || await this.context.newPage();
      this.ownsBrowser = true;
    } else {
      this.browser = await chromium.launch({ headless: this.headless, slowMo: 75 });
      this.context = await this.browser.newContext();
      this.page = await this.context.newPage();
      this.ownsBrowser = true;
    }

    await this.page.goto(this.dashboardUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    return this.page;
  }

  async close() {
    try {
      if (!this.ownsBrowser) return;
      if (this.context && typeof this.context.close === 'function') await this.context.close();
      else if (this.browser) await this.browser.close();
    } catch {}
  }

  async screenshot(label) {
    fs.mkdirSync(this.outputDir, { recursive: true });
    const file = path.join(this.outputDir, `${label}_${stamp()}.png`);
    await this.page.screenshot({ path: file, fullPage: true }).catch(() => null);
    return file;
  }

  async uiInventory() {
    const body = await this.page.locator('body').innerText({ timeout: 10000 }).catch(() => '');
    const buttons = await this.page.getByRole('button').allInnerTexts().catch(() => []);
    const links = await this.page.getByRole('link').allInnerTexts().catch(() => []);
    const placeholders = await this.page.locator('textarea,input').evaluateAll(nodes => nodes.map(n => ({
      tag: n.tagName,
      type: n.getAttribute('type'),
      placeholder: n.getAttribute('placeholder'),
      aria: n.getAttribute('aria-label')
    })).slice(0, 100)).catch(() => []);
    return { url: this.page.url(), title: await this.page.title().catch(() => ''), bodyPreview: body.slice(0, 3000), buttons: buttons.slice(0, 80), links: links.slice(0, 80), placeholders };
  }

  async findAgentTrigger() {
    const candidates = [
      this.page.getByRole('button', { name: /AI Agent/i }),
      this.page.getByText('AI Agent', { exact: true }),
      this.page.getByText(/AI Agent/i),
      this.page.getByRole('button', { name: /Chat/i })
    ];
    for (const locator of candidates) {
      try {
        const count = await locator.count();
        for (let i = 0; i < count; i += 1) {
          const item = locator.nth(i);
          if (await item.isVisible({ timeout: 1000 }).catch(() => false)) return item;
        }
      } catch {}
    }
    return null;
  }

  async openAgent() {
    const trigger = await this.findAgentTrigger();
    if (!trigger) return { ok: false, status: 'B12_AI_AGENT_TRIGGER_NOT_FOUND' };
    await trigger.click();
    await sleep(750);
    const input = await this.findAgentInput();
    return input ? { ok: true, input } : { ok: false, status: 'B12_AI_AGENT_INPUT_NOT_FOUND' };
  }

  async findAgentInput() {
    const selectors = [
      'textarea[placeholder*="Ask" i]',
      'textarea[placeholder*="message" i]',
      'textarea',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]',
      'input[placeholder*="Ask" i]',
      'input[placeholder*="message" i]'
    ];
    for (const selector of selectors) {
      const locator = this.page.locator(selector);
      const count = await locator.count().catch(() => 0);
      for (let i = count - 1; i >= 0; i -= 1) {
        const item = locator.nth(i);
        if (await item.isVisible().catch(() => false)) return item;
      }
    }
    return null;
  }

  async waitForAgentSettled(timeoutMs = 150000) {
    const started = Date.now();
    let last = '';
    let stable = 0;
    while (Date.now() - started < timeoutMs) {
      await sleep(2500);
      const body = await this.page.locator('body').innerText().catch(() => '');
      const working = /thinking|working on it|making changes|generating|updating your site/i.test(body.slice(-2500));
      const tail = body.slice(-5000);
      if (!working && tail === last) stable += 1;
      else stable = 0;
      last = tail;
      if (stable >= 2) return { ok: true, status: 'AGENT_SETTLED' };
    }
    return { ok: false, status: 'AGENT_SETTLE_TIMEOUT' };
  }

  async sendAgentPrompt(prompt) {
    const opened = await this.openAgent();
    if (!opened.ok) return opened;
    const input = opened.input;
    try {
      await input.fill(prompt);
    } catch {
      await input.click();
      await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await this.page.keyboard.type(prompt);
    }
    await input.press('Enter').catch(async () => {
      const send = this.page.getByRole('button', { name: /send|submit/i }).first();
      if (await send.isVisible().catch(() => false)) await send.click();
      else throw new Error('Unable to submit B12 AI Agent prompt');
    });
    return this.waitForAgentSettled();
  }

  async clickPreview() {
    const before = new Set(this.context.pages());
    const preview = this.page.getByRole('button', { name: /^Preview$/i }).first();
    if (!(await preview.isVisible().catch(() => false))) return { ok: false, status: 'PREVIEW_BUTTON_NOT_FOUND' };
    await preview.click();
    await sleep(1500);
    const pages = this.context.pages();
    const newPage = pages.find(p => !before.has(p));
    const target = newPage || this.page;
    await target.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => null);
    const url = target.url();
    if (!/^https?:/i.test(url)) return { ok: false, status: 'PREVIEW_URL_NOT_RESOLVED', url };
    return { ok: true, page: target, url };
  }

  async verifyStaging() {
    const preview = await this.clickPreview();
    if (!preview.ok) return { ok: false, status: preview.status, checks: [] };
    const previewPage = preview.page;
    const origin = new URL(preview.url).origin;
    const checks = [];

    for (const op of this.manifest.operations || []) {
      if (op.id === 'LEGACY_POSITIONING_CLEANUP') continue;
      const targetPath = op.target || '/';
      const response = await previewPage.goto(`${origin}${targetPath}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
      const text = await previewPage.locator('body').innerText({ timeout: 10000 }).catch(() => '');
      const markers = (op.required_markers || []).map(marker => ({ marker, present: text.includes(marker) }));
      checks.push({ id: op.id, target: targetPath, status: response?.status?.() || null, markers, ok: Boolean(response) && Number(response.status()) < 400 && markers.every(x => x.present) });
    }

    const homeResponse = await previewPage.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
    const homeHtml = await previewPage.content().catch(() => '');
    const legacyNavAbsent = !/href=["'][^"']*\/business-plans(?:["'/?#])/i.test(homeHtml);
    const legacyResponse = await previewPage.goto(`${origin}/business-plans`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
    const legacyStatus = legacyResponse?.status?.() || null;
    const legacyHtml = await previewPage.content().catch(() => '');
    const noindex = /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(legacyHtml) || /<meta[^>]+content=["'][^"']*noindex[^"']*["'][^>]+name=["']robots/i.test(legacyHtml);
    const legacyOk = legacyNavAbsent && (legacyStatus === 404 || legacyStatus === 410 || noindex);
    checks.push({ id: 'LEGACY_POSITIONING_CLEANUP', target: '/business-plans', homeStatus: homeResponse?.status?.() || null, legacyStatus, legacyNavAbsent, noindex, ok: legacyOk });

    if (previewPage !== this.page) await previewPage.close().catch(() => null);
    return { ok: checks.every(x => x.ok), status: checks.every(x => x.ok) ? 'STAGING_VERIFIED' : 'STAGING_VERIFICATION_FAILED', previewOrigin: origin, checks };
  }

  async publish() {
    const publish = this.page.getByRole('button', { name: /^Publish$/i }).first();
    if (!(await publish.isVisible().catch(() => false))) return { ok: false, status: 'PUBLISH_BUTTON_NOT_FOUND', mutationExecuted: false };
    await publish.click();
    await sleep(1500);
    const body = await this.page.locator('body').innerText().catch(() => '');
    const confirm = this.page.getByRole('button', { name: /publish|confirm|continue/i }).last();
    if (/confirm|publish changes|make.*live/i.test(body.slice(-3000)) && await confirm.isVisible().catch(() => false)) {
      await confirm.click();
      await sleep(1500);
    }
    return { ok: true, status: 'PUBLISH_ACTION_SUBMITTED', mutationExecuted: true };
  }

  async run(options = {}) {
    const requestedApply = options.apply === true;
    const requestedPublish = options.publish === true;
    const report = {
      ok: false,
      service: 'B12_CONTROLLED_PUBLISHER',
      site: this.manifest.site,
      generatedAt: new Date().toISOString(),
      requestedApply,
      requestedPublish,
      gates: this.gates(),
      operations: [],
      mutationExecuted: false,
      publicPublishExecuted: false
    };

    try {
      await this.open();
      report.session = await detectSession(this.page);
      report.beforeScreenshot = await this.screenshot('before');
      report.ui = await this.uiInventory();
      if (!report.session.loggedIn) {
        report.status = 'AUTHENTICATED_B12_SESSION_REQUIRED';
        return report;
      }

      const body = report.ui.bodyPreview || '';
      report.editorMode = /AI Agent/i.test(body) ? 'B12_AI_AGENT_EDITOR' : /Website|Pages|Editor/i.test(body) ? 'B12_EDITOR_UNKNOWN_VERSION' : 'B12_EDITOR_UNRESOLVED';

      if (!requestedApply || !this.mayEdit()) {
        report.ok = true;
        report.status = 'CONTROLLED_DRY_RUN';
        report.plan = (this.manifest.operations || []).map(op => ({ id: op.id, target: op.target, prompt: op.prompt }));
        return report;
      }

      for (const op of this.manifest.operations || []) {
        const before = await this.screenshot(`before_${op.id}`);
        const result = await this.sendAgentPrompt(op.prompt);
        const after = await this.screenshot(`after_${op.id}`);
        report.operations.push({ id: op.id, target: op.target, before, after, result });
        if (!result.ok) {
          report.status = `EDIT_FAILED_${op.id}`;
          return report;
        }
      }
      report.mutationExecuted = report.operations.length > 0;

      report.staging = await this.verifyStaging();
      if (!report.staging.ok) {
        report.status = 'STAGING_VERIFICATION_FAILED_NO_PUBLIC_PUBLISH';
        return report;
      }

      if (!requestedPublish || !this.mayPublish()) {
        report.ok = true;
        report.status = 'STAGING_VERIFIED_PUBLIC_PUBLISH_NOT_REQUESTED_OR_GATED';
        return report;
      }

      report.publish = await this.publish();
      report.publicPublishExecuted = report.publish.mutationExecuted === true;
      report.status = report.publish.ok ? 'PUBLIC_PUBLISH_SUBMITTED' : report.publish.status;
      report.ok = report.publish.ok === true;
      report.afterScreenshot = await this.screenshot('after_publish');
      return report;
    } catch (error) {
      report.status = 'B12_CONTROLLED_PUBLISHER_EXCEPTION';
      report.error = error.message;
      return report;
    } finally {
      fs.mkdirSync(this.outputDir, { recursive: true });
      const file = path.join(this.outputDir, 'latest.json');
      report.outputFile = file;
      fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
      await this.close();
    }
  }
}

async function main() {
  const publisher = new B12ControlledPublisher();
  const apply = envBool('P2GC_B12_APPLY', false);
  const publish = envBool('P2GC_B12_PUBLISH', false);
  const result = await publisher.run({ apply, publish });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => { console.error(error); process.exit(1); });
}

module.exports = B12ControlledPublisher;
module.exports.helpers = { envBool, clean };
