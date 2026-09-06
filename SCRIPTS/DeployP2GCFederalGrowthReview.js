'use strict';

// Temporary remote-execution lane for deploying the P2GC private diagnostic conversion flow.
// The underlying V13 demo renderer remains unchanged; this wrapper will be restored after runtime proof.

const { main: deployPrivateDiagnostic } = require('./DeployP2GCPrivateDiagnostic');

Promise.resolve()
  .then(() => deployPrivateDiagnostic())
  .catch(error => {
    console.error(error && (error.stack || error.message) || error);
    process.exitCode = 2;
  });
