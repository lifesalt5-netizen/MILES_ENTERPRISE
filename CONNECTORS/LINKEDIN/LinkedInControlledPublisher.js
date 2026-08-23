'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1','true','yes','y','on'].includes(String(raw).trim().toLowerCase());
}
function clean(v) { return String(v || '').trim(); }
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

class LinkedInControlledPublisher {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, '..', '..'));
    this.outputDir = options.outputDir || path.join(this.rootDir, 'DATA', 'marketing_coo', 'linkedin_publish');
    this.targetUrl = clean(options.targetUrl || process.env.LINKEDIN_TARGET_URL || 'https://www.linkedin.com/feed/');
    this.headless = options.headless !== undefined ? Boolean(options.headless) : envBool('LINKEDIN_HEADLESS', false);
    this.browser = null;
    this.context = null;
    this.page = null;
    this.ownsBrowser = false;
  }

  gates() {
    return {
      dryRun: envBool('MILES_DRY_RUN', true),
      controlledWrite: envBool('MILES_CONTROLLED_WRITE_ENABLED', false),
      linkedinWrite: envBool('LINKEDIN_WRITE_ENABLED', false)
    };
  }

  mayPublish() {
    const g = this.gates();
    return g.dryRun === false && g.controlledWrite && g.linkedinWrite;
  }

  async open() {
    const cdp = clean(process.env.LINKEDIN_CDP_URL);
    const userDataDir = clean(process.env.LINKEDIN_USER_DATA_DIR) || path.join(this.rootDir, 'DATA', 'browser_profiles', 'linkedin_miles');
    fs.mkdirSync(userDataDir, { recursive: true });

    if (cdp) {
      this.browser = await chromium.connectOverCDP(cdp);
      const contexts = this.browser.contexts();
      if (!contexts.length) throw new Error('LINKEDIN_CDP_URL connected but no browser context is available.');
      this.context = contexts[0];
      this.page = this.context.pages()[0] || await this.context.newPage();
      this.ownsBrowser = false;
    } else {
      this.context = await chromium.launchPersistentContext(userDataDir, { headless: this.headless, slowMo: 75 });
      this.page = this.context.pages()[0] || await this.context.newPage();
      this.ownsBrowser = true;
    }
    await this.page.goto(this.targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    return this.page;
  }

  async close() {
    try {
      if (!this.ownsBrowser) return;
      if (this.context) await this.context.close();
      else if (this.browser) await this.browser.close();
    } catch {}
  }

  async screenshot(label) {
    fs.mkdirSync(this.outputDir, { recursive: true });
    const file = path.join(this.outputDir, `${label}_${stamp()}.png`);
    await this.page.screenshot({ path: file, fullPage: true }).catch(() => null);
    return file;
  }

  async sessionStatus() {
    const url = this.page.url();
    const body = await this.page.locator('body').innerText({ timeout: 10000 }).catch(() => '');
    const signedOut = /\/login|\/checkpoint|sign in|join now/i.test(`${url} ${body.slice(0, 3000)}`);
    const startPost = /start a post/i.test(body);
    return { loggedIn: !signedOut && startPost, url, startPostVisibleInBody: startPost };
  }

  async findStartPost() {
    const candidates = [
      this.page.getByRole('button', { name: /Start a post/i }),
      this.page.getByText(/Start a post/i).first(),
      this.page.locator('button').filter({ hasText: /Start a post/i }).first()
    ];
    for (const item of candidates) {
      if (await item.isVisible({ timeout: 1500 }).catch(() => false)) return item;
    }
    return null;
  }

  async findComposer() {
    const dialog = this.page.getByRole('dialog').last();
    const selectors = [
      '[contenteditable="true"][role="textbox"]',
      '.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"]'
    ];
    for (const selector of selectors) {
      const within = dialog.locator(selector);
      const count = await within.count().catch(() => 0);
      for (let i = 0; i < count; i += 1) {
        const item = within.nth(i);
        if (await item.isVisible().catch(() => false)) return item;
      }
    }
    return null;
  }

  async openComposer() {
    const trigger = await this.findStartPost();
    if (!trigger) return { ok: false, status: 'START_POST_CONTROL_NOT_FOUND' };
    await trigger.click();
    await sleep(750);
    const composer = await this.findComposer();
    return composer ? { ok: true, composer } : { ok: false, status: 'POST_COMPOSER_NOT_FOUND' };
  }

  async fillComposer(composer, text) {
    await composer.click();
    await this.page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => null);
    await this.page.keyboard.type(text, { delay: 1 });
  }

  async findPostButton() {
    const dialog = this.page.getByRole('dialog').last();
    const exact = dialog.getByRole('button', { name: /^Post$/i }).last();
    if (await exact.isVisible().catch(() => false)) return exact;
    const buttons = dialog.locator('button').filter({ hasText: /^Post$/i }).last();
    if (await buttons.isVisible().catch(() => false)) return buttons;
    return null;
  }

  async publishText(options = {}) {
    const text = clean(options.text);
    const contentId = clean(options.contentId);
    const report = {
      ok: false,
      service: 'LINKEDIN_CONTROLLED_PUBLISHER',
      generatedAt: new Date().toISOString(),
      contentId,
      targetUrl: this.targetUrl,
      requestedPublish: options.publish === true,
      gates: this.gates(),
      mutationExecuted: false
    };

    if (!text) {
      report.status = 'EMPTY_POST_TEXT';
      return this.persist(report);
    }

    try {
      await this.open();
      report.beforeScreenshot = await this.screenshot(`before_${contentId || 'post'}`);
      report.session = await this.sessionStatus();
      if (!report.session.loggedIn) {
        report.status = 'AUTHENTICATED_LINKEDIN_SESSION_REQUIRED';
        return this.persist(report);
      }

      if (options.publish !== true || !this.mayPublish()) {
        report.ok = true;
        report.status = 'CONTROLLED_DRY_RUN';
        report.wouldPublish = { contentId, text, targetUrl: this.targetUrl };
        return this.persist(report);
      }

      const opened = await this.openComposer();
      if (!opened.ok) {
        report.status = opened.status;
        return this.persist(report);
      }
      await this.fillComposer(opened.composer, text);
      report.composerScreenshot = await this.screenshot(`composer_${contentId || 'post'}`);
      const button = await this.findPostButton();
      if (!button) {
        report.status = 'POST_BUTTON_NOT_FOUND';
        return this.persist(report);
      }
      const disabled = await button.isDisabled().catch(() => false);
      if (disabled) {
        report.status = 'POST_BUTTON_DISABLED';
        return this.persist(report);
      }
      await button.click();
      await sleep(2000);
      report.afterScreenshot = await this.screenshot(`after_${contentId || 'post'}`);
      const body = await this.page.locator('body').innerText().catch(() => '');
      const stillComposer = /Create a post/i.test(body.slice(-5000)) && Boolean(await this.findComposer());
      if (stillComposer) {
        report.status = 'POST_SUBMISSION_UNCONFIRMED';
        return this.persist(report);
      }
      report.ok = true;
      report.status = 'POST_PUBLISHED';
      report.mutationExecuted = true;
      return this.persist(report);
    } catch (error) {
      report.status = 'LINKEDIN_PUBLISHER_EXCEPTION';
      report.error = error.message;
      return this.persist(report);
    } finally {
      await this.close();
    }
  }

  persist(report) {
    fs.mkdirSync(this.outputDir, { recursive: true });
    report.outputFile = path.join(this.outputDir, 'latest.json');
    fs.writeFileSync(report.outputFile, JSON.stringify(report, null, 2), 'utf8');
    return report;
  }
}

module.exports = LinkedInControlledPublisher;
module.exports.helpers = { envBool, clean, stamp };
