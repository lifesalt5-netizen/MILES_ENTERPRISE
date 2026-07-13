const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const root = 'D:\\P2GC_Intelligence\\MILES_OS';
  const screenshotDir = path.join(root, 'WEBSITE_OPS', 'WEBSITE_SCREENSHOTS');
  const logFile = path.join(root, 'MILES_EXECUTION_LOG.csv');

  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('https://b12.io/dashboard/', { waitUntil: 'domcontentloaded' });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const shot = path.join(screenshotDir, `b12_observer_${ts}.png`);

  await page.screenshot({ path: shot, fullPage: true });

  fs.appendFileSync(
    logFile,
    `\n${new Date().toISOString()},WEBSITE_B12,Observer screenshot captured,Success,${shot}`
  );

  console.log('B12 observer complete.');
  console.log(`Screenshot saved: ${shot}`);
})();