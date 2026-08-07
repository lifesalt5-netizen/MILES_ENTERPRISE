"use strict";

const fs = require("fs");
const path = require("path");
const PersistentEngineeringMemoryService =
  require("../SERVICES/engineering/PersistentEngineeringMemoryService");

function parseArguments(argv) {
  const result = { eventPath: null, apply: false };
  for (const value of argv) {
    if (value === "--apply") result.apply = true;
    else if (value.startsWith("--event=")) result.eventPath = path.resolve(value.slice(8));
  }
  return result;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (!args.eventPath || !fs.existsSync(args.eventPath)) {
    throw new Error("Usage: node SCRIPTS/RecordEngineeringMemory.js --event=... [--apply]");
  }
  const eventText = fs
    .readFileSync(args.eventPath, "utf8")
    .replace(/^\uFEFF/, "");
  const event = JSON.parse(eventText);
  const service = new PersistentEngineeringMemoryService();
  const result = service.record({ ...event, apply: args.apply });
  console.log(JSON.stringify(result, null, 2));
  if (!args.apply) {
    console.log("\nPLAN ONLY. Re-run with --apply to append the event to persistent engineering memory.");
  }
  return result;
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

module.exports = { parseArguments, main };
