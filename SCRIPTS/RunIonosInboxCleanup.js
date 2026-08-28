'use strict';

require('dotenv').config();
const path = require('path');
const IonosAllFolderReconciliationService = require('../SERVICES/revenue/IonosAllFolderReconciliationService');
const governed = require('../CONNECTORS/IONOS/imap_governed');

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
    folderErrorCount: accounts.reduce((n, account) => n + (Array.isArray(account.folderErrors) ? account.folderErrors.length : 0), 0)
  };
}

async function main() {
  const root = path.resolve(process.env.MILES_ROOT || process.cwd());
  const execute = process.argv.includes('--execute');
  const service = new IonosAllFolderReconciliationService({ root });
  const result = await service.run({ execute });
  console.log(JSON.stringify(result, null, 2));
  console.log(`IONOS_MOVE_DIAGNOSTICS=${JSON.stringify(compactDiagnostics(result, execute))}`);
  console.log(result.ok
    ? (execute ? 'IONOS_ALL_FOLDER_RECONCILIATION_EXECUTE_GREEN' : 'IONOS_ALL_FOLDER_RECONCILIATION_PLAN_GREEN')
    : (execute ? 'IONOS_ALL_FOLDER_RECONCILIATION_EXECUTE_RED' : 'IONOS_ALL_FOLDER_RECONCILIATION_PLAN_RED'));
  process.exitCode = result.ok ? 0 : 2;
}

if (require.main === module) main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
