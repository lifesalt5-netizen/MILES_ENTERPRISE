"use strict";

require("dotenv").config();
const ReplacementContactBackfillService = require("./SERVICES/revenue/ReplacementContactBackfillService");

(async () => {
  const service = new ReplacementContactBackfillService({
    rootDir: process.env.MILES_ROOT || process.cwd()
  });
  const result = await service.runOnce();
  console.log(JSON.stringify(result, null, 2));
  if (result.ok !== true) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
