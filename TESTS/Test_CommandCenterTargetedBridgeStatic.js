'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, '..');
const commandCenter = path.join(ROOT, 'SERVICES', 'digital_coo', 'MilesCommandCenter.js');
const bridgeService = path.join(ROOT, 'SERVICES', 'BusinessOperationsBridgeService.js');

const commandSource = fs.readFileSync(commandCenter, 'utf8');
const bridgeSource = fs.readFileSync(bridgeService, 'utf8');

const checks = {
  bridgeImported: commandSource.includes("require('../BusinessOperationsBridgeService')"),
  bridgeInstantiated: commandSource.includes('const businessBridge = new BusinessOperationsBridgeService'),
  normalTargetedBridge: commandSource.includes('businessBridge.bridgeOperation(operation.id)'),
  approvalTargetedBridge: commandSource.includes('businessBridge.bridgeOperation(operationId)'),
  targetedBridgeMethod: bridgeSource.includes('async bridgeOperation(operationId)'),
  workforceStepEvidence: bridgeSource.includes('taskType: "WORKFORCE_STEP"'),
  noRunOnceSweepFromCommandCenter: !commandSource.includes('enqueueResult = await businessBridge.runOnce();')
};

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
const result = {
  ok: failed.length === 0,
  gate: 'COMMAND_CENTER_TARGETED_BRIDGE_STATIC',
  checks,
  failed,
  expectedFlow: {
    normal: 'COMMAND_CENTER -> bridgeOperation(operation.id) -> WORKFORCE_STEP',
    approved: 'APPROVE -> READY -> bridgeOperation(operationId) -> WORKFORCE_STEP'
  }
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
