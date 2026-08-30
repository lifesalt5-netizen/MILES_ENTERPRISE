'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');

function patch(rel, before, after, label) {
  const file = path.join(ROOT, rel);
  let text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  if (text.includes(after)) {
    console.log(`${label}=ALREADY_CURRENT`);
    return;
  }
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one anchor, found ${count}`);
  text = text.replace(before, after);
  if (APPLY) fs.writeFileSync(file, text, 'utf8');
  console.log(`${label}=${APPLY ? 'APPLIED' : 'DRY_RUN_OK'}`);
}

patch(
  'StartMilesRemoteExecutionBridge.js',
  `const SUPERVISED_RESTART_EXIT_CODE = 75;\nlet evidencePublishTail = Promise.resolve();`,
  `const SUPERVISED_RESTART_EXIT_CODE = 75;\nconst CONTROL_OWNER_RESTART_EXIT_CODE = 76;\nlet evidencePublishTail = Promise.resolve();`,
  'BRIDGE_CONTROL_OWNER_EXIT_CODE'
);

patch(
  'StartMilesRemoteExecutionBridge.js',
  `  try {\n    record.evidence = await publishEvidenceSerialized(evidence);\n  } catch (error) {\n    record.evidence = { ok: false, error: error.message };\n    state.lastResult = record;\n    writeState(state);\n  }\n  return record;`,
  `  try {\n    record.evidence = await publishEvidenceSerialized(evidence);\n  } catch (error) {\n    record.evidence = { ok: false, error: error.message };\n    state.lastResult = record;\n    writeState(state);\n  }\n\n  // The consolidated deploy changes code loaded by the autonomous COO runtime.\n  // Only after final state and evidence are safely persisted may the supervised\n  // bridge request a whole control-owner recycle. Exit 76 is interpreted by the\n  // supervisor as a PM2/runtime-guard restart request rather than a bridge-only\n  // restart, eliminating detached restart helpers and post-deploy control gaps.\n  if (\n    BRIDGE_SUPERVISED &&\n    directive.job === 'COO_CONSOLIDATED_SELF_MAINTENANCE_DEPLOY' &&\n    result.code === 0\n  ) {\n    console.log(\`[MILES REMOTE BRIDGE] CONTROL_OWNER_RESTART_REQUESTED exit=\${CONTROL_OWNER_RESTART_EXIT_CODE}\`);\n    setTimeout(() => process.exit(CONTROL_OWNER_RESTART_EXIT_CODE), 0);\n  }\n  return record;`,
  'BRIDGE_POST_EVIDENCE_CONTROL_OWNER_RESTART'
);

patch(
  'StartMilesRemoteExecutionBridge.js',
  `  SUPERVISED_RESTART_EXIT_CODE,\n  validateDirective,`,
  `  SUPERVISED_RESTART_EXIT_CODE,\n  CONTROL_OWNER_RESTART_EXIT_CODE,\n  validateDirective,`,
  'BRIDGE_EXPORT_CONTROL_OWNER_EXIT_CODE'
);

patch(
  'SERVICES/runtime/RemoteExecutionBridgeSupervisor.js',
  `const { spawn } = require('child_process');\n\nclass RemoteExecutionBridgeSupervisor {`,
  `const { spawn } = require('child_process');\n\nconst CONTROL_OWNER_RESTART_EXIT_CODE = 76;\n\nclass RemoteExecutionBridgeSupervisor {`,
  'SUPERVISOR_CONTROL_OWNER_EXIT_CODE'
);

patch(
  'SERVICES/runtime/RemoteExecutionBridgeSupervisor.js',
  `    child.once('exit', (code, signal) => {\n      this.child = null;\n      this.writeState({ status: 'BRIDGE_EXITED', exitCode: code, signal: signal || null });\n      if (!this.running || !this.ownsLock) return;\n      this.restartCount += 1;`,
  `    child.once('exit', (code, signal) => {\n      this.child = null;\n      this.writeState({ status: 'BRIDGE_EXITED', exitCode: code, signal: signal || null });\n      if (!this.running || !this.ownsLock) return;\n      if (Number(code) === CONTROL_OWNER_RESTART_EXIT_CODE) {\n        this.running = false;\n        this.writeState({ status: 'CONTROL_OWNER_RESTART_REQUESTED', exitCode: code, signal: signal || null });\n        this.releaseLock();\n        setTimeout(() => process.exit(CONTROL_OWNER_RESTART_EXIT_CODE), 0);\n        return;\n      }\n      this.restartCount += 1;`,
  'SUPERVISOR_ESCALATE_CONTROL_OWNER_RESTART'
);

patch(
  'SERVICES/runtime/RemoteExecutionBridgeSupervisor.js',
  `module.exports = RemoteExecutionBridgeSupervisor;`,
  `RemoteExecutionBridgeSupervisor.CONTROL_OWNER_RESTART_EXIT_CODE = CONTROL_OWNER_RESTART_EXIT_CODE;\nmodule.exports = RemoteExecutionBridgeSupervisor;`,
  'SUPERVISOR_EXPORT_CONTROL_OWNER_EXIT_CODE'
);

patch(
  'SCRIPTS/DeployConsolidatedCOOSelfMaintenance.js',
  `  let autonomousRestart = { mode: 'IMMEDIATE' };\n  if (REMOTE_BRIDGE_SUPERVISED) {\n    autonomousRestart = {\n      mode: 'DELAYED_AFTER_REMOTE_EVIDENCE',\n      ...scheduleDelayedRestart(byName.get('miles-autonomous-coo'))\n    };\n  }`,
  `  const autonomousRestart = REMOTE_BRIDGE_SUPERVISED\n    ? { mode: 'SUPERVISOR_AFTER_REMOTE_EVIDENCE' }\n    : { mode: 'IMMEDIATE' };`,
  'DEPLOY_REMOVE_DETACHED_CONTROL_OWNER_RESTART'
);

console.log(APPLY ? 'BRIDGE_COORDINATED_CONTROL_OWNER_RESTART_REPAIR_APPLIED' : 'BRIDGE_COORDINATED_CONTROL_OWNER_RESTART_REPAIR_DRY_RUN_OK');
