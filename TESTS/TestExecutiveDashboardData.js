"use strict";

const dashboard =
require("../SERVICES/DashboardDataService");

console.log(
    JSON.stringify(
        dashboard.run(),
        null,
        2
    )
);