'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const file = path.join(ROOT, 'StartMilesRemoteExecutionBridge.js');
let text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
const before = "  ORION_OFFICIAL_SOURCE_ACQUIRE_STAGING: ['node', ['SCRIPTS/AcquireOrionOfficialSourceToStaging.js']]\n});";
const after = "  ORION_OFFICIAL_SOURCE_ACQUIRE_STAGING: ['node', ['SCRIPTS/AcquireOrionOfficialSourceToStaging.js']],\n  ORION_OFFICIAL_ARCHIVE_INSPECTION: ['node', ['SCRIPTS/InspectOrionOfficialArchives.js']]\n});";
if (text.includes(after)) {
  console.log('ORION_ARCHIVE_INSPECTION_ALLOWLIST=ALREADY_CURRENT');
  process.exit(0);
}
const count = text.split(before).length - 1;
if (count !== 1) throw new Error(`ORION_ARCHIVE_INSPECTION_ALLOWLIST: expected one anchor, found ${count}`);
text = text.replace(before, after);
if (APPLY) fs.writeFileSync(file, text, 'utf8');
console.log(`ORION_ARCHIVE_INSPECTION_ALLOWLIST=${APPLY ? 'APPLIED' : 'DRY_RUN_OK'}`);
