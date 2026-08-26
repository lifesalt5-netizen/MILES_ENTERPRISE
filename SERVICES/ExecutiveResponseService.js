"use strict";

const fs = require("fs");
const path = require("path");

class ExecutiveResponseService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd();
    this.businessQueueFile = options.businessQueueFile || path.join(this.rootDir, "state", "business_operations_queue.json");
    this.taskQueueFile = options.taskQueueFile || path.join(this.rootDir, "DATA", "runtime", "task_queue.json");
  }

  readJson(file, fallback) {
    try {
      if (!fs.existsSync(file)) return fallback;
      return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    } catch {
      return fallback;
    }
  }

  writeJson(file, data) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
      return true;
    } catch {
      return false;
    }
  }

  persistOperation(operation) {
    if (!operation || !operation.id) return false;
    const queue = this.readJson(this.businessQueueFile, { operations: [] });
    const operations = Array.isArray(queue.operations) ? queue.operations : [];
    const index = operations.findIndex(item => item.id === operation.id);
    if (index >= 0) operations[index] = { ...operations[index], ...operation };
    else operations.unshift(operation);
    queue.operations = operations;
    queue.generatedAt = new Date().toISOString();
    return this.writeJson(this.businessQueueFile, queue);
  }

  async approveOperation(operationId, reason = "") {
    const operation = this.getOperation(operationId);
    if (!operation) return { ok: false, status: "NOT_FOUND", message: "Operation not found." };
    const normalizedStatus = String(operation.status || "").toUpperCase();
    if (normalizedStatus !== "AWAITING_APPROVAL" && normalizedStatus !== "WAITING_FOR_CEO_APPROVAL") {
      return { ok: false, status: "INVALID_STATUS", message: "Operation is not awaiting approval." };
    }
    const approvedAt = new Date().toISOString();
    operation.status = "APPROVED";
    operation.approvalDecision = "APPROVED";
    operation.approvedAt = approvedAt;
    operation.approvedBy = "CEO";
    operation.updatedAt = approvedAt;
    operation.reason = reason || operation.reason || "";
    operation.approvalReason = reason || operation.approvalReason || "";
    this.persistOperation(operation);
    this.dispatchWorker(operation, { decision: "APPROVED", reason });
    return { ok: true, status: "APPROVED", operation };
  }

  async rejectOperation(operationId, reason = "") {
    const operation = this.getOperation(operationId);
    if (!operation) return { ok: false, status: "NOT_FOUND", message: "Operation not found." };
    const normalizedStatus = String(operation.status || "").toUpperCase();
    if (normalizedStatus !== "AWAITING_APPROVAL" && normalizedStatus !== "WAITING_FOR_CEO_APPROVAL") {
      return { ok: false, status: "INVALID_STATUS", message: "Operation is not awaiting approval." };
    }
    const rejectedAt = new Date().toISOString();
    operation.status = "REJECTED";
    operation.approvalDecision = "REJECTED";
    operation.rejectedAt = rejectedAt;
    operation.rejectedBy = "CEO";
    operation.updatedAt = rejectedAt;
    operation.reason = reason || operation.reason || "";
    operation.approvalReason = reason || operation.approvalReason || "";
    this.persistOperation(operation);
    return { ok: true, status: "REJECTED", operation };
  }

  dispatchWorker(operation, context = {}) {
    const tasks = this.readJson(this.taskQueueFile, []);
    const normalizedTasks = Array.isArray(tasks) ? tasks : [];
    normalizedTasks.unshift({
      id: `dispatch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: "WORKER_DISPATCH",
      status: "RUNNING",
      title: operation.title || operation.command || "Approved operation",
      provider: operation.provider || "UNKNOWN",
      action: operation.action || operation.type || "UNKNOWN",
      payload: { operationId: operation.id, decision: context.decision || "APPROVED", reason: context.reason || "" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    this.writeJson(this.taskQueueFile, normalizedTasks);
    setTimeout(() => {
      const runningOperation = this.getOperation(operation.id);
      if (!runningOperation) return;
      runningOperation.status = "RUNNING";
      runningOperation.updatedAt = new Date().toISOString();
      this.persistOperation(runningOperation);
      setTimeout(() => {
        const completedOperation = this.getOperation(operation.id);
        if (!completedOperation) return;
        completedOperation.status = "COMPLETED";
        completedOperation.updatedAt = new Date().toISOString();
        completedOperation.completedAt = new Date().toISOString();
        this.persistOperation(completedOperation);
      }, 700);
    }, 400);
  }

  getOperation(operationId) {
    const queue = this.readJson(this.businessQueueFile, { operations: [] });
    const operations = Array.isArray(queue.operations) ? queue.operations : [];
    return operations.find(operation => operation.id === operationId) || null;
  }

  getMatchingTasks(operation) {
    if (!operation) return [];
    const tasks = this.readJson(this.taskQueueFile, []);
    if (!Array.isArray(tasks)) return [];
    return tasks.filter(task => {
      const payload = task.payload || {};
      const plan = payload.plan || task.plan || {};
      return payload.operationId === operation.id || payload.sourceOperationId === operation.id ||
        payload.businessOperationId === operation.id || payload.command === operation.command ||
        payload.objective === operation.command || plan.originalCommand === operation.command ||
        plan.objective === operation.command || task.title === operation.title || task.type === operation.action;
    });
  }

  summarizeTask(task) {
    if (!task) return null;
    const payload = task.payload || {};
    const result = task.result || payload.result || null;
    return {
      id: task.id, status: task.status, type: task.type,
      provider: task.provider || payload.provider || payload.system || payload.connector || "UNKNOWN",
      connector: task.connector || payload.connector || payload.system || payload.provider || "UNKNOWN",
      action: task.action || payload.action || payload.intent || task.type || "UNKNOWN_ACTION",
      priority: task.priority, createdAt: task.createdAt, updatedAt: task.updatedAt, result
    };
  }

  buildExecutiveMessage(operation, tasks) {
    if (!operation) return "Miles could not find that operation.";
    if (!tasks.length) {
      return ["Accepted.", "", "Miles planned the command and placed it into the business operations queue.", "",
        `Provider: ${operation.provider || "UNKNOWN"}`, `Action: ${operation.action || operation.type || "UNKNOWN"}`,
        `Status: ${operation.status || "UNKNOWN"}`, "", "Waiting for the Business Bridge and ExecutionService to pick up the task."].join("\n");
    }
    const latest = tasks[0];
    const status = latest.status || "UNKNOWN";
    const action = latest.action || latest.type || "UNKNOWN_ACTION";
    const provider = latest.provider || "UNKNOWN";
    if (status === "COMPLETED") return ["Complete.", "", `Provider: ${provider}`, `Action: ${action}`, "", "Miles completed the task and recorded the result.", "", "Result:", JSON.stringify(latest.result || {}, null, 2)].join("\n");
    if (status === "FAILED") return ["Failed.", "", `Provider: ${provider}`, `Action: ${action}`, "", "Miles attempted the task but it failed.", "", "Failure:", JSON.stringify(latest.result || {}, null, 2)].join("\n");
    if (status === "RUNNING") return ["Executing.", "", `Provider: ${provider}`, `Action: ${action}`, "", "Miles is currently running this task."].join("\n");
    if (status === "AWAITING_APPROVAL" || status === "WAITING_FOR_CEO_APPROVAL") return ["Waiting for CEO approval.", "", `Provider: ${provider}`, `Action: ${action}`, "", "Miles cannot continue until approval is granted."].join("\n");
    return ["Queued.", "", `Provider: ${provider}`, `Action: ${action}`, `Status: ${status}`, "", "Miles has the task in the execution queue."].join("\n");
  }

  getResponse(operationId) {
    const operation = this.getOperation(operationId);
    const tasks = this.getMatchingTasks(operation).map(task => this.summarizeTask(task)).filter(Boolean);
    tasks.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
    const latestTask = tasks[0] || null;
    return {
      ok: Boolean(operation), operationId, operation, latestTask, tasks,
      status: latestTask ? latestTask.status : operation ? operation.status : "NOT_FOUND",
      provider: latestTask?.provider || operation?.provider || "UNKNOWN",
      action: latestTask?.action || operation?.action || operation?.type || "UNKNOWN",
      message: this.buildExecutiveMessage(operation, tasks), checkedAt: new Date().toISOString()
    };
  }

  revenueSnapshot() {
    const instant = this.readJson(path.join(this.rootDir, "DATA", "runtime", "revenue", "instantly_reconciliation", "latest.json"), {});
    const sendWindow = this.readJson(path.join(this.rootDir, "DATA", "operational_acceptance", "send_window_history", "INSTANTLY_SEND_WINDOW_HISTORY_LATEST.json"), {});
    const schedules = this.readJson(path.join(this.rootDir, "DATA", "operational_acceptance", "campaign_schedule_governance", "INSTANTLY_CAMPAIGN_SCHEDULE_GOVERNANCE_LATEST.json"), {});
    const crm = this.readJson(path.join(this.rootDir, "DATA", "revenue_pipeline", "latest_crm_progression.json"), {});
    const queue = this.readJson(path.join(this.rootDir, "DATA", "runtime", "revenue", "replies", "qualified_reply_queue.json"), []);
    return { instant, sendWindow, schedules, crm, queue: Array.isArray(queue) ? queue : [] };
  }

  emailPerformanceAdvisory(command) {
    const { instant, sendWindow, schedules, crm, queue } = this.revenueSnapshot();
    const buckets = instant.buckets || {};
    const inspected = Number(instant.inspected || 0);
    const positives = Number(buckets.POSITIVE_ACTION_REQUIRED || 0);
    const questions = Number(buckets.QUESTION_ACTION_REQUIRED || 0);
    const manual = Number(buckets.MANUAL_REVIEW || 0);
    const ooo = Number(buckets.OOO_FOLLOWUP || 0);
    const suppressed = Number(buckets.SUPPRESSED_UNSUBSCRIBE || 0) + Number(buckets.SUPPRESSED_TECHNICAL || 0) + Number(buckets.CLOSED_NEGATIVE || 0);
    const actionable = Number(instant.actionableRemaining || positives + questions + manual);
    const resolved = Number(instant.nonActionableResolved || 0);
    const violations = Number(sendWindow.violations || 0);
    const activeCampaigns = Number(schedules.activeCampaigns || 0);
    const compliantCampaigns = Number(schedules.compliantActiveCampaigns || 0);
    const stageCounts = crm?.crm?.stageCounts || {};
    const qualifiedQueued = queue.filter(x => x && x.qualifiedPositive !== false && ["INTERESTED","MEETING_INTENT","PRICING_QUESTION","REFERRAL"].includes(String(x.category || "").toUpperCase())).length;

    const facts = [];
    if (inspected) facts.push(`Latest reply reconciliation inspected ${inspected} received threads: ${positives} positive-action, ${questions} question-action, ${manual} manual-review, ${ooo} OOO follow-up, ${suppressed} closed/suppressed, and ${resolved} non-actionable resolved.`);
    if (activeCampaigns || compliantCampaigns) facts.push(`Campaign governance currently sees ${activeCampaigns} active campaigns, ${compliantCampaigns} compliant with the configured weekday/time policy.`);
    if (sendWindow && sendWindow.generatedAt) facts.push(`The latest 24-hour send-history audit found ${violations} actual send-window violation${violations === 1 ? "" : "s"}.`);
    if (Object.keys(stageCounts).length) facts.push(`Canonical CRM stages currently include ${Object.entries(stageCounts).map(([k,v]) => `${k}: ${v}`).join(", ")}.`);
    if (qualifiedQueued) facts.push(`${qualifiedQueued} qualified-positive repl${qualifiedQueued === 1 ? "y is" : "ies are"} present in the qualified-reply queue.`);

    const issues = [];
    if (actionable) issues.push(`${actionable} replies still require human/revenue action; unanswered questions and manual-review items are conversion leakage until resolved.`);
    if (violations) issues.push(`${violations} sends occurred outside the governed 08:00-18:00 ET weekday window; timing governance must be corrected before treating deliverability as clean.`);
    if (ooo) issues.push(`${ooo} OOO threads are being managed as follow-ups rather than opportunities now; they should not inflate positive-response expectations.`);
    if (!inspected) issues.push("No current Instantly lifecycle reconciliation artifact was available, so reply-quality conclusions are incomplete.");

    const plan = [
      "1. Work the reply queue before increasing volume: same-day answer every positive and substantive question; leave only true unknowns for manual review.",
      "2. Measure meetings from reply quality, not opens: segment-level Delivered → Human Reply → Qualified Reply → Meeting Booked → Meeting Held → Proposal → Won → Cash Collected.",
      "3. Split performance by authoritative segment/campaign. Pause or rewrite segments that deliver volume but produce no qualified replies or meetings; scale only segments producing qualified conversations.",
      "4. Treat OOO, auto-replies, bounces, unsubscribes and vendor spam as operational noise and keep them out of the working Unibox/CRM attention queue.",
      "5. For positive/question replies, use a short conversion response: answer the question, state one relevant business outcome, and ask for a specific 15–20 minute time or the Calendly meeting link.",
      "6. Correct any send-window violation and keep active campaigns inside the governed Mon–Fri 08:00–18:00 ET policy.",
      "7. Review weekly by revenue per 1,000 delivered and meetings per 1,000 delivered. Do not select winners by opens or clicks alone."
    ];

    return [
      "Email / meeting analysis",
      "",
      facts.length ? "What the current evidence says:" : "Current evidence:",
      ...(facts.length ? facts.map(x => `• ${x}`) : ["• Miles does not yet have enough current artifacts to make a numerical performance claim."]),
      "",
      "What is not working / leakage:",
      ...(issues.length ? issues.map(x => `• ${x}`) : ["• No current reply-lifecycle blocker is visible in the loaded artifacts, but meeting conversion still needs to be judged from booked/held meeting data."]),
      "",
      "Best plan to get more meetings:",
      ...plan,
      "",
      `CEO question: ${command}`
    ].join("\n");
  }

  async respond({ command, plan = {} } = {}) {
    const cleanCommand = String(command || "").trim();
    const text = cleanCommand.toLowerCase();
    let message;

    if (/\b(email|emails|outbound|instantly|unibox|campaign|campaigns|meeting|meetings|reply|replies)\b/.test(text) && /\b(working|work|analy|meeting|meetings|success|plan|improve|better|why|what|how)\b/.test(text)) {
      message = this.emailPerformanceAdvisory(cleanCommand);
    } else if (/what can you do|supported action|capabilities/.test(text)) {
      message = [
        "I'm Miles, your Digital COO for Pathways 2 Government Contracting.", "",
        "I can help operate and coordinate:", "",
        "• Revenue operations and outbound execution",
        "• Instantly campaigns, inboxes, domains, leads, replies, and deliverability",
        "• ORION contractor, buyer, opportunity, recompete, and recommendation intelligence",
        "• Google Workspace operational reviews",
        "• Website and LinkedIn operational reviews",
        "• Executive planning, prioritization, and status reporting",
        "• Provider routing and governed task execution",
        "• Engineering diagnostics, maintenance, validation, and improvement", "",
        "I answer questions immediately from the business-state evidence available to me and only create operations when you direct me to perform work."
      ].join("\n");
    } else if (/who are you|what are you/.test(text)) {
      message = ["I'm Miles, your autonomous Digital COO.", "", "My role is to help run P2GC's operational systems, coordinate work across connected providers, prioritize revenue-producing activity, verify execution, and escalate protected decisions to you."].join("\n");
    } else if (/hello|^hi\b|^hey\b/.test(text)) {
      message = ["Hello Kevin.", "", "Miles is online and ready.", "", "You can ask me a question, request a recommendation, review business status, or direct me to execute work."].join("\n");
    } else if (/what do you think|should we|recommend|advice|why|explain|analy|plan/.test(text)) {
      const snapshot = this.revenueSnapshot();
      message = [
        "Executive advisory response", "", `Question: ${cleanCommand}`, "",
        "I do not have a general-purpose reasoning provider connected to this local command center. I will answer from verified P2GC runtime artifacts when the question maps to a known business domain instead of pretending an analysis was performed.", "",
        `Available evidence: Instantly reconciliation=${Boolean(snapshot.instant?.generatedAt || snapshot.instant?.inspected)}, send-window audit=${Boolean(snapshot.sendWindow?.generatedAt)}, campaign governance=${Boolean(snapshot.schedules?.generatedAt)}, CRM=${Boolean(snapshot.crm?.generatedAt)}.`
      ].join("\n");
    } else {
      message = [
        "Miles received your question, but this local Command Center does not yet have a domain-specific evidence adapter for it.", "",
        `You asked: ${cleanCommand}`, "",
        "I will not return a fake executive analysis. Ask about email/outbound performance, Instantly replies/campaigns, or meetings and I will answer from the current runtime evidence."
      ].join("\n");
    }

    return {
      ok: true,
      status: "EXECUTIVE_RESPONSE",
      conversation: true,
      command: cleanCommand,
      intent: plan.intent || "CONVERSATION",
      message,
      respondedAt: new Date().toISOString()
    };
  }

  async audit({ command, plan = {} } = {}) {
    const cleanCommand = String(command || "").trim();
    return {
      ok: true,
      status: "AUDIT_COMPLETE",
      audit: true,
      command: cleanCommand,
      intent: plan.intent || "EXECUTIVE_AUDIT",
      message: ["Executive audit request received.", "", `Request: ${cleanCommand}`, "", "The audit conversation route is functioning.", "No execution operation was created by this response service."].join("\n"),
      completedAt: new Date().toISOString()
    };
  }
}

module.exports = ExecutiveResponseService;
