'use strict';

// Presentation timing correction only: approved content remains unchanged.
// Ensure project-local FFmpeg + ffprobe exist, then render speech-synced V5.

const { main: provisionFfmpeg } = require('./ProvisionProjectFfmpeg');
const { main: renderV5 } = require('./RenderP2GCFederalGrowthReviewV5SpeechSync');

Promise.resolve()
  .then(() => provisionFfmpeg())
  .then(() => renderV5())
  .catch(error => {
    console.error(error && (error.stack || error.message) || error);
    process.exitCode = 2;
  });
