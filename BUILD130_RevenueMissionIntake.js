"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();

const bridgeFile = path.join(
  ROOT,
  "SERVICES",
  "BusinessOperationsBridgeService.js"
);

const revenueServiceFile = path.join(
  ROOT,
  "SERVICES",
  "RevenueMissionSourceService.js"
);

const testFile = path.join(
  ROOT,
  "TESTS",
  "Test_Build130_RevenueMissionIntake.js"
);

const timestamp = new Date()
  .toISOString()
  .replace(/[-:TZ.]/g, "")
  .slice(0, 14);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeFile(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content, "utf8");
}

function fail(message) {
  console.error("[BUILD130] FAILED:", message);
  process.exit(1);
}

if (!fs.existsSync(bridgeFile)) {
  fail(`Missing bridge file: ${bridgeFile}`);
}

const backupFile =
  bridgeFile.replace(
    /\.js$/,
    `.BEFORE_BUILD130_${timestamp}.js`
  );

fs.copyFileSync(bridgeFile, backupFile);

console.log("[BUILD130] Backup created:");
console.log(backupFile);

const revenueService = `"use strict";

const fs = require("fs");
const path = require("path");

function now() {
  return new Date().toISOString();
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;

    let raw = fs.readFileSync(file, "utf8");
    raw = raw.replace(/^\\uFEFF/, "");

    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

class RevenueMissionSourceService {
  constructor(options = {}) {
    this.rootDir =
      options.rootDir ||
      process.env.MILES_ROOT ||
      path.resolve(__dirname, "..");

    this.sourceFiles = options.sourceFiles || [
      {
        source: "revenue_work_queue",
        file: path.join(
          this.rootDir,
          "DATA",
          "revenue",
          "revenue_work_queue.json"
        )
      },
      {
        source: "crm_followups",
        file: path.join(
          this.rootDir,
          "DATA",
          "revenue",
          "crm_followups.json"
        )
      },
      {
        source: "proposal_deadlines",
        file: path.join(
          this.rootDir,
          "DATA",
          "revenue",
          "proposal_deadlines.json"
        )
      },
      {
        source: "client_deliverables",
        file: path.join(
          this.rootDir,
          "DATA",
          "revenue",
          "client_deliverables.json"
        )
      },
      {
        source: "orion_recommendations",
        file: path.join(
          this.rootDir,
          "DATA",
          "revenue",
          "orion_recommendations.json"
        )
      }
    ];
  }

  extractItems(value) {
    if (Array.isArray(value)) return value;

    if (!value || typeof value !== "object") {
      return [];
    }

    const possibleArrays = [
      value.operations,
      value.items,
      value.workItems,
      value.missions,
      value.followups,
      value.deadlines,
      value.deliverables,
      value.recommendations
    ];

    return possibleArrays.find(Array.isArray) || [];
  }

  inferRevenueStage(item = {}, source = "") {
    const explicit =
      item.revenueStage ||
      item.stage ||
      item.pipelineStage;

    if (explicit) {
      return String(explicit).toUpperCase();
    }

    const text = [
      source,
      item.title,
      item.objective,
      item.reason,
      item.description,
      item.action,
      item.type,
      item.status
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (
      /interested|positive reply|responded lead|hot lead/.test(text)
    ) {
      return "INTERESTED_REPLY";
    }

    if (/proposal|quote|pricing/.test(text)) {
      return "PROPOSAL";
    }

    if (/meeting|appointment|discovery call/.test(text)) {
      return "MEETING";
    }

    if (/contract|negotiation|close deal/.test(text)) {
      return "NEGOTIATION";
    }

    if (/client|deliverable|fulfillment/.test(text)) {
      return "CLIENT_DELIVERY";
    }

    if (/campaign|instantly|outbound|lead list/.test(text)) {
      return "PIPELINE";
    }

    return "PIPELINE";
  }

  inferProvider(item = {}, source = "") {
    if (item.provider) return item.provider;
    if (item.connector) return item.connector;
    if (item.system) return item.system;

    const text = [
      source,
      item.title,
      item.action,
      item.objective
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (/instantly|campaign|outbound/.test(text)) {
      return "INSTANTLY";
    }

    if (/orion|opportunity|recompete/.test(text)) {
      return "ORION";
    }

    if (/email|gmail|workspace/.test(text)) {
      return "GOOGLE";
    }

    return "MILES";
  }

  inferAction(item = {}, stage = "") {
    if (item.action) return item.action;
    if (item.type) return item.type;

    const actions = {
      INTERESTED_REPLY: "PREPARE_PROSPECT_RESPONSE",
      MEETING: "PREPARE_MEETING_FOLLOWUP",
      PROPOSAL: "PREPARE_PROPOSAL_ACTION",
      NEGOTIATION: "PREPARE_CLOSE_ACTION",
      CLIENT_DELIVERY: "COMPLETE_CLIENT_DELIVERABLE",
      PIPELINE: "ADVANCE_REVENUE_PIPELINE"
    };

    return actions[stage] || "ADVANCE_REVENUE_PIPELINE";
  }

  defaultMetrics(stage) {
    const metrics = {
      INTERESTED_REPLY: {
        expectedRevenue: 90,
        urgency: 100,
        customerImpact: 90,
        strategicValue: 95,
        executionConfidence: 90
      },
      NEGOTIATION: {
        expectedRevenue: 100,
        urgency: 95,
        customerImpact: 90,
        strategicValue: 100,
        executionConfidence: 80
      },
      PROPOSAL: {
        expectedRevenue: 85,
        urgency: 90,
        customerImpact: 85,
        strategicValue: 90,
        executionConfidence: 80
      },
      MEETING: {
        expectedRevenue: 75,
        urgency: 85,
        customerImpact: 80,
        strategicValue: 85,
        executionConfidence: 90
      },
      CLIENT_DELIVERY: {
        expectedRevenue: 70,
        urgency: 90,
        customerImpact: 100,
        strategicValue: 90,
        executionConfidence: 90
      },
      PIPELINE: {
        expectedRevenue: 55,
        urgency: 60,
        customerImpact: 55,
        strategicValue: 75,
        executionConfidence: 80
      }
    };

    return metrics[stage] || metrics.PIPELINE;
  }

  normalizeItem(item = {}, source = "", file = "", index = 0) {
    const title =
      item.title ||
      item.command ||
      item.objective ||
      item.description ||
      "Advance revenue opportunity";

    const objective =
      item.objective ||
      item.description ||
      item.reason ||
      title;

    const revenueStage =
      this.inferRevenueStage(item, source);

    const defaults =
      this.defaultMetrics(revenueStage);

    const action =
      this.inferAction(item, revenueStage);

    const provider =
      this.inferProvider(item, source);

    const sourceKey = [
      source,
      item.id || "",
      item.contactEmail || item.email || "",
      item.company || item.client || "",
      title,
      item.dueDate || item.deadline || ""
    ].join("|");

    const generatedId =
      "REVENUE_" +
      Buffer.from(sourceKey, "utf8")
        .toString("base64url")
        .slice(0, 72);

    const requiresKevin =
      item.requiresKevin === true ||
      item.requiresCEO === true ||
      item.approvalRequired === true ||
      [
        "SEND_PROPOSAL",
        "APPROVE_PRICING",
        "CHANGE_PRICING",
        "SIGN_CONTRACT",
        "SPEND_MONEY"
      ].includes(String(action).toUpperCase());

    let status = String(
      item.status ||
      (requiresKevin ? "AWAITING_APPROVAL" : "READY")
    ).toUpperCase();

    if (
      requiresKevin &&
      ["READY", "PENDING", "NEW"].includes(status)
    ) {
      status = "AWAITING_APPROVAL";
    }

    return {
      ...item,
      id: item.id || generatedId,
      source,
      sourceQueue: file,
      sourceIndex: index,

      department:
        item.department || "Revenue Operations",

      provider,
      connector: item.connector || provider,
      system: item.system || provider,

      action,
      capability:
        item.capability || action,

      type:
        item.type || action,

      title,
      command:
        item.command || title,

      objective,
      reason:
        item.reason || objective,

      revenueStage,

      expectedRevenue:
        Number(
          item.expectedRevenue ??
          item.revenueImpact ??
          defaults.expectedRevenue
        ),

      urgency:
        Number(item.urgency ?? defaults.urgency),

      customerImpact:
        Number(
          item.customerImpact ??
          defaults.customerImpact
        ),

      strategicValue:
        Number(
          item.strategicValue ??
          defaults.strategicValue
        ),

      executionConfidence:
        Number(
          item.executionConfidence ??
          item.confidence ??
          defaults.executionConfidence
        ),

      risk:
        Number(item.risk ?? 10),

      priority:
        Number(item.priority ?? 1),

      requiresKevin,
      requiresCEO: requiresKevin,
      status,

      dueDate:
        item.dueDate ||
        item.deadline ||
        null,

      importedAt:
        item.importedAt || now(),

      updatedAt: now(),

      metadata: {
        ...(item.metadata || {}),
        revenueStage,
        source,
        sourceFile: file
      }
    };
  }

  readCandidates() {
    const candidates = [];
    const sourceSummary = [];

    for (const definition of this.sourceFiles) {
      const raw = readJson(definition.file, []);
      const items = this.extractItems(raw);

      sourceSummary.push({
        source: definition.source,
        file: definition.file,
        found: items.length
      });

      items.forEach((item, index) => {
        candidates.push(
          this.normalizeItem(
            item,
            definition.source,
            definition.file,
            index
          )
        );
      });
    }

    return {
      candidates,
      sourceSummary
    };
  }
}

module.exports = RevenueMissionSourceService;
`;

