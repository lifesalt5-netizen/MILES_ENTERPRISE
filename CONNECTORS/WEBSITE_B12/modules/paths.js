const path = require('path');
const ROOT = process.env.MILES_ROOT || 'D:\\P2GC_Intelligence\\MILES_OS';

module.exports = {
  ROOT,
  screenshotDir: path.join(ROOT, 'WEBSITE_OPS', 'WEBSITE_SCREENSHOTS'),
  executionLog: path.join(ROOT, 'MILES_EXECUTION_LOG.csv'),
  changeQueue: path.join(ROOT, 'WEBSITE_OPS', 'WEBSITE_CHANGE_QUEUE.csv'),
  approvalQueue: path.join(ROOT, 'WEBSITE_OPS', 'WEBSITE_APPROVAL_QUEUE.csv'),
  outputDir: path.join(ROOT, 'CONNECTORS', 'WEBSITE_B12', 'output')
};
