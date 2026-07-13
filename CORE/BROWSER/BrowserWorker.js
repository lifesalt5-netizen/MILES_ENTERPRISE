const browser = require("./BrowserManager");

class BrowserWorker {
    constructor() {
        this.systems = {
            linkedin: "https://www.linkedin.com/feed/",
            google: "https://mail.google.com/",
            ionos: "https://email.ionos.com/",
            namecheap: "https://ap.www.namecheap.com/domains/list/",
            calendly: "https://calendly.com/app/meetings/user/me",
            instantly: "https://app.instantly.ai/app/accounts"
        };
    }

    async healthCheck(system) {
        const key = String(system || "").toLowerCase();

        if (!this.systems[key]) {
            return {
                ok: false,
                error: "Unknown browser system: " + system,
                knownSystems: Object.keys(this.systems)
            };
        }

        try {
            const opened = await browser.openKnownSystem(key, { headless: false });

            await new Promise(resolve => setTimeout(resolve, 3000));

            const current = await browser.currentUrl(key);
            const screenshot = await browser.screenshot(key);

            return {
                ok: true,
                system: key,
                opened,
                current,
                screenshot,
                checkedAt: new Date().toISOString()
            };
        } catch (err) {
            return {
                ok: false,
                system: key,
                error: err.message,
                checkedAt: new Date().toISOString()
            };
        }
    }

    async inspect(system) {
        const key = String(system || "").toLowerCase();

        if (!this.systems[key]) {
            return {
                ok: false,
                error: "Unknown browser system: " + system
            };
        }

        try {
            await browser.openKnownSystem(key, { headless: false });

            const page = browser.pages[key];

            if (!page || page.isClosed()) {
                return {
                    ok: false,
                    error: "No active page for " + key
                };
            }

            const title = await page.title();
            const url = page.url();

            const bodyText = await page.locator("body").innerText({
                timeout: 10000
            }).catch(() => "");

            return {
                ok: true,
                system: key,
                title,
                url,
                textPreview: bodyText.slice(0, 2000),
                checkedAt: new Date().toISOString()
            };
        } catch (err) {
            return {
                ok: false,
                system: key,
                error: err.message,
                checkedAt: new Date().toISOString()
            };
        }
    }

    async close() {
        await browser.close();
    }
}

module.exports = new BrowserWorker();