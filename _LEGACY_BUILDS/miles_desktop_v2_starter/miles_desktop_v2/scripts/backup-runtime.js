const fs = require('fs');
const path = require('path');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join('BACKUPS', `desktop_backup_${stamp}`);
fs.mkdirSync(backupDir, { recursive: true });
for (const item of ['src', 'config', 'package.json']) {
  const dest = path.join(backupDir, item);
  fs.cpSync(item, dest, { recursive: true });
}
console.log(`Backup created: ${backupDir}`);
