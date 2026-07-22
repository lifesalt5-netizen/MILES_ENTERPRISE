"use strict";

require("dotenv").config();

const path = require("path");

process.env.MILES_ROOT =
  process.env.MILES_ROOT || __dirname;

const dashboardServer = require(
  path.join(
    __dirname,
    "SERVICES",
    "DashboardServerService"
  )
);

try {
  const result = dashboardServer.run({
    port: Number(
      process.env.MILES_DASHBOARD_PORT || 8737
    )
  });

  console.log(
    `[MILES] Executive Dashboard started: ${result.url}`
  );
} catch (error) {
  console.error(
    "[MILES] Executive Dashboard failed:",
    error.stack || error.message
  );

  process.exit(1);
}