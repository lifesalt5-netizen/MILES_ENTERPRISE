'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const ROOT = path.resolve(process.env.MILES_ROOT || process.cwd());
const ionos = require('../CONNECTORS/IONOS/imap_readonly');

async function main() {
  const check = await ionos.healthCheckAll();
  const result = {
    ok: check.ok === true,
    gate: 'IONOS_PRIMARY_INBOX_READABILITY',
    generatedAt: new Date().toISOString(),
    mailboxes: (check.mailboxes || []).map(row => ({
      email: row.email,
      ok: row.ok === true,
      host: row.host,
      port: row.port,
      inboxExists: row.inboxExists ?? null,
      readOnly: true,
      error: row.ok ? null : row.error
    })),
    safety: {
      readOnly: true,
      noMessageMutation: true,
      noSmtp: true,
      noForwardingChange: true,
      noDnsChange: true,
      secretsPrinted: false
    }
  };

  const outDir = path.join(ROOT, 'DATA', 'operational_acceptance', 'ionos_inbox_readability');
  fs.mkdirSync(outDir, { recursive: true });
  result.outputFile = path.join(outDir, 'IONOS_INBOX_READABILITY_LATEST.json');
  fs.writeFileSync(result.outputFile, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
