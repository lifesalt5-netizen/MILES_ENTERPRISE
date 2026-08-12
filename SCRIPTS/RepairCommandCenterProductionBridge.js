'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..');
const target = path.join(ROOT, 'SERVICES', 'digital_coo', 'MilesCommandCenter.js');
const backup = `${target}.bak_command_bridge_${Date.now()}`;

if (!fs.existsSync(target)) {
  throw new Error(`COMMAND_CENTER_NOT_FOUND: ${target}`);
}

let source = fs.readFileSync(target, 'utf8');

const importNeedle = "const DigitalCOOHost = require('./DigitalCOOHost');\n";
const importReplacement = importNeedle + "const BusinessOperationsBridgeService = require('../BusinessOperationsBridgeService');\n";

if (!source.includes("require('../BusinessOperationsBridgeService')")) {
  if (!source.includes(importNeedle)) {
    throw new Error('PATCH_IMPORT_ANCHOR_NOT_FOUND');
  }
  source = source.replace(importNeedle, importReplacement);
}

const hostNeedle = "const host = new DigitalCOOHost({\n  rootDir: ROOT\n});\n";
const hostReplacement = hostNeedle + "\nconst businessBridge = new BusinessOperationsBridgeService({\n  rootDir: ROOT,\n  queueFile\n});\n";

if (!source.includes('const businessBridge = new BusinessOperationsBridgeService')) {
  if (!source.includes(hostNeedle)) {
    throw new Error('PATCH_BRIDGE_ANCHOR_NOT_FOUND');
  }
  source = source.replace(hostNeedle, hostReplacement);
}

const dispatchNeedle = `  let enqueueResult = null;\n\n  if (\n    host &&\n    typeof host.enqueueOperation === 'function'\n  ) {\n    enqueueResult = await host.enqueueOperation(operation);\n  }\n`;

const dispatchReplacement = `  let enqueueResult = null;\n\n  if (operation.approvalRequired) {\n    // Protected work remains visible to the Digital COO Host/CEO approval path.\n    if (host && typeof host.enqueueOperation === 'function') {\n      enqueueResult = await host.enqueueOperation(operation);\n    }\n  } else {\n    // Normal CEO directives use the production Business Operations Bridge.\n    // This converts the accepted operation into a WORKFORCE_STEP and routes it\n    // through the same governed execution path already validated end-to-end.\n    enqueueResult = await businessBridge.runOnce();\n  }\n`;

if (!source.includes('enqueueResult = await businessBridge.runOnce();')) {
  if (!source.includes(dispatchNeedle)) {
    throw new Error('PATCH_DISPATCH_ANCHOR_NOT_FOUND');
  }
  source = source.replace(dispatchNeedle, dispatchReplacement);
}

const required = [
  "require('../BusinessOperationsBridgeService')",
  'const businessBridge = new BusinessOperationsBridgeService',
  'enqueueResult = await businessBridge.runOnce();',
  'if (operation.approvalRequired)'
];

for (const marker of required) {
  if (!source.includes(marker)) {
    throw new Error(`PATCH_VALIDATION_FAILED: ${marker}`);
  }
}

fs.copyFileSync(target, backup);
fs.writeFileSync(target, source, 'utf8');

console.log(JSON.stringify({
  ok: true,
  gate: 'COMMAND_CENTER_PRODUCTION_BRIDGE_PATCH',
  target,
  backup,
  behavior: {
    normalCommands: 'BusinessOperationsBridgeService -> WORKFORCE_STEP',
    protectedCommands: 'DigitalCOOHost -> CEO approval path'
  },
  nextAction: 'RUN_NODE_CHECK_THEN_RESTART_MILES'
}, null, 2));
