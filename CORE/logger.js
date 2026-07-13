const fs = require('fs');
const path = require('path');

const ROOT = process.env.MILES_ROOT || 'D:\\P2GC_Intelligence\\MILES_OS';
const LOG_FILE = path.join(ROOT, 'MILES_EXECUTION_LOG.csv');

function ensureLog() {
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, 'Timestamp,System,Action,Result,Notes\n');
  }
}

function log(system, action, result, notes = '') {
  ensureLog();
  const safeNotes = String(notes).replace(/\r?\n/g, ' ').replace(/,/g, ';');
  fs.appendFileSync(LOG_FILE, `${new Date().toISOString()},${system},${action},${result},${safeNotes}\n`);
}

function info(action, notes = "") {
  log("MILES", action, "INFO", JSON.stringify(notes));
}

function warn(action, notes = "") {
  log("MILES", action, "WARN", JSON.stringify(notes));
}

function error(action, notes = "") {
  log("MILES", action, "ERROR", JSON.stringify(notes));
}

module.exports = {
  log,
  info,
  warn,
  error,
  ROOT
};
