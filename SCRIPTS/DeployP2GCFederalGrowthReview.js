'use strict';

// V9 pacing correction: preserve approved content, voice, intro, SLED-to-Fed mention, and speech sync.
// Add a landing pause after every spoken point so the matching screen remains long enough to register.

const { main: provisionFfmpeg } = require('./ProvisionProjectFfmpeg');
const { main: renderV9 } = require('./RenderP2GCFederalGrowthReviewV9PointLanding');

Promise.resolve()
  .then(() => provisionFfmpeg())
  .then(() => renderV9())
  .catch(error => {
    console.error(error && (error.stack || error.message) || error);
    process.exitCode = 2;
  });
