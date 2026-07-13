const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const ROOT = process.cwd();

const PROFILE_DIR = path.join(
    ROOT,
    "DATA",
    "browser",
    "profiles",
    "miles-chrome"
);

const SCREENSHOT_DIR = path.join(
    ROOT,
    "DATA",
    "browser",
    "screenshots"
);

class BrowserManager {
    constructor() {
        this.context = null;
        this.pages = {};
    }

    ensureDirs() {
        fs.mkdirSync(PROFILE_DIR, { recursive: true });
        fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }

    async launch(headless = false) {
        this.ensureDirs();

        if (this.context) {
            return this.context;
        }

        this.context = await chromium.launchPersistentContext(
            PROFILE_DIR,
            {
                headless,
                channel: "chrome",
                slowMo: 75,
                viewport: null,
                args: [
                    "--start-maximized",
                    "--disable-blink-features=AutomationControlled"
                ]
            }
        );

        return this.context;
    }

    async openSystem(systemName, url, options = {}) {
        const context = await this.launch(options.headless || false);

        let page = this.pages[systemName.toLowerCase()];

        if (!page || page.isClosed()) {
            page = await context.newPage();
            this.pages[systemName.toLowerCase()] = page;
        }

        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        return {
            ok: true,
            system: systemName.toLowerCase(),
            url: page.url(),
            profile: PROFILE_DIR,
            persistentProfile: true,
            checkedAt: new Date().toISOString()
        };
    }

    async currentUrl(systemName) {
        const page = this.pages[systemName.toLowerCase()];

        if (!page || page.isClosed()) {
            return {
                ok: false,
                error: "No open page for " + systemName
            };
        }

        return {
            ok: true,
            system: systemName.toLowerCase(),
            url: page.url()
        };
    }

    async screenshot(systemName) {
        const page = this.pages[systemName.toLowerCase()];

        if (!page || page.isClosed()) {
            return {
                ok: false,
                error: "No open page for " + systemName
            };
        }

        const file = path.join(
            SCREENSHOT_DIR,
            `${systemName.toLowerCase()}_${Date.now()}.png`
        );

        await page.screenshot({
            path: file,
            fullPage: true
        });

        return {
            ok: true,
            system: systemName.toLowerCase(),
            screenshot: file
        };
    }

    async openKnownSystem(name, options = {}) {
        const systems = {
            linkedin: "https://www.linkedin.com/feed/",
            google: "https://mail.google.com/",
            ionos: "https://email.ionos.com/",
            namecheap: "https://ap.www.namecheap.com/domains/list/",
            calendly: "https://calendly.com/app/meetings/user/me",
            instantly: "https://app.instantly.ai/"
        };

        const key = String(name || "").toLowerCase();

        if (!systems[key]) {
            return {
                ok: false,
                error: "Unknown browser system: " + name,
                knownSystems: Object.keys(systems)
            };
        }

        return this.openSystem(key, systems[key], options);
    }

    async status() {
        return {
            ok: true,
            browserRunning: Boolean(this.context),
            profile: PROFILE_DIR,
            openSystems: Object.keys(this.pages),
            checkedAt: new Date().toISOString()
        };
    }

    async close() {
        if (this.context) {
            await this.context.close();
        }

        this.context = null;
        this.pages = {};
    }
}

module.exports = new BrowserManager();