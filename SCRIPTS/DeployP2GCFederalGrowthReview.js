'use strict';

// FINAL RENDER PRIORITY: use approved 11 scene assets + existing narration WAVs only.
// Google Vids audio/avatar automation is intentionally bypassed.

const { main: provisionFfmpeg } = require('./ProvisionProjectFfmpeg');
const { main: renderLocal } = require('./RenderP2GCFederalGrowthReviewLocal');

Promise.resolve()
  .then(() => provisionFfmpeg())
  .then(() => renderLocal())
  .catch(error => {
    console.error(error && (error.stack || error.message) || error);
    process.exitCode = 2;
  });
