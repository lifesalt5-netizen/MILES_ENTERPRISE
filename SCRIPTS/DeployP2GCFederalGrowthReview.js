'use strict';

// Final pacing/content pass: approved 11-scene core remains intact.
// Adds a short welcome and one SLED-to-Fed expansion mention, then renders speech-synced V7.

const { main: provisionFfmpeg } = require('./ProvisionProjectFfmpeg');
const { main: renderV7 } = require('./RenderP2GCFederalGrowthReviewV7FinalPaced');

Promise.resolve()
  .then(() => provisionFfmpeg())
  .then(() => renderV7())
  .catch(error => {
    console.error(error && (error.stack || error.message) || error);
    process.exitCode = 2;
  });
