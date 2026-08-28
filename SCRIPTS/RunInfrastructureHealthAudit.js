'use strict';

const path = require('path');
const InfrastructureHealthAuditService = require('../SERVICES/runtime/InfrastructureHealthAuditService');

async function main() {
  const root = path.resolve(process.env.MILES_ROOT || path.resolve(__dirname, '..'));
  const audit = new InfrastructureHealthAuditService({ root, intervalHours: 72 });
  const dueBefore = audit.due();
  const result = await audit.run();
  const dueAfter = audit.due();

  const proof = {
    ok: result.ok === true,
    service: 'MILES_INFRASTRUCTURE_HEALTH_AUDIT_PROOF',
    mode: 'FORCED_READ_ONLY_PROOF',
    intervalHours: 72,
    dueBefore,
    dueAfter,
    observedAt: result.observedAt,
    result,
    safety: {
      arbitraryShell: false,
      destructiveActionsPerformed: false,
      providerMutation: false,
      sendsProspects: false,
      deletesEmail: false,
      changesDns: false,
      publishesB12: false
    }
  };

  console.log('MILES_INFRASTRUCTURE_HEALTH_AUDIT_PROOF');
  console.log(JSON.stringify(proof, null, 2));
  process.exitCode = proof.ok ? 0 : 2;
}

if (require.main === module) {
  main().catch(error => {
    console.error('MILES_INFRASTRUCTURE_HEALTH_AUDIT_PROOF_RED');
    console.error(error.stack || error.message);
    process.exitCode = 2;
  });
}

module.exports = { main };
