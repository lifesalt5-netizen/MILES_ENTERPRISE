const fs = require("fs");
const path = require("path");
const taskQueue = require("../CORE/TaskQueue");
const connectorManager = require("../CORE/ConnectorManager");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";

function countCsv(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/);
  return Math.max(lines.length - 1, 0);
}

class DashboardService {
  async render() {
    const tasks = taskQueue.list();
    const queued = tasks.filter(t => t.status === "QUEUED").length;
    const running = tasks.filter(t => t.status === "RUNNING").length;
    const completed = tasks.filter(t => t.status === "COMPLETED").length;
    const failed = tasks.filter(t => t.status === "FAILED").length;

    const connectors = await connectorManager.healthCheckAll();

    const segments = countCsv(path.join(ROOT, "masters", "SEGMENT_INVENTORY.csv"));
    const campaigns = countCsv(path.join(ROOT, "masters", "CAMPAIGN_MASTER.csv"));
    const domains = countCsv(path.join(ROOT, "masters", "DOMAIN_MASTER.csv"));

    console.log("");
    console.log("==================================================");
    console.log("              MILES EXECUTIVE DASHBOARD");
    console.log("==================================================");

    console.log("");
    console.log("Runtime");
    console.log("-------");
    console.log("Status: ONLINE");
    console.log(`Generated: ${new Date().toLocaleString()}`);

    console.log("");
    console.log("Queue");
    console.log("-----");
    console.log(`Queued: ${queued}`);
    console.log(`Running: ${running}`);
    console.log(`Completed: ${completed}`);
    console.log(`Failed: ${failed}`);

    console.log("");
    console.log("Connectors");
    console.log("----------");

    if (!connectors.length) {
      console.log("No connectors registered yet.");
    } else {
      connectors.forEach(c => {
        console.log(`${String(c.name).padEnd(18)} ${c.status || (c.ok ? "OK" : "WARN")}`);
      });
    }

    console.log("");
    console.log("Business");
    console.log("--------");
    console.log(`Segments: ${segments}`);
    console.log(`Campaigns: ${campaigns}`);
    console.log(`Domains: ${domains}`);

    console.log("");
    console.log("==================================================");
  }
}

module.exports = new DashboardService();