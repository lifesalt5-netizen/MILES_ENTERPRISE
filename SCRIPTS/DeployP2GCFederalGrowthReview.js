'use strict';

// V12 final question-sequence pacing pass: preserve V10 content fixes and V11 question behavior,
// while trimming only redundant narration so the demo stays near the approved runtime.

const { main: provisionFfmpeg } = require('./ProvisionProjectFfmpeg');
const { main: renderV12 } = require('./RenderP2GCFederalGrowthReviewV12QuestionSequence');

Promise.resolve()
  .then(() => provisionFfmpeg())
  .then(() => renderV12())
  .catch(error => {
    console.error(error && (error.stack || error.message) || error);
    process.exitCode = 2;
  });
