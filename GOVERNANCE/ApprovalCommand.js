"use strict";

const ApprovalQueueEngine = require("./ApprovalQueueEngine");

function usage() {
  console.log(`
MILES Approval Commands

Usage:
  node .\\GOVERNANCE\\ApprovalCommand.js list
  node .\\GOVERNANCE\\ApprovalCommand.js stats
  node .\\GOVERNANCE\\ApprovalCommand.js approve <approvalId> [notes]
  node .\\GOVERNANCE\\ApprovalCommand.js reject <approvalId> [notes]
  node .\\GOVERNANCE\\ApprovalCommand.js approve-all <department> [notes]

Examples:
  node .\\GOVERNANCE\\ApprovalCommand.js list
  node .\\GOVERNANCE\\ApprovalCommand.js approve-all Marketing "Kevin approved marketing upload dry run"
`);
}

function main() {
  const engine = new ApprovalQueueEngine();
  const [command, arg1, ...rest] = process.argv.slice(2);
  const notes = rest.join(" ").trim();

  if (!command) {
    usage();
    process.exit(0);
  }

  if (command === "list") {
    const rows = engine.list("PENDING");
    console.table(rows.map(a => ({
      id: a.id,
      department: a.department,
      title: a.title,
      status: a.status,
      createdAt: a.createdAt
    })));
    return;
  }

  if (command === "stats") {
    console.table(engine.stats());
    return;
  }

  if (command === "approve") {
    if (!arg1) throw new Error("Missing approvalId.");
    const result = engine.approve(arg1, "Kevin", notes || "Approved by Kevin.");
    console.log("Approved:");
    console.table({
      id: result.id,
      department: result.department,
      title: result.title,
      status: result.status
    });
    return;
  }

  if (command === "reject") {
    if (!arg1) throw new Error("Missing approvalId.");
    const result = engine.reject(arg1, "Kevin", notes || "Rejected by Kevin.");
    console.log("Rejected:");
    console.table({
      id: result.id,
      department: result.department,
      title: result.title,
      status: result.status
    });
    return;
  }

  if (command === "approve-all") {
    const department = arg1 || "Marketing";
    const pending = engine.list("PENDING", department);

    let approved = 0;
    let failed = 0;

    for (const approval of pending) {
      try {
        engine.approve(
          approval.id,
          "Kevin",
          notes || `Kevin approved all pending ${department} approvals.`
        );
        approved++;
      } catch (error) {
        failed++;
        console.error(`Failed approval ${approval.id}: ${error.message}`);
      }
    }

    console.log(`Approved ${approved} ${department} approvals. Failed: ${failed}`);
    console.table(engine.pendingSummary());
    return;
  }

  usage();
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
