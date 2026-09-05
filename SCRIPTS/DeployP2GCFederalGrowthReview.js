'use strict';

// CEO priority override (2026-09-05): build the reusable P2GC Federal Growth Review demo.
// This uses the existing allowlisted remote execution job so the production host can
// create the scene assets, build the Google Vids project, and export the MP4 without
// requiring Kevin to run local shell commands.

const { main } = require('./RunP2GCReusableDemoVidsProduction');

Promise.resolve(main()).catch(error => {
  console.error(error && (error.stack || error.message) || error);
  process.exitCode = 2;
});
