const systemIntelligence = require("./CORE/SystemIntelligence");

const report = systemIntelligence.report();

console.log("");
console.log("===== MILES SYSTEM INTELLIGENCE =====");
console.log("Status              :", report.health.status);
console.log("Total Files         :", report.summary.totalFiles);
console.log("JS Files            :", report.summary.jsFiles);
console.log("Required Capabilities:", report.summary.requiredCapabilities);
console.log("Present             :", report.summary.presentCapabilities);
console.log("Missing             :", report.summary.missingCapabilities);
console.log("Build Queue Items   :", report.summary.buildQueueItems);
console.log("");
console.log("Saved:");
console.log("DATA/system/system_intelligence_report.json");
console.log("DATA/build_queue/build_queue.json");