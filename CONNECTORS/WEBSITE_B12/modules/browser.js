const { chromium } = require('playwright');

async function launchBrowser() {
  return await chromium.launch({
    headless: false,
    slowMo: 100
  });
}

module.exports = { launchBrowser };