writeFile(revenueServiceFile, revenueService);

console.log("[BUILD130] Created RevenueMissionSourceService.js");

let bridge = fs.readFileSync(bridgeFile, "utf8");

if (
  !bridge.includes(
    'const RevenueMissionSourceService = require("./RevenueMissionSourceService");'
  )
) {
  const strictMarker = '"use strict";';

  if (!bridge.includes(strictMarker)) {
    fail('Could not locate "use strict" marker.');
  }

  bridge = bridge.replace(
    strictMarker,
    strictMarker +
      '\n\nconst RevenueMissionSourceService = require("./RevenueMissionSourceService");'
  );
}

const constructorMarker =
  'this.failedCount = 0;';

if (!bridge.includes("this.revenueMissionSource")) {
  if (!bridge.includes(constructorMarker)) {
    fail("Could not locate constructor insertion marker.");
  }

  bridge = bridge.replace(
    constructorMarker,
    constructorMarker +
      `

    this.revenueMissionSource =
      options.revenueMissionSource ||
      new RevenueMissionSourceService({
        rootDir: this.rootDir
      });`
  );
}

const importMethodMarker =
  '\n  isPending(operation) {';

if (!bridge.includes("importRevenueWork()")) {
  if (!bridge.includes(importMethodMarker)) {
    fail("Could not locate isPending() insertion marker.");
  }

  const importMethod = `

  importRevenueWork() {
    if (
      !this.revenueMissionSource ||
      typeof this.revenueMissionSource.readCandidates !== "function"
    ) {
      return {
        found: 0,
        imported: 0,
        updated: 0,
        sources: []
      };
    }

    const revenueRead =
      this.revenueMissionSource.readCandidates();

    const candidates =
      Array.isArray(revenueRead.candidates)
        ? revenueRead.candidates
        : [];

    if (!candidates.length) {
      return {
        found: 0,
        imported: 0,
        updated: 0,
        sources: revenueRead.sourceSummary || []
      };
    }

    const businessQueue = this.readQueue();

    businessQueue.operations =
      Array.isArray(businessQueue.operations)
        ? businessQueue.operations
        : [];

    const existingById = new Map(
      businessQueue.operations
        .filter((operation) => operation && operation.id)
        .map((operation) => [operation.id, operation])
    );

    const terminalStates = [
      "BRIDGED",
      "COMPLETED",
      "EXECUTED",
      "CANCELLED",
      "REJECTED"
    ];

    let imported = 0;
    let updated = 0;

    for (const incoming of candidates) {
      const existing =
        existingById.get(incoming.id);

      if (!existing) {
        businessQueue.operations.push(incoming);
        existingById.set(incoming.id, incoming);
        imported++;
        continue;
      }

      const existingStatus =
        String(existing.status || "").toUpperCase();

      if (terminalStates.includes(existingStatus)) {
        continue;
      }

      Object.assign(existing, {
        ...incoming,
        importedAt:
          existing.importedAt ||
          incoming.importedAt,
        updatedAt: now()
      });

      updated++;
    }

    this.writeQueue(businessQueue);

    this.log(
      \`Revenue import found=\${candidates.length} imported=\${imported} updated=\${updated}\`
    );

    return {
      found: candidates.length,
      imported,
      updated,
      sources: revenueRead.sourceSummary || []
    };
  }
`;

  bridge = bridge.replace(
    importMethodMarker,
    importMethod + importMethodMarker
  );
}

