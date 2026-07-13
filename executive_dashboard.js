const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const STATUS_DIR = path.join(ROOT, "DATA", "status");

function readJson(fileName) {
  const filePath = path.join(STATUS_DIR, fileName);
  if (!fs.existsSync(filePath)) return null;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function icon(status) {
  if (status === "OK") return "GREEN";
  if (status === "WARN") return "YELLOW";
  if (status === "ERROR") return "RED";
  return "GRAY";
}

function line() {
  console.log("------------------------------------");
}

function section(title) {
  console.log("");
  console.log(title);
  line();
}

function main() {
  const health = readJson("connector_health.json");
  const instantly = readJson("instantly_campaigns.json");

  console.clear();
  console.log("====================================");
  console.log("MILES DIGITAL COO - EXECUTIVE CONTROL");
  console.log("====================================");
  console.log(`Generated: ${new Date().toLocaleString()}`);

  section("SYSTEM HEALTH");

  if (health?.connectors?.length) {
    health.connectors.forEach((c) => {
      console.log(`${icon(c.status)} | ${c.name} | ${c.status} | ${c.message || ""}`);
    });
  } else {
    console.log("GRAY | No connector health data found.");
  }

  section("OUTBOUND - INSTANTLY");

  if (instantly) {
    console.log(`Campaigns Total : ${instantly.total_campaigns}`);
    console.log(`Active          : ${instantly.active_campaigns}`);
    console.log(`Paused          : ${instantly.paused_campaigns}`);

    console.log("");
    instantly.campaigns.forEach((c) => {
      const status = c.status === 1 ? "ACTIVE" : "PAUSED";
      console.log(`${status} | ${c.name}`);
    });
  } else {
    console.log("No Instantly campaign data found.");
  }

  section("EXECUTIVE ALERTS");

  if (health?.connectors?.some((c) => c.status === "ERROR")) {
    console.log("RED | One or more connectors are failing.");
  } else if (health?.connectors?.some((c) => c.status === "WARN")) {
    console.log("YELLOW | One or more connectors need attention.");
  } else {
    console.log("GREEN | No critical connector alerts.");
  }

  if (instantly?.active_campaigns === 0) {
    console.log("YELLOW | No active Instantly campaigns.");
  }

  section("TODAY'S PRIORITIES");

  console.log("1. Keep SBS Verified Email Targets campaign monitored.");
  console.log("2. Fix Google multi-account warning later; not blocking.");
  console.log("3. Build IONOS mailbox connector next.");
  console.log("4. Add reply classification.");
  console.log("5. Connect ORION segment inventory to Instantly campaigns.");

  section("NEXT BUILD");

  console.log("IONOS Connector v1");
  console.log("- Mailbox inventory");
  console.log("- IMAP reply monitoring");
  console.log("- SMTP test");
  console.log("- DNS health");
  console.log("- Dashboard integration");

  console.log("");
  console.log("====================================");
}

main();