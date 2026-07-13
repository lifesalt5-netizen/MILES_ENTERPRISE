"use strict";

const enroller = require("../SERVICES/Browser/BrowserSessionEnroller");

async function run() {
  const result = await enroller.enroll("instantly");

  console.log("");
  console.log("RESULT:");
  console.log(result);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});