const marketingRunMarker =
  "const marketingImport = this.importMarketingWork();";

if (!bridge.includes("const revenueImport = this.importRevenueWork();")) {
  if (!bridge.includes(marketingRunMarker)) {
    fail("Could not locate runOnce marketing import marker.");
  }

  bridge = bridge.replace(
    marketingRunMarker,
    marketingRunMarker +
      `

    // BUILD130: Import revenue work into the same canonical
    // business operations queue before dispatch.
    const revenueImport = this.importRevenueWork();`
  );
}

bridge = bridge.replace(
  /marketingImport,\s*\n(\s*)operationsFound:/g,
  "marketingImport,\n$1revenueImport,\n$1operationsFound:"
);

writeFile(bridgeFile, bridge);

console.log("[BUILD130] Patched BusinessOperationsBridgeService.js");

const testCode = `"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..");

const RevenueMissionSourceService =
  require("../SERVICES/RevenueMissionSourceService");

const BusinessOperationsBridgeService =
  require("../SERVICES/BusinessOperationsBridgeService");

const revenueDir =
  path.join(ROOT, "DATA", "revenue");

const testQueue =
  path.join(revenueDir, "revenue_work_queue.json");

fs.mkdirSync(revenueDir, { recursive: true });

const original =
  fs.existsSync(testQueue)
    ? fs.readFileSync(testQueue, "utf8")
    : null;

const testItem = {
  id: "BUILD130_TEST_INTERESTED_PROSPECT",
  title: "Prepare follow-up for interested prospect",
  objective:
    "Prepare the next response and recommended sales action.",
  revenueStage: "INTERESTED_REPLY",
  provider: "MILES",
  action: "PREPARE_PROSPECT_RESPONSE",
  status: "READY",
  expectedRevenue: 90,
  urgency: 100,
  customerImpact: 90,
  strategicValue: 95,
  executionConfidence: 95,
  requiresKevin: false
};

fs.writeFileSync(
  testQueue,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      operations: [testItem]
    },
    null,
    2
  ),
  "utf8"
);

try {
  const source =
    new RevenueMissionSourceService({
      rootDir: ROOT
    });

  const result = source.readCandidates();

  const found = result.candidates.find(
    (item) =>
      item.id ===
      "BUILD130_TEST_INTERESTED_PROSPECT"
  );

  if (!found) {
    throw new Error(
      "Revenue mission was not discovered."
    );
  }

  if (
    found.revenueStage !==
    "INTERESTED_REPLY"
  ) {
    throw new Error(
      "Revenue stage was not preserved."
    );
  }

  if (found.status !== "READY") {
    throw new Error(
      "Revenue mission was not executable."
    );
  }

  const fakeTaskQueue = {
    tasks: [],
    add(type, payload, priority) {
      const task = {
        id: "BUILD130_TASK_1",
        type,
        payload,
        priority
      };

      this.tasks.push(task);
      return task;
    }
  };

  const bridge =
    new BusinessOperationsBridgeService({
      rootDir: ROOT,
      taskQueue: fakeTaskQueue
    });

  bridge.importRevenueWork();

  const queue = bridge.readQueue();

  const imported =
    queue.operations.find(
      (item) =>
        item.id ===
        "BUILD130_TEST_INTERESTED_PROSPECT"
    );

  if (!imported) {
    throw new Error(
      "Revenue mission was not imported into business queue."
    );
  }

  if (
    imported.expectedRevenue <= 0 ||
    imported.urgency <= 0
  ) {
    throw new Error(
      "Executive scoring signals are missing."
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        build: "BUILD130",
        sourceCandidates:
          result.candidates.length,
        importedMission: {
          id: imported.id,
          title: imported.title,
          revenueStage:
            imported.revenueStage,
          expectedRevenue:
            imported.expectedRevenue,
          urgency: imported.urgency,
          provider: imported.provider,
          action: imported.action,
          status: imported.status
        }
      },
      null,
      2
    )
  );
} finally {
  if (original === null) {
    try {
      fs.unlinkSync(testQueue);
    } catch {}
  } else {
    fs.writeFileSync(
      testQueue,
      original,
      "utf8"
    );
  }
}
`;

writeFile(testFile, testCode);

console.log("[BUILD130] Created integration test.");
console.log("[BUILD130] Installation complete.");
console.log("[BUILD130] Run:");
console.log(
  "node .\\TESTS\\Test_Build130_RevenueMissionIntake.js"
);
