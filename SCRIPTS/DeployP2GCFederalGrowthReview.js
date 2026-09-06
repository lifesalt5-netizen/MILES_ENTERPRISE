'use strict';

// FINAL RENDER PRIORITY: use approved 11 scene assets + approved narration only.
// Google Vids audio/avatar automation is intentionally bypassed.

const { main: renderLocal } = require('./RenderP2GCFederalGrowthReviewLocal');

Promise.resolve()
  .then(() => renderLocal())
  .catch(error => {
    console.error(error && (error.stack || error.message) || error);
    process.exitCode = 2;
  });
