'use strict';

const fs = require('fs');

const name = String(process.argv[2] || '').trim();
if (!name) {
  process.stderr.write('PM2_PROCESS_NAME_REQUIRED');
  process.exit(2);
}

let rows;
try {
  rows = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch (error) {
  process.stderr.write(`PM2_JLIST_JSON_PARSE_FAILED:${error.message}`);
  process.exit(2);
}

const row = Array.isArray(rows)
  ? rows.find(item => String(item && item.name) === name)
  : null;

if (!row) {
  process.stdout.write('NOT_FOUND');
  process.exit(0);
}

const status = String(row.pm2_env && row.pm2_env.status || '');
process.stdout.write(`FOUND\t${status}`);
