'use strict';

// V8 pacing pass: preserve approved content, voice, intro, SLED-to-Fed mention, and speech sync.
// Only lengthen the landing beat between scenes so each key point has time to register.

const { main: provisionFfmpeg } = require('./ProvisionProjectFfmpeg');
const { main: renderV8 } = require('./RenderP2GCFederalGrowthReviewV8LandingBeats');

Promise.resolve()
  .then(() => provisionFfmpeg())
  .then(() => renderV8())
  .catch(error => {
    console.error(error && (error.stack || error.message) || error);
    process.exitCode = 2;
  });
