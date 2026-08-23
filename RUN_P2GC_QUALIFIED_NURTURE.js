'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const QualifiedProspectNurtureService = require('./SERVICES/revenue/QualifiedProspectNurtureService');

async function main() {
  const rootDir = path.resolve(process.env.MILES_ROOT || process.cwd());
  const connector = require('./CONNECTORS/INSTANTLY/connector');
  const service = new QualifiedProspectNurtureService({ rootDir, connector });
  const execute = String(process.env.P2GC_NURTURE_EXECUTE || '').trim().toLowerCase() === 'true';
  const result = await service.runOnce({ execute });
  const outDir = path.join(rootDir, 'DATA', 'runtime', 'revenue', 'nurture');
  fs.mkdirSync(outDir, { recursive: true });
  const evidence = {
    ok: result?.ok !== false && result?.execution?.ok !== false,
    service: 'P2GC_QUALIFIED_NURTURE_RUNNER',
    generatedAt: new Date().toISOString(),
    executeRequested: execute,
    result
  };
  evidence.outputFile = path.join(outDir, 'run_once_latest.json');
  fs.writeFileSync(evidence.outputFile, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify(evidence, null, 2));
  if (!evidence.ok) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
