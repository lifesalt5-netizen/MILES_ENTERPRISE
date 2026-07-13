const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const scanner = require("./ProjectScanner");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "DATA", "builder");

function readText(relPath) {
  try {
    return fs.readFileSync(path.join(ROOT, relPath), "utf8");
  } catch {
    return "";
  }
}

function componentId(filePath) {
  return crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 12);
}

function classifyComponent(file) {
  const p = file.path.toLowerCase();
  const name = path.basename(p);

  const types = [];

  if (p.includes("/services/") || name.includes("service")) types.push("service");
  if (p.includes("/workers/") || name.includes("worker")) types.push("worker");
  if (p.includes("/providers/") || name.includes("provider")) types.push("provider");
  if (p.includes("/connectors/") || name.includes("connector")) types.push("connector");
  if (p.includes("/api/") || name.includes("api")) types.push("api");
  if (p.includes("/automations/") || name.includes("automation") || name.includes("scheduler")) types.push("automation");
  if (p.includes("/builder/") || name.includes("builder") || name.includes("scanner") || name.includes("analyzer")) types.push("engineering");
  if (p.includes("/runtime/") || name.includes("runtime") || name.includes("kernel") || name.includes("cooloop")) types.push("runtime");
  if (name.includes("eventbus") || name.includes("event-bus")) types.push("event_bus");
  if (name.includes("db") || name.includes("database")) types.push("database");

  return [...new Set(types)];
}

function extractDependencies(text) {
  const deps = [];
  let match;

  const patterns = [
    /require\(["']([^"']+)["']\)/g,
    /from\s+["']([^"']+)["']/g,
    /import\s+["']([^"']+)["']/g
  ];

  for (const pattern of patterns) {
    while ((match = pattern.exec(text)) !== null) {
      deps.push(match[1]);
    }
  }

  return [...new Set(deps)];
}

