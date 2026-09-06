'use strict';

// V11 question-sequence pass: preserve V10 content/pacing fixes,
// show each question first, speak it, let it land, then advance.

const { main: provisionFfmpeg } = require('./ProvisionProjectFfmpeg');
const { main: renderV11 } = require('./RenderP2GCFederalGrowthReviewV11QuestionSequence');

Promise.resolve()
  .then(() => provisionFfmpeg())
  .then(() => renderV11())
  .catch(error => {
    console.error(error && (error.stack || error.message) || error);
    process.exitCode = 2;
  });
