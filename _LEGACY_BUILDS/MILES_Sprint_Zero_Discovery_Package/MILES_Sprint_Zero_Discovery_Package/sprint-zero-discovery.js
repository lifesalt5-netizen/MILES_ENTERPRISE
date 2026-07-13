#!/usr/bin/env node
/**
 * MILES Sprint Zero Discovery
 * Purpose: inventory existing MILES architecture before any new business functionality is built.
 * Run from repo root:
 *   node tools/sprint-zero-discovery.js
 *
 * Outputs:
 *   sprint_zero_output/*.json
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const OUT = path.join(ROOT, "sprint_zero_output");

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "coverage", ".turbo",
  "sprint_zero_output", "archive", "archives", ".venv", "venv", "__pycache__"
]);

const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".ps1", ".json", ".yml", ".yaml", ".sql"]);

function ensureOut() {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
}

function walk(dir, acc = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (IGNORE_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else {
      const ext = path.extname(e.name).toLowerCase();
      if (CODE_EXT.has(ext)) acc.push(full);
    }
  }
  return acc;
}

function safeRead(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

function rel(file) { return path.relative(ROOT, file).replaceAll("\\", "/"); }

function classify(file, text) {
  const r = rel(file).toLowerCase();
  const name = path.basename(file).toLowerCase();
  const hits = [];
  const add = (type, why) => hits.push({ type, why });

  if (r.includes("service") || /class\s+\w*service\b/i.test(text) || /Service\b/.test(text)) add("service", "service naming or class pattern");
  if (r.includes("worker") || /worker/i.test(name) || /process\.on\(|parentPort|bull|queue/i.test(text)) add("worker", "worker/queue pattern");
  if (r.includes("provider") || /provider/i.test(name) || /class\s+\w*provider\b/i.test(text)) add("provider", "provider naming or class pattern");
  if (r.includes("connector") || /connector/i.test(name) || /class\s+\w*connector\b/i.test(text)) add("connector", "connector naming or class pattern");
  if (r.includes("api") || r.includes("routes") || /express\.Router|app\.(get|post|put|delete)|router\.(get|post|put|delete)/i.test(text)) add("api", "API route pattern");
  if (/EventEmitter|eventBus|publish\(|subscribe\(|emit\(|on\(/i.test(text)) add("event_bus", "event bus/publish-subscribe pattern");
  if (r.includes("db") || r.includes("database") || /\.(db|sqlite)$/i.test(r) || /sqlite|sequelize|prisma|knex|CREATE TABLE|SELECT\s+.+\s+FROM/i.test(text)) add("database", "database/query/schema pattern");
  if (/pm2|ecosystem\.config|AutonomousCOOLoopService|ProductionCOOEngine|runtime|scheduler|loop/i.test(text + " " + r)) add("runtime", "runtime/loop/pm2 pattern");
  if (/atlas|inspector|drift|schema enforcement|schema registry|dependency|health/i.test(text + " " + r)) add("engineering", "engineering/inspection/health pattern");
  if (/automation|queue|approval|task|command|execute|orchestr/i.test(text + " " + r)) add("automation", "automation/task execution pattern");
  if (/mission|objective|governance|authority|approval|Kevin|MILES/i.test(text + " " + r)) add("mission_system", "mission/governance pattern");

  return hits.length ? hits : [{ type: "unclassified", why: "no known pattern" }];
}

function extractDeps(file, text) {
  const deps = new Set();
  const patterns = [
    /require\(["']([^"']+)["']\)/g,
    /from\s+["']([^"']+)["']/g,
    /import\s+["']([^"']+)["']/g
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(text)) !== null) deps.add(m[1]);
  }
  return [...deps];
}

function extractEvents(text) {
  const published = new Set();
  const subscribed = new Set();

  const publishPatterns = [
    /\.emit\(["']([^"']+)["']/g,
    /publish\(["']([^"']+)["']/g,
    /eventBus\.emit\(["']([^"']+)["']/g,
    /eventBus\.publish\(["']([^"']+)["']/g
  ];
  const subPatterns = [
    /\.on\(["']([^"']+)["']/g,
    /subscribe\(["']([^"']+)["']/g,
    /eventBus\.on\(["']([^"']+)["']/g,
    /eventBus\.subscribe\(["']([^"']+)["']/g
  ];

  for (const p of publishPatterns) {
    let m; while ((m = p.exec(text)) !== null) published.add(m[1]);
  }
  for (const p of subPatterns) {
    let m; while ((m = p.exec(text)) !== null) subscribed.add(m[1]);
  }

  return { published: [...published], subscribed: [...subscribed] };
}

function guessName(file, text) {
  const classMatch = text.match(/class\s+([A-Za-z0-9_]+)/);
  if (classMatch) return classMatch[1];
  return path.basename(file, path.extname(file));
}

function registry(items, type) {
  return items
    .filter(x => x.types.some(t => t.type === type))
    .map(x => ({
      name: x.name,
      file: x.file,
      language: x.ext.replace(".", ""),
      reasons: x.types.filter(t => t.type === type).map(t => t.why),
      dependencies: x.dependencies,
      events_published: x.events.published,
      events_subscribed: x.events.subscribed,
      status: x.legacy ? "legacy_candidate" : "active_or_unknown"
    }));
}

function duplicateReport(items) {
  const byNormName = {};
  for (const item of items) {
    const norm = item.name.toLowerCase()
      .replace(/service|worker|provider|connector|engine|runtime|loop|manager|controller/g, "")
      .replace(/[^a-z0-9]/g, "");
    if (!norm) continue;
    if (!byNormName[norm]) byNormName[norm] = [];
    byNormName[norm].push(item);
  }

  const dupes = [];
  for (const [key, group] of Object.entries(byNormName)) {
    if (group.length > 1) {
      dupes.push({
        normalized_key: key,
        count: group.length,
        files: group.map(g => ({ name: g.name, file: g.file, categories: g.types.map(t => t.type) })),
        recommendation: "Review for duplicate responsibility. Reuse/extend strongest active component; archive legacy candidates."
      });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    duplicate_candidates: dupes,
    hard_rule: "No duplicate workers, services, providers, connectors, runtime loops, or architecture."
  };
}

function orphanReport(items) {
  const allFiles = new Set(items.map(i => "./" + i.file).concat(items.map(i => i.file)));
  const imported = new Set();
  for (const i of items) {
    for (const d of i.dependencies) {
      if (d.startsWith(".")) imported.add(d);
    }
  }
  const candidates = items.filter(i =>
    i.types.some(t => t.type !== "unclassified") &&
    i.dependencies.length === 0 &&
    i.events.published.length === 0 &&
    i.events.subscribed.length === 0 &&
    !/index|main|server|app|ecosystem|package/i.test(i.file)
  );

  return {
    generated_at: new Date().toISOString(),
    orphan_candidates: candidates.map(c => ({
      name: c.name,
      file: c.file,
      categories: c.types.map(t => t.type),
      recommendation: "Inspect usage manually before archive; likely standalone/prototype/orphan if not referenced by runtime config."
    }))
  };
}

function buildRecommendations(system, dupes, orphans) {
  const hasCapabilityRegistry = system.files.some(f => /capability.*registry/i.test(f.file + f.name));
  const hasSystemRegistry = system.files.some(f => /system.*registry/i.test(f.file + f.name));
  const hasDependencyGraph = system.files.some(f => /dependency.*graph/i.test(f.file + f.name));
  const hasEventGraph = system.files.some(f => /event.*graph/i.test(f.file + f.name));

  const recs = [];
  if (!hasSystemRegistry) recs.push({
    priority: 1,
    recommendation: "Implement or formalize SYSTEM_REGISTRY.json generation from discovery output.",
    reason: "MILES needs a current self-model before safe autonomous improvement.",
    success_metric_yes: ["increases MILES autonomy", "allows MILES to improve itself"]
  });
  if (!hasCapabilityRegistry) recs.push({
    priority: 1,
    recommendation: "Create CAPABILITY_REGISTRY.json as the operating map of what MILES can do.",
    reason: "MILES cannot autonomously choose work if it cannot identify its own capabilities.",
    success_metric_yes: ["reduces Kevin's operational workload", "allows MILES to operate another part of P2GC without Kevin"]
  });
  if (!hasDependencyGraph) recs.push({
    priority: 1,
    recommendation: "Promote DEPENDENCY_GRAPH.json into runtime engineering governance.",
    reason: "Impact analysis is required before self-repair and safe deployment.",
    success_metric_yes: ["allows MILES to repair itself"]
  });
  if (!hasEventGraph) recs.push({
    priority: 1,
    recommendation: "Promote EVENT_GRAPH.json into runtime engineering governance.",
    reason: "MILES must know event producers and consumers to avoid breaking loops.",
    success_metric_yes: ["increases MILES autonomy", "allows MILES to repair itself"]
  });
  if (dupes.duplicate_candidates.length) recs.push({
    priority: 2,
    recommendation: "Resolve duplicate candidates before adding new functionality.",
    reason: `${dupes.duplicate_candidates.length} duplicate responsibility groups found.`,
    success_metric_yes: ["allows MILES to improve itself", "increases MILES autonomy"]
  });
  if (orphans.orphan_candidates.length) recs.push({
    priority: 2,
    recommendation: "Review and archive orphan candidates after validation.",
    reason: `${orphans.orphan_candidates.length} possible orphan components found.`,
    success_metric_yes: ["allows MILES to improve itself"]
  });

  return {
    generated_at: new Date().toISOString(),
    engineering_lifecycle: ["Discover", "Analyze", "Reuse", "Extend", "Build", "Validate", "Test", "Deploy", "Verify", "Report"],
    recommendations: recs,
    no_build_before: "System inventory, duplicate report, orphan report, dependency graph, and event graph are reviewed."
  };
}

function write(name, data) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2));
}

function main() {
  ensureOut();
  const files = walk(ROOT);
  const items = files.map(file => {
    const text = safeRead(file);
    const types = classify(file, text);
    return {
      name: guessName(file, text),
      file: rel(file),
      ext: path.extname(file).toLowerCase(),
      size_bytes: fs.statSync(file).size,
      types,
      dependencies: extractDeps(file, text),
      events: extractEvents(text),
      legacy: /legacy|old|archive|deprecated|ProductionCOOEngine/i.test(file + " " + text.slice(0, 5000))
    };
  });

  const counts = {};
  for (const item of items) {
    for (const t of item.types) counts[t.type] = (counts[t.type] || 0) + 1;
  }

  const system = {
    generated_at: new Date().toISOString(),
    root: ROOT,
    active_runtime_rule: "AutonomousCOOLoopService is active COO runtime. ProductionCOOEngine is legacy unless explicitly validated otherwise.",
    total_files_scanned: items.length,
    category_counts: counts,
    files: items
  };

  const eventGraph = {
    generated_at: new Date().toISOString(),
    publishers: items.filter(i => i.events.published.length).map(i => ({ file: i.file, name: i.name, events: i.events.published })),
    subscribers: items.filter(i => i.events.subscribed.length).map(i => ({ file: i.file, name: i.name, events: i.events.subscribed }))
  };

  const depGraph = {
    generated_at: new Date().toISOString(),
    dependencies: items.map(i => ({ file: i.file, name: i.name, dependencies: i.dependencies }))
  };

  const dupes = duplicateReport(items);
  const orphans = orphanReport(items);
  const recs = buildRecommendations(system, dupes, orphans);

  write("SYSTEM_REGISTRY.json", system);
  write("SERVICE_REGISTRY.json", registry(items, "service"));
  write("WORKER_REGISTRY.json", registry(items, "worker"));
  write("PROVIDER_REGISTRY.json", registry(items, "provider"));
  write("CONNECTOR_REGISTRY.json", registry(items, "connector"));
  write("API_REGISTRY.json", registry(items, "api"));
  write("DATABASE_REGISTRY.json", registry(items, "database"));
  write("RUNTIME_REGISTRY.json", registry(items, "runtime"));
  write("ENGINEERING_REGISTRY.json", registry(items, "engineering"));
  write("AUTOMATION_REGISTRY.json", registry(items, "automation"));
  write("MISSION_SYSTEM_REGISTRY.json", registry(items, "mission_system"));
  write("EVENT_GRAPH.json", eventGraph);
  write("DEPENDENCY_GRAPH.json", depGraph);
  write("DUPLICATE_REPORT.json", dupes);
  write("ORPHAN_REPORT.json", orphans);
  write("BUILD_RECOMMENDATIONS.json", recs);

  console.log("MILES Sprint Zero Discovery complete.");
  console.log(`Scanned: ${items.length} files`);
  console.log(`Output: ${OUT}`);
  console.log("Next: Review DUPLICATE_REPORT.json, ORPHAN_REPORT.json, BUILD_RECOMMENDATIONS.json");
}

main();
