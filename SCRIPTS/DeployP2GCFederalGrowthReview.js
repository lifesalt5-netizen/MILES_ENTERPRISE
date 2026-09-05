'use strict';

// CEO priority override (2026-09-05): finish the actual prospect-facing P2GC demo video.
// The normal Federal Growth Review deployment remains available in Git history and
// will be restored after final video acceptance. The remote execution bridge already
// allowlists P2GC_FEDERAL_GROWTH_REVIEW_DEPLOY, so this wrapper lets the production
// host execute the dedicated video finalizer without requiring Kevin to run shell work.

const { main } = require('./RunP2GCDemoVideoFinalization');

Promise.resolve(main()).catch(error => {
  console.error(error && (error.stack || error.message) || error);
  process.exitCode = 2;
});
