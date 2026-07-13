"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ENTERPRISE_ROOT || process.cwd();
const LOG_DIR = path.join(ROOT, "DATA", "canonical_runtime");
const LOG_FILE = path.join(LOG_DIR, "miles_runtime.log");

function ensure() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function write(level, message, data = {}) {
  ensure();
  const record = {
    ts: new Date().toISOString(),
    level,
    message,
    data
  };
  fs.appendFileSync(LOG_FILE, JSON.stringify(record) + "\n", "utf8");
  return record;
}

module.exports = {
  info: (message, data) => write("INFO", message, data),
  warn: (message, data) => write("WARN", message, data),
  error: (message, data) => write("ERROR", message, data),
  file: LOG_FILE
};
