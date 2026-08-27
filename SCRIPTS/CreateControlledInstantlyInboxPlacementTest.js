'use strict';

const fs = require('fs');
const path = require('path');
const instantly = require('../CONNECTORS/INSTANTLY/instantly');
const { InstantlyInboxPlacementTestService } = require('../SERVICES/revenue/InstantlyInboxPlacementTestService');

(async () => {
  const execute = process.argv.includes('--execute');
  const forceNew = process.argv.includes('--force-new');
  const root = path.resolve(process.env.MILES_ROOT || process.cwd());
  const outputDir = path.join(root, 'DATA', 'runtime', 'revenue', 'deliverability');
  const output = path.join(outputDir, 'instantly_inbox_placement_test_creation_latest.json');
  const service = new InstantlyInboxPlacementTestService({ client: instantly });

  console.log('============================================================');
  console.log('P2GC CONTROLLED INSTANTLY INBOX PLACEMENT TEST');
  console.log('============================================================');

  try {
    if (!execute) {
      const plan = await service.buildPlan({ forceNew });
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(output, JSON.stringify({ mode: 'PLAN_ONLY', generatedAt: new Date().toISOString(), ...plan }, null, 2));
      console.log(`Mode: PLAN ONLY`);
      console.log(`Force new post-DMARC evidence: ${forceNew ? 'YES' : 'NO'}`);
      console.log(`Active accounts: ${plan.activeAccounts.length}`);
      console.log(`Eligible senders: ${plan.eligibleSenders.length}`);
      console.log(`Zero-limit senders: ${plan.zeroLimitSenders.length}`);
      console.log(`Google/Microsoft NA provider options: ${plan.providerLabels.length}`);
      console.log(`Existing controlled test: ${plan.existingTest ? 'YES' : 'NO'}`);
      if (plan.blockers.length) console.log(`BLOCKERS: ${plan.blockers.join(', ')}`);
      console.log(`Report: ${output}`);
      console.log(plan.ready || plan.existingTest ? 'RESULT: CONTROLLED_INBOX_PLACEMENT_PLAN_READY' : 'RESULT: CONTROLLED_INBOX_PLACEMENT_PLAN_BLOCKED');
      if (!plan.ready && !plan.existingTest) process.exitCode = 2;
      return;
    }

    const result = await service.createControlledBaseline({ forceNew });
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(output, JSON.stringify({ mode: 'EXECUTE', generatedAt: new Date().toISOString(), ...result }, null, 2));

    if (!result.ok) {
      console.log(`RESULT: CONTROLLED_INBOX_PLACEMENT_CREATE_BLOCKED`);
      console.log(`BLOCKERS: ${(result.plan?.blockers || []).join(', ') || result.status || 'UNKNOWN'}`);
      console.log(`Report: ${output}`);
      process.exitCode = 2;
      return;
    }

    console.log(`Test: ${result.plan.name}`);
    console.log(`Created: ${result.created ? 'YES' : 'NO - EXISTING TEST REUSED'}`);
    console.log(`Force new post-DMARC evidence: ${forceNew ? 'YES' : 'NO'}`);
    console.log(`Test ID: ${result.testId || result.test?.id || 'UNKNOWN'}`);
    console.log(`Senders: ${result.plan.eligibleSenders.length}`);
    console.log(`Provider options: ${result.plan.providerLabels.length}`);
    console.log(`External read-back verified: ${result.externalReadbackVerified === true || result.reused === true ? 'YES' : 'NO'}`);
    console.log(`Provider status: ${result.test?.status ?? 'UNKNOWN'}`);
    console.log(`Not-sending status: ${result.test?.not_sending_status || 'NONE'}`);
    console.log(`Report: ${output}`);
    console.log('RESULT: CONTROLLED_INBOX_PLACEMENT_TEST_CREATED_OR_REUSED');
  } catch (error) {
    const msg = String(error?.message || error);
    console.error(msg);
    if (/402|payment required|paid plan/i.test(msg)) console.log('BLOCKER: INSTANTLY_INBOX_PLACEMENT_PLAN_REQUIRED');
    else if (/401|403|unauthorized|forbidden|scope/i.test(msg)) console.log('BLOCKER: INSTANTLY_API_KEY_REQUIRES_INBOX_PLACEMENT_WRITE_SCOPE');
    else if (/daily.?limit|test.?limit/i.test(msg)) console.log('BLOCKER: INBOX_PLACEMENT_ACCOUNT_TEST_LIMIT');
    console.log('RESULT: CONTROLLED_INBOX_PLACEMENT_TEST_CREATE_RED');
    process.exitCode = 1;
  }
})();
