'use strict';

const { resolveConnectorAction } = require('../CORE/ExecutionActionContracts');
const connector = require('../CONNECTORS/INSTANTLY/connector');

(async () => {
  const contract = resolveConnectorAction('INSTANTLY', 'sendReply');
  const dryRunProbe = await connector.execute({
    action: 'sendReply',
    payload: {
      eaccount: 'acceptance@example.com',
      reply_to_uuid: 'acceptance-probe',
      subject: 'Acceptance probe',
      body: { text: 'This probe must never send while acceptance safety gates are closed.' }
    }
  });

  const result = {
    generatedAt: new Date().toISOString(),
    contractSupported: contract.supported === true && contract.canonicalAction === 'replyToEmail',
    capabilityExposed: connector.capabilities.includes('INSTANTLY_SEND_REPLY'),
    failClosedWithoutWrites: dryRunProbe?.mutationExecuted === false,
    dryRunStatus: dryRunProbe?.status || null,
    readyForGovernedWorkflowWiring:
      contract.supported === true &&
      connector.capabilities.includes('INSTANTLY_SEND_REPLY') &&
      dryRunProbe?.mutationExecuted === false
  };

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.readyForGovernedWorkflowWiring ? 0 : 2;
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
