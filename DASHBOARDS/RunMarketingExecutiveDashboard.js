"use strict";

const fs = require("fs");
const path = require("path");
const MarketingExecutiveDashboard = require("./MarketingExecutiveDashboard");

function main() {
  const dashboard = new MarketingExecutiveDashboard().build();

  const outDir = path.join(process.cwd(), "DATA", "dashboards");
  fs.mkdirSync(outDir, { recursive: true });

  const jsonFile = path.join(outDir, "marketing_executive_dashboard.json");
  const txtFile = path.join(outDir, "marketing_executive_dashboard.txt");

  fs.writeFileSync(jsonFile, JSON.stringify(dashboard, null, 2), "utf8");

  const text = `
MILES ENTERPRISE — MARKETING EXECUTIVE DASHBOARD
Generated: ${dashboard.generatedAt}

CAMPAIGNS
Total: ${dashboard.campaigns.total}
By Status: ${JSON.stringify(dashboard.campaigns.byStatus)}

UPLOAD QUEUE
Total: ${dashboard.uploadQueue.total}
By Status: ${JSON.stringify(dashboard.uploadQueue.byStatus)}

APPROVALS
Total: ${dashboard.approvals.total}
By Status: ${JSON.stringify(dashboard.approvals.byStatus)}

SEGMENTS
Total: ${dashboard.segments.total}
Ready For Upload: ${dashboard.segments.readyForUpload}
By Upload Status: ${JSON.stringify(dashboard.segments.byUploadStatus)}

DOMAINS
Total: ${dashboard.domains.total}
By Status: ${JSON.stringify(dashboard.domains.byStatus)}

INBOXES
Total: ${dashboard.inboxes.total}
Usable: ${dashboard.inboxes.usable}
Daily Capacity: ${dashboard.inboxes.totalDailyCapacity}
By Status: ${JSON.stringify(dashboard.inboxes.byStatus)}

CAMPAIGN MONITORING
Campaigns Checked: ${dashboard.campaignMonitoring.campaignsChecked}
Executed: ${dashboard.campaignMonitoring.totalExecuted}
Failed: ${dashboard.campaignMonitoring.totalFailed}

PROVIDER
Instantly Mode: ${dashboard.provider.instantlyMode}
`;

  fs.writeFileSync(txtFile, text.trim(), "utf8");

  console.log(text);
  console.log("Saved:");
  console.log(jsonFile);
  console.log(txtFile);
}

main();
