'use strict';

// Presentation upgrade only: approved content remains unchanged.
// V4 uses a brighter executive theme, natural neural narration, and progressive reveals.

const { main: renderV4 } = require('./RenderP2GCFederalGrowthReviewV4');

Promise.resolve()
  .then(() => renderV4())
  .catch(error => {
    console.error(error && (error.stack || error.message) || error);
    process.exitCode = 2;
  });
