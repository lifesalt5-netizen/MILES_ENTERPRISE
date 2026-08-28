'use strict';

require('dotenv').config();
const InstantlyLifecycleProofService = require('../SERVICES/revenue/InstantlyLifecycleProofService');

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(raw).trim().toLowerCase());
}

function mutationAllowed() {
  return envBool('MILES_DRY_RUN', true) === false &&
    envBool('MILES_ALLOW_INSTANTLY_MUTATIONS', false) === true &&
    envBool('MILES_CONTROLLED_WRITE_ENABLED', false) === true &&
    envBool('INSTANTLY_WRITE_ENABLED', false) === true;
}

function mismatchDetails(result) {
  return (Array.isArray(result?.decisions) ? result.decisions : [])
    .filter(item => item?.after?.verified !== true)
    .map(item => ({
      emailId: item.emailId || null,
      lead: item.lead || null,
      campaignId: item.campaignId || null,
      category: item.category || null,
      bucket: item.bucket || null,
      destinationId: item.destination?.id || null,
      destinationName: item.destination?.name || null,
      membershipVerified: item.after?.membership?.verified === true,
      membershipReason: item.after?.membership?.reason || null,
      observedListId: item.after?.membership?.observedListId || null,
      interestVerified: item.after?.interest?.verified === true,
      interestExpected: item.after?.interest?.expected ?? null,
      interestObserved: item.after?.interest?.observed ?? null,
      repairAttempted: item.repairAttempted === true
    }));
}

(async () => {
  const execute = process.argv.includes('--execute');

  if (execute) {
    // Open only the controlled Instantly lifecycle write surface for this governed job.
    process.env.MILES_DRY_RUN = 'false';
    process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = 'true';
    process.env.MILES_CONTROLLED_WRITE_ENABLED = 'true';
    process.env.INSTANTLY_WRITE_ENABLED = 'true';

    // Explicitly keep unrelated mutation surfaces closed.
    process.env.MILES_IONOS_MAILBOX_MUTATIONS = 'false';
    process.env.P2GC_B12_PUBLISH = 'false';
  }

  const preflight = {
    execute,
    dryRun: envBool('MILES_DRY_RUN', true),
    allowInstantlyMutations: envBool('MILES_ALLOW_INSTANTLY_MUTATIONS', false),
    controlledWriteEnabled: envBool('MILES_CONTROLLED_WRITE_ENABLED', false),
    instantlyWriteEnabled: envBool('INSTANTLY_WRITE_ENABLED', false),
    mutationAllowed: execute ? mutationAllowed() : false,
    ionosMailboxMutations: envBool('MILES_IONOS_MAILBOX_MUTATIONS', false),
    b12Publish: envBool('P2GC_B12_PUBLISH', false)
  };
  console.log(`INSTANTLY_EXECUTION_PREFLIGHT=${JSON.stringify(preflight)}`);

  if (execute && !preflight.mutationAllowed) {
    throw new Error('INSTANTLY_EXECUTION_PREFLIGHT_FAILED');
  }

  const result = await new InstantlyLifecycleProofService().run({ execute });
  const mismatches = mismatchDetails(result);
  console.log(JSON.stringify(result, null, 2));
  console.log(`INSTANTLY_LIFECYCLE_DIAGNOSTICS=${JSON.stringify({
    execute,
    mutationAllowed: preflight.mutationAllowed,
    inspected: Number(result.inspected || 0),
    providerVerifiedCorrect: Number(result.providerVerifiedCorrect || 0),
    providerMismatches: Number(result.providerMismatches || 0),
    repaired: Number(result.repaired || 0),
    errors: Array.isArray(result.errors) ? result.errors.length : 0,
    missingDestinations: Object.values(result.destinations || {}).filter(x => x?.missing === true || !x?.id).length,
    mismatches
  })}`);
  process.exitCode = result.ok ? 0 : 2;
})().catch(error => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
