'use strict';

const assert = require('assert');
const Planner = require('../SERVICES/BusinessWorkPlannerService');
const { BusinessExecutionEngineServiceV2 } = require('../SERVICES/BusinessExecutionEngineServiceV2');
const MilesConnector = require('../CONNECTORS/MILES/connector');

async function main() {
  let checks = 0;
  const check = (condition, message) => {
    assert.ok(condition, message);
    checks += 1;
  };

  const reviewOnly = 'Miles, review Instantly deliverability. Do not send or change anything.';
  check(Planner.isReadOnlyReview(reviewOnly) === true, 'review-only guardrail should remain read-only');

  const explicitReadOnly = 'Miles, perform a read-only review of the GSA holder data. Do not execute changes.';
  check(Planner.isReadOnlyReview(explicitReadOnly) === true, 'explicit read-only GSA review should remain read-only');

  const gsaExecution = [
    'MILES — CONTINUE GSA VENDOR INGEST / RECONCILIATION.',
    'Refresh the current authoritative GSA vendor universe.',
    'Reconcile current GSA holders, join USAspending awards, rebuild segmentation, and produce staging outputs.',
    'Do not send to Instantly.',
    'Execute now and return the acceptance report plus exact output locations.'
  ].join(' ');

  check(Planner.isReadOnlyReview(gsaExecution) === false, 'scoped Instantly guardrail must not cancel GSA execution');
  check(Planner.isGovernmentDataMission(gsaExecution) === true, 'GSA execution must classify as government-data mission');

  const plan = await Planner.plan({ objective: gsaExecution });
  check(plan.mode === 'GOVERNMENT_DATA_EXECUTION', 'GSA mission must use government-data execution mode');
  check(plan.readOnly === false, 'GSA execution plan must not be read-only');
  check(plan.workPackageCount === 1, 'GSA execution must emit an executable work package');
  check(plan.workPackages[0].action === 'GSA_DATA_EXECUTION', 'GSA work package must target GSA_DATA_EXECUTION');
  check(plan.workPackages[0].connector === 'MILES', 'GSA execution must use canonical MILES connector');

  const integrity = MilesConnector.contractIntegrity();
  check(integrity.ok === true, `MILES connector contract mismatch: ${JSON.stringify(integrity)}`);
  check(MilesConnector.canExecuteAction('GSA_DATA_EXECUTION') === true, 'MILES connector must support GSA_DATA_EXECUTION');

  const queue = { operations: [] };
  const bridge = {
    readQueue() { return queue; },
    writeQueue(value) { queue.operations = value.operations; },
    enqueueTask(operation) { return { id: `TASK-${operation.id}` }; },
    markOperation() { return true; }
  };

  const engine = new BusinessExecutionEngineServiceV2({ bridge });
  const result = await engine.run({
    id: 'TEST-GSA-EXECUTION',
    payload: {
      command: gsaExecution,
      plan: {
        objective: gsaExecution,
        originalCommand: gsaExecution,
        steps: [{
          step: 1,
          provider: 'MILES',
          connector: 'MILES',
          capability: 'BUSINESS_EXECUTION',
          action: 'BUSINESS_EXECUTION',
          objective: gsaExecution
        }]
      }
    }
  });

  check(result.readOnly === false, 'engine must not downgrade GSA mission to read-only');
  check(result.status === 'IN_PROGRESS', `queued executive mission must remain IN_PROGRESS, got ${result.status}`);
  check(result.completedAt === null, 'in-progress mission must not have completedAt');
  check(result.inProgressSteps === 1, 'business execution queue step must be tracked as in progress');
  check(result.executiveSummary.workQueued === 1, 'executive summary must report queued work');
  check(/remains in progress/i.test(result.executiveSummary.message), 'summary must not claim completion while child work is queued');

  console.log(`EXECUTIVE_MISSION_EXECUTION_SEMANTICS_TEST_PASS ${checks}/${checks}`);
}

main().catch(error => {
  console.error('EXECUTIVE_MISSION_EXECUTION_SEMANTICS_TEST_FAIL');
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
