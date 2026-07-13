const fs = require("fs");
const path = require("path");
const connectorManager = require("./ConnectorManager");

async function writeHealthDashboard() {
  const results = await connectorManager.healthCheckAll();
  const outDir = path.join(process.cwd(), "DATA", "status");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "connector_health.json");
  fs.writeFileSync(outFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    connectors: results,
  }, null, 2));

  console.log("====================================");
  console.log("MILES CONNECTOR HEALTH");
  console.log("====================================");
  for (const r of results) {
    console.log(`${r.name}: ${r.status} - ${r.message || ""}`);
  }
  console.log("");
  console.log(`Saved: ${outFile}`);
  return results;
}

module.exports = { writeHealthDashboard };
