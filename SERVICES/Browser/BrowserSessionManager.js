"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const BROWSER_DIR = path.join(ROOT, "DATA", "browser");
const SESSION_DIR = path.join(BROWSER_DIR, "sessions");
const SCREENSHOT_DIR = path.join(BROWSER_DIR, "screenshots");

function ensureDirs() {
  fs.mkdirSync(BROWSER_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function safeName(value) {
  return String(value || "browser")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
}

class BrowserSessionManager {
  constructor() {
    ensureDirs();
    this.browser = null;
    this.contexts = {};
  }

  sessionFile(name) {
    return path.join(SESSION_DIR, `${safeName(name)}.json`);
  }

  async launch(options = {}) {
    if (this.browser) return this.browser;

    this.browser = await chromium.launch({
      headless: options.headless !== false,
      slowMo: Number(process.env.MILES_BROWSER_SLOWMO || 0)
    });

    return this.browser;
  }

  async getContext(name = "default", options = {}) {
    ensureDirs();

    if (this.contexts[name]) {
      return this.contexts[name];
    }

    const browser = await this.launch(options);
    const storageStatePath = this.sessionFile(name);

    const contextOptions = {
      viewport: {
        width: Number(process.env.MILES_BROWSER_WIDTH || 1440),
        height: Number(process.env.MILES_BROWSER_HEIGHT || 900)
      }
    };

    if (fs.existsSync(storageStatePath)) {
      contextOptions.storageState = storageStatePath;
    }

    const context = await browser.newContext(contextOptions);
    this.contexts[name] = context;

    return context;
  }

  async newPage(name = "default", options = {}) {
    const context = await this.getContext(name, options);
    return await context.newPage();
  }

  async saveSession(name = "default") {
    const context = this.contexts[name];

    if (!context) {
      return {
        ok: false,
        reason: `No context exists for ${name}`
      };
    }

    const file = this.sessionFile(name);
    await context.storageState({ path: file });

    return {
      ok: true,
      session: name,
      file
    };
  }

  async screenshot(page, label = "screenshot") {
    ensureDirs();

    const file = path.join(
      SCREENSHOT_DIR,
      `${safeName(label)}_${Date.now()}.png`
    );

    await page.screenshot({
      path: file,
      fullPage: true
    });

    return file;
  }

  async closeContext(name = "default") {
    const context = this.contexts[name];

    if (!context) {
      return {
        ok: true,
        status: "NO_CONTEXT"
      };
    }

    await context.close();
    delete this.contexts[name];

    return {
      ok: true,
      status: "CLOSED"
    };
  }

  async shutdown() {
    for (const name of Object.keys(this.contexts)) {
      await this.closeContext(name);
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    return {
      ok: true,
      status: "SHUTDOWN"
    };
  }

  status() {
    return {
      ok: true,
      browserRunning: Boolean(this.browser),
      contexts: Object.keys(this.contexts),
      sessionDir: SESSION_DIR,
      screenshotDir: SCREENSHOT_DIR
    };
  }
}

module.exports = new BrowserSessionManager();