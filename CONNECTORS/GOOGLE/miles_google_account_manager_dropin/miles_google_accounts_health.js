const fs = require("fs");
const path = require("path");
const Google = require("./CONNECTORS/GOOGLE");

async function main() {
  const health = await Google.healthCheck();
  console.log("====================================");
  console.log("MILES GOOGLE ACCOUNTS HEALTH");
  console.log("====================================");
  console.log(`${health.service}: ${health.status} - ${health.message}`);
  for (const account of health.accounts || []) {
    console.log(`${account.status}: ${account.email || account.accountKey}`);
  }

  const outDir = path.join(__dirname, "DATA", "status");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "google_accounts_health.json");
  fs.writeFileSync(outFile, JSON.stringify(health, null, 2));
  console.log(`Saved: ${outFile}`);
}

main().catch((error) => {
  console.error("Google accounts health failed:");
  console.error(error.message);
  process.exit(1);
});
