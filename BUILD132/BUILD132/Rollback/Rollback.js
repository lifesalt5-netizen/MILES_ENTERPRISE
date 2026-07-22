"use strict";
const fs = require("fs");
const path = require("path");
const backupDir = process.argv[2];
if (!backupDir) throw new Error("Usage: node Rollback.js <backup-directory>");
const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, "rollback_manifest.json"), "utf8"));
for (const record of manifest.records.slice().reverse()) {
  if (record.existed) {
    fs.mkdirSync(path.dirname(record.target), { recursive: true });
    fs.copyFileSync(record.backup, record.target);
  } else if (fs.existsSync(record.target)) {
    fs.unlinkSync(record.target);
  }
}
console.log(`${manifest.build} ROLLBACK COMPLETE`);
