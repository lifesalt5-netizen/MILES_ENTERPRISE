'use strict';

require('dotenv').config();
const path = require('path');
const QualifiedProspectNurtureService = require('./SERVICES/revenue/QualifiedProspectNurtureService');

async function main() {
  const rootDir = path.resolve(process.env.MILES_ROOT || process.cwd());
  const connector = require('./CONNECTORS/INSTANTLY/connector');
  const service = new QualifiedProspectNurtureService({ rootDir, connector });
  const execute = String(process.env.P2GC_NURTURE_EXECUTE || '').trim().toLowerCase() === 'true';
  const result = await service.runOnce({ execute });
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
