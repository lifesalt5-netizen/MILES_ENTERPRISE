const fs = require('fs');
const { executionLog } = require('./paths');

function log(action, result, notes = '') {
  if (!fs.existsSync(executionLog)) {
    fs.writeFileSync(executionLog, 'Timestamp,System,Action,Result,Notes\n');
  }
  fs.appendFileSync(executionLog, `${new Date().toISOString()},WEBSITE_B12,${action},${result},${String(notes).replace(/,/g, ';')}\n`);
}

module.exports = { log };
