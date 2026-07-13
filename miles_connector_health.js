require("dotenv").config();

const connectorManager = require("./CORE/ConnectorManager");
const { writeHealthDashboard } = require("./CORE/HealthDashboard");

const GoogleConnector = require("./CONNECTORS/GOOGLE");
const InstantlyConnector = require("./CONNECTORS/INSTANTLY/instantly");

async function main() {
  connectorManager.register("GOOGLE", GoogleConnector);

  connectorManager.register("INSTANTLY", {
    healthCheck: InstantlyConnector.healthCheck,
  });

  await writeHealthDashboard();
}

main().catch((error) => {
  console.error("MILES health check failed:");
  console.error(error);
  process.exit(1);
});
