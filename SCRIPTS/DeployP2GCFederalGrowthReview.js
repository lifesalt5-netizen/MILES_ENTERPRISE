'use strict';

// Temporary remote-execution lane for fail-closed recovery of the canonical MILES command-center owner.
// This wrapper will be restored immediately after runtime proof.

const { main: recoverCommandCenterOwner } = require('./RecoverMilesCommandCenterPortOwner');

Promise.resolve()
  .then(() => recoverCommandCenterOwner())
  .catch(error => {
    console.error(error && (error.stack || error.message) || error);
    process.exitCode = 2;
  });
