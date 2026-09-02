'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const IonosAllFolderReconciliationService = require('../SERVICES/revenue/IonosAllFolderReconciliationService');
const IonosPitchJunkClassifier = require('../SERVICES/revenue/IonosPitchJunkClassifier');
const governed = require('../CONNECTORS/IONOS/imap_governed');

function configureExecutionGates(execute) {
  if (execute) {
    process.env.MILES_DRY_RUN = 'false';
    process.env.MILES_CONTROLLED_WRITE_ENABLED = 'true';
    process.env.MILES_IONOS_MAILBOX_MUTATIONS = 'true';

    process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = 'false';
    process.env.INSTANTLY_WRITE_ENABLED = 'false';
    process.env.P2GC_B12_PUBLISH = 'false';
    process.env.B12_PUBLISH_ENABLED = 'false';
  } else {
    process.env.MILES_DRY_RUN = 'true';
    process.env.MILES_CONTROLLED_WRITE_ENABLED = 'false';
    process.env.MILES_IONOS_MAILBOX_MUTATIONS = 'false';
  }

  const proof = {
    execute,
    milesDryRun: process.env.MILES_DRY_RUN,
    controlledWriteEnabled: process.env.MILES_CONTROLLED_WRITE_ENABLED,
    ionosMailboxMutations: process.env.MILES_IONOS_MAILBOX_MUTATIONS,
    instantlyMutations: process.env.MILES_ALLOW_INSTANTLY_MUTATIONS,
    instantlyWriteEnabled: process.env.INSTANTLY_WRITE_ENABLED,
    b12Publish: process.env.P2GC_B12_PUBLISH,
    b12PublishEnabled: process.env.B12_PUBLISH_ENABLED,
    mutationAllowed: governed.mutationAllowed()
  };

  if (execute && proof.mutationAllowed !== true) {
    const error = new Error(`IONOS_EXECUTE_PREFLIGHT_RED=${JSON.stringify(proof)}`);
    error.code = 'IONOS_EXECUTE_PREFLIGHT_RED';
    throw error;
  }

  console.log(`IONOS_EXECUTION_PREFLIGHT=${JSON.stringify(proof)}`);
  return proof;
}

function compactDiagnostics(result, execute) {
  const accounts = Array.isArray(result.accounts) ? result.accounts : [];
  const moves = accounts.flatMap(account => Array.isArray(account.moves) ? account.moves : []);
  return {
    execute,
    mutationAllowed: governed.mutationAllowed(),
    routesAttempted: moves.length,
    routesExecuted: moves.filter(move => move && move.mutationExecuted === true).length,
    routesBlocked: moves.filter(move => move && move.mutationExecuted === false).length,
    movedUidCount: moves.reduce((n, move) => n + Number(move && move.moved || 0), 0),
    blockedStatuses: [...new Set(moves.map(move => move && move.status).filter(Boolean))],
    executableMisroutesBefore: Number(result.totals && result.totals.executableMisroutesBefore || 0),
    executableMisroutesAfter: result.totals ? result.totals.executableMisroutesAfter : null,
    accountErrors: Array.isArray(result.errors) ? result.errors : [],
    folderErrorCount: accounts.reduce((n, account) => n + (Array.isArray(account.folderErrors) ? account.folderErrors.length : 0), 0),
    accounts: accounts.map(account => ({
      account: account.account,
      verifiedSentMessageIds: Number(account.verifiedSentMessageIds || 0),
      inboxBefore: account.inboxBefore || null,
      executableMisroutesBefore: Number(account.executableMisroutesBefore || 0),
      executableMisroutesAfter: account.verification ? Number(account.verification.executableMisroutesAfter || 0) : null,
      inboxAfter: account.verification?.inboxAfter || null,
      folderErrorsBefore: Array.isArray(account.folderErrors) ? account.folderErrors.length : 0,
      folderErrorsAfter: Array.isArray(account.verification?.folderErrors) ? account.verification.folderErrors.length : 0
    }))
  };
}

function continuousHygieneStatus(root) {
  const artifact = path.join(root, 'DATA', 'runtime', 'revenue', 'ionos_hygiene', 'ionos_inbox_hygiene_latest.json');
  try {
    const stat = fs.statSync(artifact);
    const raw = JSON.parse(fs.readFileSync(artifact, 'utf8'));
    const accounts = Array.isArray(raw.accounts) ? raw.accounts : [];
    return {
      available: true,
      artifact,
      artifactModifiedAt: stat.mtime.toISOString(),
      artifactAgeSeconds: Math.max(0, Math.round((Date.now() - stat.mtimeMs) / 1000)),
      generatedAt: raw.generatedAt || null,
      ok: raw.ok === true,
      status: raw.status || null,
      enabled: raw.enabled === true,
      execute: raw.execute === true,
      totals: raw.totals || null,
      errors: Array.isArray(raw.errors) ? raw.errors : [],
      producer: raw.producer || null,
      safety: raw.safety || null,
      accounts: accounts.map(account => ({
        account: account.account,
        ok: account.ok === true,
        scanned: Number(account.scanned || 0),
        routedHighConfidenceNoise: Number(account.routedHighConfidenceNoise || 0),
        keptUncertainOrActionable: Number(account.keptUncertainOrActionable || 0),
        folders: account.folders || {},
        verification: account.verification || null
      }))
    };
  } catch (error) {
    return {
      available: false,
      artifact,
      error: error.message
    };
  }
}

async function main() {
  const root = path.resolve(process.env.MILES_ROOT || process.cwd());
  const execute = process.argv.includes('--execute');
  configureExecutionGates(execute);
  const service = new IonosAllFolderReconciliationService({ root, classifier:new IonosPitchJunkClassifier() });
  const result = await service.run({ execute });
  console.log(JSON.stringify(result, null, 2));
  console.log(`IONOS_MOVE_DIAGNOSTICS=${JSON.stringify(compactDiagnostics(result, execute))}`);
  console.log(result.ok
    ? (execute ? 'IONOS_ALL_FOLDER_RECONCILIATION_EXECUTE_GREEN' : 'IONOS_ALL_FOLDER_RECONCILIATION_PLAN_GREEN')
    : (execute ? 'IONOS_ALL_FOLDER_RECONCILIATION_EXECUTE_RED' : 'IONOS_ALL_FOLDER_RECONCILIATION_PLAN_RED'));

  // Read-only observability for the always-on production inbox hygiene loop.
  // This intentionally appears at the very end so the remote evidence tail
  // contains the live continuous-loop health even when historical all-folder
  // reconciliation is RED for unrelated legacy filing decisions.
  console.log(`IONOS_CONTINUOUS_HYGIENE_STATUS=${JSON.stringify(continuousHygieneStatus(root))}`);
  process.exitCode = result.ok ? 0 : 2;
}

if (require.main === module) main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

module.exports = {
  configureExecutionGates,
  compactDiagnostics,
  continuousHygieneStatus
};
