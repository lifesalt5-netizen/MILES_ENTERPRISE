'use strict';

const path = require('path');
const OrionOfficialArchiveInspectorService = require('../SERVICES/orion/OrionOfficialArchiveInspectorService');

async function main() {
  const rootDir = path.resolve(process.argv[2] || process.env.MILES_ROOT || path.resolve(__dirname, '..'));
  const result = await new OrionOfficialArchiveInspectorService({ rootDir }).run();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 2;
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({ ok: false, service: 'ORION_OFFICIAL_ARCHIVE_INSPECTION', error: error.message }, null, 2));
    process.exitCode = 2;
  });
}
