const { launchBrowser } = require('./modules/browser');
const { detectSession } = require('./modules/session');
const { capture } = require('./modules/screenshots');
const { writeAudit } = require('./modules/audit');
const { log } = require('./modules/logger');

async function main() {
  console.log('MILES B12 Controller v1.0 starting...');
  const browser = await launchBrowser();
  const page = await browser.newPage();

  await page.goto('https://b12.io/dashboard/', { waitUntil: 'domcontentloaded' });

  const session = await detectSession(page);
  const screenshot = await capture(page, 'b12_controller');
  const auditFile = writeAudit(session, screenshot);

  log('Controller observe/audit run', 'Success', `screenshot=${screenshot}; audit=${auditFile}`);

  console.log('B12 Controller complete.');
  console.log('Logged in:', session.loggedIn);
  console.log('Current URL:', session.url);
  console.log('Screenshot:', screenshot);
  console.log('Audit:', auditFile);

  console.log('Browser left open for 15 seconds for inspection...');
  await page.waitForTimeout(15000);
  await browser.close();
}

main().catch(err => {
  console.error(err);
  try { log('Controller error', 'Failure', err.message); } catch {}
  process.exit(1);
});
