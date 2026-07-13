const fs = require("fs");
const path = require("path");

class Logger {
  constructor(options = {}) {
    this.logDir = options.logDir || path.join(process.cwd(), "logs");
    this.logFile = options.logFile || path.join(this.logDir, "miles.log");
    if (!fs.existsSync(this.logDir)) fs.mkdirSync(this.logDir, { recursive: true });
  }

  _write(level, message, meta = {}) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      message,
      meta,
    };
    const line = JSON.stringify(entry);
    fs.appendFileSync(this.logFile, line + "\n");
    console.log(`[${level}] ${message}`);
  }

  info(message, meta) { this._write("INFO", message, meta); }
  warn(message, meta) { this._write("WARN", message, meta); }
  error(message, meta) { this._write("ERROR", message, meta); }
}

module.exports = new Logger();
