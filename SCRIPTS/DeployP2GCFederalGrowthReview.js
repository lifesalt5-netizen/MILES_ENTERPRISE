'use strict';

// V13 pacing pass: preserve V10 content fixes, V11 question behavior, and V12 concise narration,
// while restoring deliberate visual lead/landing time so each point can register near the 8-minute target.

const { main: provisionFfmpeg } = require('./ProvisionProjectFfmpeg');
const { main: renderV13 } = require('./RenderP2GCFederalGrowthReviewV13QuestionSequence');

Promise.resolve()
  .then(() => provisionFfmpeg())
  .then(() => renderV13())
  .catch(error => {
    console.error(error && (error.stack || error.message) || error);
    process.exitCode = 2;
  });
