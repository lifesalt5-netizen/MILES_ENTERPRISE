const auth = require("./auth");
const gmail = require("./gmail");
const calendar = require("./calendar");
const drive = require("./drive");
const contacts = require("./contacts");

async function healthCheck() {
  const results = [];

  try {
    const client = await auth.getGoogleAuthClient();
    const profile = await auth.getUserProfile(client);
    results.push({ service: "auth", ok: true, email: profile.email });
  } catch (error) {
    results.push({ service: "auth", ok: false, error: error.message });
    return results;
  }

  for (const svc of [gmail, calendar, drive, contacts]) {
    try {
      results.push(await svc.healthCheck());
    } catch (error) {
      results.push({ service: "unknown", ok: false, error: error.message });
    }
  }

  return results;
}

async function printHealth() {
  console.log("====================================");
  console.log("MILES GOOGLE CONNECTOR HEALTH");
  console.log("====================================");
  const results = await healthCheck();
  for (const r of results) {
    console.log(`${r.ok ? "✔" : "✖"} ${r.service}`, r);
  }
}

if (require.main === module) {
  printHealth().catch((error) => {
    console.error("Google health check failed:", error.message);
    process.exit(1);
  });
}

module.exports = { healthCheck, printHealth };
