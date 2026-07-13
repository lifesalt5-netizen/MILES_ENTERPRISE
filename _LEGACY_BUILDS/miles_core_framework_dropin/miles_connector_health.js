const connectorManager = require("./CORE/ConnectorManager");
const { writeHealthDashboard } = require("./CORE/HealthDashboard");

const GoogleConnector = require("./CONNECTORS/GOOGLE");

async function main() {
  connectorManager.register("GOOGLE", GoogleConnector);
  await writeHealthDashboard();
}

main().catch((error) => {
  console.error("MILES health check failed:");
  console.error(error);
  process.exit(1);
});