function extractEvents(text) {
  const published = [];
  const subscribed = [];
  let match;

  const publishPatterns = [
    /\.emit\(["'`]([^"'`]+)["'`]/g,
    /publish\(["'`]([^"'`]+)["'`]/g,
    /dispatch\(["'`]([^"'`]+)["'`]/g
  ];

  const subscribePatterns = [
    /\.on\(["'`]([^"'`]+)["'`]/g,
    /subscribe\(["'`]([^"'`]+)["'`]/g,
    /handle\(["'`]([^"'`]+)["'`]/g
  ];

  for (const pattern of publishPatterns) {
    while ((match = pattern.exec(text)) !== null) published.push(match[1]);
  }

  for (const pattern of subscribePatterns) {
    while ((match = pattern.exec(text)) !== null) subscribed.push(match[1]);
  }

  return {
    published: [...new Set(published)],
    subscribed: [...new Set(subscribed)]
  };
}

function detectCapabilities(file, text, types) {
  const haystack = `${file.path}\n${text.slice(0, 5000)}`.toLowerCase();
  const capabilities = [];

  const rules = [
    ["executive_intelligence", ["executive brief", "executive intelligence", "kpi", "dashboard"]],
    ["revenue_operations", ["revenue", "pipeline", "proposal", "crm", "client", "sales"]],
    ["marketing_operations", ["instantly", "linkedin", "website", "campaign", "b12", "outreach"]],
    ["orion_operations", ["orion", "contractor", "buyer", "vehicle", "recompete", "recommendation"]],
    ["government_data", ["sam.gov", "sam", "usaspending", "gsa", "elibrary", "rfi", "forecast"]],
    ["runtime_operations", ["pm2", "runtime", "heartbeat", "autonomouscooloopservice", "loop"]],
    ["engineering_operations", ["builder", "scanner", "analyzer", "gitmanager", "runtimecontroller"]],
    ["approval_governance", ["approval", "authority", "governance", "protected", "permission"]],
    ["data_provider", ["provider", "data provider"]],
    ["connector_operations", ["connector", "integration", "api key"]]
  ];

  for (const [capability, terms] of rules) {
    if (terms.some(term => haystack.includes(term))) capabilities.push(capability);
  }

  if (types.includes("service")) capabilities.push("service_execution");
  if (types.includes("worker")) capabilities.push("worker_execution");
  if (types.includes("provider")) capabilities.push("data_provider");
  if (types.includes("connector")) capabilities.push("connector_operations");
  if (types.includes("api")) capabilities.push("api_surface");

  return [...new Set(capabilities)];
}

function detectGovernance(capabilities) {
  const approvalSensitive = new Set([
    "approval_governance"
  ]);

  const highAutonomy = new Set([
    "engineering_operations",
    "runtime_operations",
    "orion_operations",
    "marketing_operations",
    "revenue_operations"
  ]);

  return {
    kevinApprovalRequired: capabilities.some(c => approvalSensitive.has(c)),
    autonomyImpact: capabilities.some(c => highAutonomy.has(c)) ? "high" : "medium",
    reducesKevinWorkload: capabilities.length > 0
  };
}

function discover() {
  const scanReport = scanner.scan();
  const jsFiles = scanReport.files.filter(f => f.type === "javascript" || f.type === "powershell" || f.type === "json");

  const components = [];

  for (const file of jsFiles) {
    const types = classifyComponent(file);
    if (!types.length) continue;

    const text = readText(file.path);
    const events = extractEvents(text);
    const capabilities = detectCapabilities(file, text, types);

    components.push({
      id: componentId(file.path),
      name: path.basename(file.path),
      path: file.path,
      fileType: file.type,
      bytes: file.bytes,
      modifiedAt: file.modifiedAt,
      componentTypes: types,
      capabilities,
      dependencies: extractDependencies(text),
      eventsPublished: events.published,
      eventsSubscribed: events.subscribed,
      governance: detectGovernance(capabilities),
      status: "active_candidate"
    });
  }

  const capabilityRegistry = {};
  for (const component of components) {
    for (const capability of component.capabilities) {
      if (!capabilityRegistry[capability]) capabilityRegistry[capability] = [];
      capabilityRegistry[capability].push({
        componentId: component.id,
        path: component.path,
        componentTypes: component.componentTypes,
        autonomyImpact: component.governance.autonomyImpact
      });
    }
  }

  const dependencyGraph = {
    nodes: components.map(c => ({
      id: c.id,
      path: c.path,
      componentTypes: c.componentTypes,
      dependencies: c.dependencies
    }))
  };

  const eventGraph = {
    publishers: components
      .filter(c => c.eventsPublished.length)
      .map(c => ({ path: c.path, events: c.eventsPublished })),
    subscribers: components
      .filter(c => c.eventsSubscribed.length)
      .map(c => ({ path: c.path, events: c.eventsSubscribed })),
    allEvents: [...new Set(components.flatMap(c => [...c.eventsPublished, ...c.eventsSubscribed]))].sort()
  };

  const systemRegistry = {
    generatedAt: new Date().toISOString(),
    root: ROOT,
    activeRuntime: "AutonomousCOOLoopService",
    legacyRuntime: "ProductionCOOEngine",
    totalFilesScanned: scanReport.totalFiles,
    totalComponents: components.length,
    counts: {
      services: components.filter(c => c.componentTypes.includes("service")).length,
      workers: components.filter(c => c.componentTypes.includes("worker")).length,
      providers: components.filter(c => c.componentTypes.includes("provider")).length,
      connectors: components.filter(c => c.componentTypes.includes("connector")).length,
      api: components.filter(c => c.componentTypes.includes("api")).length,
      runtime: components.filter(c => c.componentTypes.includes("runtime")).length,
      engineering: components.filter(c => c.componentTypes.includes("engineering")).length,
      automation: components.filter(c => c.componentTypes.includes("automation")).length
    }
  };

  return {
    generatedAt: new Date().toISOString(),
    systemRegistry,
    components,
    capabilityRegistry,
    dependencyGraph,
    eventGraph
  };
}

function writeReport() {
  const result = discover();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const files = {
    system_registry: path.join(OUT_DIR, "system_registry.json"),
    component_registry: path.join(OUT_DIR, "component_registry.json"),
    capability_registry: path.join(OUT_DIR, "capability_registry.json"),
    dependency_graph: path.join(OUT_DIR, "dependency_graph.json"),
    event_graph: path.join(OUT_DIR, "event_graph.json"),
    architecture_discovery: path.join(OUT_DIR, "architecture_discovery.json"),
    executive_report: path.join(OUT_DIR, "architecture_executive_report.md")
  };

  fs.writeFileSync(files.system_registry, JSON.stringify(result.systemRegistry, null, 2));
  fs.writeFileSync(files.component_registry, JSON.stringify({ generatedAt: result.generatedAt, components: result.components }, null, 2));
  fs.writeFileSync(files.capability_registry, JSON.stringify({ generatedAt: result.generatedAt, capabilities: result.capabilityRegistry }, null, 2));
  fs.writeFileSync(files.dependency_graph, JSON.stringify({ generatedAt: result.generatedAt, ...result.dependencyGraph }, null, 2));
  fs.writeFileSync(files.event_graph, JSON.stringify({ generatedAt: result.generatedAt, ...result.eventGraph }, null, 2));
  fs.writeFileSync(files.architecture_discovery, JSON.stringify(result, null, 2));

  const executive = `# MILES Architecture Discovery Executive Report

Generated: ${result.generatedAt}

## Purpose
Make MILES aware of its own architecture so it can operate, repair, and improve P2GC with less Kevin involvement.

## Active Runtime Rule
AutonomousCOOLoopService remains the active Digital COO runtime.
ProductionCOOEngine remains legacy unless explicitly approved.

## Component Counts
- Total files scanned: ${result.systemRegistry.totalFilesScanned}
- Total architecture components: ${result.systemRegistry.totalComponents}
- Services: ${result.systemRegistry.counts.services}
- Workers: ${result.systemRegistry.counts.workers}
- Providers: ${result.systemRegistry.counts.providers}
- Connectors: ${result.systemRegistry.counts.connectors}
- API: ${result.systemRegistry.counts.api}
- Runtime: ${result.systemRegistry.counts.runtime}
- Engineering: ${result.systemRegistry.counts.engineering}
- Automation: ${result.systemRegistry.counts.automation}

## Capability Counts
${Object.entries(result.capabilityRegistry).map(([k, v]) => `- ${k}: ${v.length}`).join("\n")}

## COO Autonomy Impact
This discovery layer increases MILES autonomy by allowing it to know:
- what systems already exist,
- what capabilities are already implemented,
- what components depend on each other,
- what event flows exist,
- where future build work should reuse existing code.

## Next Best Build
Add duplicate responsibility detection and orphan component detection into BuilderService.
`;

  fs.writeFileSync(files.executive_report, executive);

  return {
    ok: true,
    outDir: OUT_DIR,
    files,
    summary: result.systemRegistry,
    capabilities: Object.keys(result.capabilityRegistry).sort()
  };
}

module.exports = {
  discover,
  writeReport
};
