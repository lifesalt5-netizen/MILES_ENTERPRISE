"use strict";

const fs = require("fs");
const path = require("path");
const browser = require("./BrowserSessionManager");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const SESSION_DIR = path.join(ROOT, "DATA", "browser", "sessions");

function ensureDir() {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

class BrowserSessionEnroller {
  constructor() {
    ensureDir();
  }

  async enroll(system = "instantly", url) {
    const targetUrl =
      url ||
      this.defaultUrl(system);

    console.log("");
    console.log("========================================");
    console.log(" MILES SESSION ENROLLMENT MODE");
    console.log("========================================");
    console.log("");
    console.log("System:", system);
    console.log("URL:", targetUrl);
    console.log("");
    console.log("INSTRUCTIONS:");
    console.log("1. A browser will open");
    console.log("2. MANUALLY log in once");
    console.log("3. DO NOT CLOSE until told");
    console.log("4. Return here after login");
    console.log("");

    const page = await browser.newPage(system, {
      headless: false
    });

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    console.log("");
    console.log("LOGIN COMPLETE?");
    console.log("When logged in, press ENTER in terminal...");

    await this.waitForEnter();

    await browser.saveSession(system);

    console.log("");
    console.log("SESSION SAVED");
    console.log("System:", system);
    console.log("You will NOT need to log in again.");
    console.log("");

    await browser.shutdown();

    return {
      ok: true,
      system,
      status: "ENROLLED"
    };
  }

  defaultUrl(system) {
    switch (system.toLowerCase()) {
      case "instantly":
        return "https://app.instantly.ai";
      case "google":
        return "https://mail.google.com";
      case "namecheap":
        return "https://ap.www.namecheap.com";
      default:
        return "https://google.com";
    }
  }

  waitForEnter() {
    return new Promise(resolve => {
      process.stdin.resume();
      process.stdin.once("data", () => resolve());
    });
  }
}

module.exports = new BrowserSessionEnroller();