const auth = require("./auth");
const gmail = require("./gmail");
const calendar = require("./calendar");
const drive = require("./drive");
const contacts = require("./contacts");

async function healthCheck() {
  const checks = [];
  for (const module of [gmail, calendar, drive, contacts]) {
    try {
      checks.push(await module.healthCheck());
    } catch (error) {
      checks.push({ service: "unknown", ok: false, error: error.message });
    }
  }
  return { service: "google_workspace", ok: checks.every(c => c.ok), checks };
}

async function main() {
  console.log("====================================");
  console.log("MILES GOOGLE WORKSPACE HEALTH CHECK");
  console.log("====================================");
  const result = await healthCheck();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = { auth, gmail, calendar, drive, contacts, healthCheck };
