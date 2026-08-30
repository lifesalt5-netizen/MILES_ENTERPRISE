'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const file = path.join(ROOT, 'StartMilesRemoteExecutionBridge.js');
let text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');

function patch(before, after, label) {
  if (text.includes(after)) {
    console.log(`${label}=ALREADY_CURRENT`);
    return;
  }
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one anchor, found ${count}`);
  text = text.replace(before, after);
  console.log(`${label}=${APPLY ? 'APPLIED' : 'DRY_RUN_OK'}`);
}

patch(
  "const CONTROL_BRANCH = 'miles-control';\nconst DIRECTIVE_URL = process.env.MILES_REMOTE_DIRECTIVE_URL || `https://raw.githubusercontent.com/lifesalt5-netizen/MILES_ENTERPRISE/${CONTROL_BRANCH}/DATA/control/miles_remote_execution_directive.json`;",
  "const CONTROL_BRANCH = 'miles-control';\nconst DIRECTIVE_REPO_PATH = 'DATA/control/miles_remote_execution_directive.json';\nconst DIRECTIVE_URL = process.env.MILES_REMOTE_DIRECTIVE_URL || `https://raw.githubusercontent.com/lifesalt5-netizen/MILES_ENTERPRISE/${CONTROL_BRANCH}/${DIRECTIVE_REPO_PATH}`;\nlet controlDirectiveCache = { sha: null, directive: null };",
  'BRIDGE_CONTROL_REPO_PATH'
);

patch(
  "function run(command, args, label, options = {}) {",
  `async function getDirectiveViaGit() {\n  const ref = \`refs/heads/\${CONTROL_BRANCH}\`;\n  const remoteRef = \`refs/remotes/origin/\${CONTROL_BRANCH}\`;\n  const ls = await gitRun(['ls-remote', 'origin', ref], 'CONTROL-GIT', { quiet: true });\n  const line = requireSuccess(ls, 'CONTROL_GIT_LS_REMOTE_FAILED').split(/\\r?\\n/).find(Boolean) || '';\n  const sha = line.trim().split(/\\s+/)[0] || '';\n  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('CONTROL_GIT_REMOTE_SHA_INVALID');\n  if (controlDirectiveCache.sha === sha && controlDirectiveCache.directive) return controlDirectiveCache.directive;\n\n  requireSuccess(\n    await gitRun(['fetch', '--quiet', 'origin', \`+\${ref}:\${remoteRef}\`], 'CONTROL-GIT', { quiet: true }),\n    'CONTROL_GIT_FETCH_FAILED'\n  );\n  const shown = requireSuccess(\n    await gitRun(['show', \`\${sha}:\${DIRECTIVE_REPO_PATH}\`], 'CONTROL-GIT', { quiet: true }),\n    'CONTROL_GIT_SHOW_FAILED'\n  );\n  let directive;\n  try { directive = JSON.parse(shown); }\n  catch (error) { throw new Error(\`CONTROL_GIT_DIRECTIVE_JSON_INVALID:\${error.message}\`); }\n  controlDirectiveCache = { sha, directive };\n  return directive;\n}\n\nasync function getDirective() {\n  try { return await getDirectiveViaGit(); }\n  catch (error) {\n    console.error('[MILES REMOTE BRIDGE] CONTROL-GIT fallback:', error.message);\n    return getJson(\`\${DIRECTIVE_URL}?t=\${Date.now()}\`);\n  }\n}\n\nfunction run(command, args, label, options = {}) {`,
  'BRIDGE_GIT_DIRECTIVE_POLL'
);

patch(
  "  const directive = await getJson(`${DIRECTIVE_URL}?t=${Date.now()}`);",
  "  const directive = await getDirective();",
  'BRIDGE_TICK_GIT_DIRECTIVE'
);

patch(
  "  CONTROL_BRANCH,\n  DIRECTIVE_URL,",
  "  CONTROL_BRANCH,\n  DIRECTIVE_REPO_PATH,\n  DIRECTIVE_URL,",
  'BRIDGE_EXPORT_DIRECTIVE_PATH'
);

patch(
  "  validateDirective,\n  executeDirective,",
  "  validateDirective,\n  getDirectiveViaGit,\n  getDirective,\n  executeDirective,",
  'BRIDGE_EXPORT_GIT_DIRECTIVE'
);

if (APPLY) fs.writeFileSync(file, text, 'utf8');
console.log(APPLY ? 'REMOTE_BRIDGE_GIT_CONTROL_POLL_REPAIR_APPLIED' : 'REMOTE_BRIDGE_GIT_CONTROL_POLL_REPAIR_DRY_RUN_OK');
