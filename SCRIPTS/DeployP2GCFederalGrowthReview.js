'use strict';

// CEO priority override (2026-09-05): build the reusable P2GC Federal Growth Review demo.
// Apply the final approved copy refinements before rendering, then run the reusable-demo
// production pipeline through the existing allowlisted remote execution job.

const { main: applyCopyOverrides } = require('./ApplyP2GCReusableDemoCopyOverrides');
const { main: runReusableDemoProduction } = require('./RunP2GCReusableDemoVidsProduction');

Promise.resolve()
  .then(() => applyCopyOverrides())
  .then(() => runReusableDemoProduction())
  .catch(error => {
    console.error(error && (error.stack || error.message) || error);
    process.exitCode = 2;
  });
