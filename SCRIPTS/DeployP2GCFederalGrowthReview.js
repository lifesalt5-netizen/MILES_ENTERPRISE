'use strict';

// V10 copy/content correction: decimal-safe narration, broader company pathways,
// FREE company-specific demo CTA, closing thank-you, and preserved point-landing sync.

const { main: provisionFfmpeg } = require('./ProvisionProjectFfmpeg');
const { main: renderV10 } = require('./RenderP2GCFederalGrowthReviewV10CopyFix');

Promise.resolve()
  .then(() => provisionFfmpeg())
  .then(() => renderV10())
  .catch(error => {
    console.error(error && (error.stack || error.message) || error);
    process.exitCode = 2;
  });
