const fs = require('fs');
const path = require('path');
const { screenshotDir } = require('./paths');

async function capture(page, prefix = 'b12') {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(screenshotDir, `${prefix}_${ts}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

module.exports = { capture };
