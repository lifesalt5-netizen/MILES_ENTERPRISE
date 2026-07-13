"use strict";

const MarketingUploadQueueEngine = require("./MarketingUploadQueueEngine");

function main() {
  const engine = new MarketingUploadQueueEngine();
  const result = engine.run();

  console.log("[MILES ENTERPRISE] Marketing Upload Queue Engine complete");
  console.table(result);
}

main();
