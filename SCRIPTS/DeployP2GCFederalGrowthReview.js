'use strict';

// Presentation upgrade only: approved content remains unchanged.
// Ensure project-local FFmpeg + ffprobe exist, then render V4.

const { main: provisionFfmpeg } = require('./ProvisionProjectFfmpeg');
const { main: renderV4 } = require('./RenderP2GCFederalGrowthReviewV4');

Promise.resolve()
  .then(() => provisionFfmpeg())
  .then(() => renderV4())
  .catch(error => {
    console.error(error && (error.stack || error.message) || error);
    process.exitCode = 2;
  });
