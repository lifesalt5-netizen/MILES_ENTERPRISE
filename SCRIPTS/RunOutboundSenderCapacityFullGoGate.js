'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(process.env.MILES_ROOT || path.resolve(__dirname, '..'));
const AUDIT = path.join(ROOT, 'SCRIPTS', 'AUDIT_OUTBOUND_SENDER_CAPACITY_V2.js');

function parse(stdout = '') {
  const text = String(stdout || '');
  const number = label => {
    const match = text.match(new RegExp(`${label}:\\s*(\\d+)`, 'i'));
    return match ? Number(match[1]) : null;
  };
  const missing = text.match(/Zero-cost target missing from Instantly:\s*([^\r\n]+)/i)?.[1]?.trim() || null;
  const marker = text.match(/ZERO_COST_SENDER_CAPACITY_FULL_GO=(YES|NO)/i)?.[1]?.toUpperCase() || 'MISSING';
  return {
    marker,
    target: number('Zero-cost paid-seat target'),
    connected: number('Zero-cost target connected'),
    governedActive: number('Zero-cost target governed ACTIVE'),
    missing
  };
}

function run() {
  const child = spawnSync(process.execPath, [AUDIT], {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000
  });

  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);

  const parsed = parse(child.stdout);
  const auditExitedCleanly = child.status === 0;
  const green = auditExitedCleanly && parsed.marker === 'YES' && parsed.target === 13 && parsed.connected === 13 && parsed.governedActive === 13;

  console.log('OUTBOUND_SENDER_CAPACITY_FULL_GO_GATE');
  console.log(JSON.stringify({
    ok: green,
    status: green ? 'ZERO_COST_SENDER_CAPACITY_FULL_GO' : 'ZERO_COST_SENDER_CAPACITY_NOT_FULL_GO',
    auditExitCode: child.status,
    ...parsed,
    requirements: {
      alreadyPaidIndependentSeats: 13,
      connected: 13,
      governedActiveWithCurrentPlacementAndAuthentication: 13,
      aliasesCount: 0,
      newWorkspaceLicenses: 0,
      protectedPrimaryDomainExcluded: true
    }
  }, null, 2));

  process.exitCode = green ? 0 : 2;
  return green;
}

if (require.main === module) run();
module.exports = { parse, run };
