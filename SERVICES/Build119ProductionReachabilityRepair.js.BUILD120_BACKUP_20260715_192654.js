"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..");

const AUDIT_FILE =
  path.join(
    ROOT,
    "DATA",
    "runtime",
    "build116_architecture_audit.json"
  );

const BUILD118_FILE =
  path.join(
    ROOT,
    "DATA",
    "runtime",
    "build118_import_repair.json"
  );

const REPORT_FILE =
  path.join(
    ROOT,
    "DATA",
    "runtime",
    "build119_production_reachability_repair.json"
  );

const BACKUP_ROOT =
  path.join(
    ROOT,
    "DATA",
    "runtime",
    "build119_backups",
    new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, "")
      .slice(0, 14)
  );

const ENTRYPOINTS = [
  "StartMilesProduction.js",
  "StartProductionSystem.js",
  "StartAutonomousCOO.js",
  "SERVICES/digital_coo/MilesCommandCenter.js",
  "StartExecutiveDashboard.js"
];

const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".idea",
  ".vscode",
  "DATA",
  "runtime",
  "_BACKUPS",
  "_LEGACY_BUILDS",
  "TESTS",
  "stabilization_backups"
]);

function normalize(value) {
  return String(value || "")
    .replace(/\\/g, "/");
}

function relative(file) {
  return normalize(
    path.relative(ROOT, file)
  );
}

function ensureDir(dir) {
  fs.mkdirSync(
    dir,
    {
      recursive: true
    }
  );
}

function readText(file) {
  try {
    return fs.readFileSync(
      file,
      "utf8"
    );
  } catch {
    return "";
  }
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(
      fs.readFileSync(
        file,
        "utf8"
      )
    );
  } catch {
    return fallback;
  }
}

function excludedDirectory(name) {
  return (
    EXCLUDED_DIRECTORIES.has(name) ||
    name.startsWith("_REGISTRY_CONVERGENCE_") ||
    name.startsWith("MILES_BUILD") ||
    name.startsWith("BUILD041_") ||
    name.startsWith("BUILD042_") ||
    name.startsWith("BUILD043_")
  );
}

function excludedFile(file) {
  const value =
    relative(file);

  return (
    /\.backup/i.test(value) ||
    /\.bak$/i.test(value) ||
    /\.old$/i.test(value) ||
    /_backup_/i.test(value) ||
    /StartProductionSystem_NEW\.js$/i.test(value) ||
    /TestExecutionEngine\.js$/i.test(value) ||
    /RunCanonicalCoreTest\.js$/i.test(value)
  );
}

function walk(dir, output = []) {
  let entries = [];

  try {
    entries =
      fs.readdirSync(
        dir,
        {
          withFileTypes: true
        }
      );
  } catch {
    return output;
  }

  for (const entry of entries) {
    const full =
      path.join(
        dir,
        entry.name
      );

    if (entry.isDirectory()) {
      if (!excludedDirectory(entry.name)) {
        walk(full, output);
      }

      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith(".js") &&
      !excludedFile(full)
    ) {
      output.push(full);
    }
  }

  return output;
}

function extractRequires(source) {
  const results = [];

  const regex =
    /require\s*\(\s*["']([^"']+)["']\s*\)/g;

  let match;

  while (
    (
      match =
        regex.exec(source)
    )
  ) {
    results.push({
      request:
        match[1],

      index:
        match.index,

      line:
        source
          .slice(0, match.index)
          .split(/\r?\n/)
          .length
    });
  }

  return results;
}

function resolveRequest(
  sourceFile,
  request
) {
  if (!request.startsWith(".")) {
    return {
      external: true,
      exists: true,
      resolved: null
    };
  }

  const base =
    path.resolve(
      path.dirname(sourceFile),
      request
    );

  const candidates = [
    base,
    `${base}.js`,
    path.join(base, "index.js")
  ];

  for (const candidate of candidates) {
    if (
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
    ) {
      return {
        external: false,
        exists: true,
        resolved: candidate
      };
    }
  }

  return {
    external: false,
    exists: false,
    resolved: `${base}.js`
  };
}

function buildGraph(files) {
  const graph =
    new Map();

  const unresolved = [];

  for (const file of files) {
    const source =
      readText(file);

    const dependencies = [];

    for (
      const item
      of extractRequires(source)
    ) {
      const result =
        resolveRequest(
          file,
          item.request
        );

      if (
        !result.external &&
        result.exists
      ) {
        dependencies.push(
          result.resolved
        );
      }

      if (
        !result.external &&
        !result.exists
      ) {
        unresolved.push({
          sourceFile:
            file,

          source:
            relative(file),

          request:
            item.request,

          expected:
            relative(
              result.resolved
            ),

          line:
            item.line
        });
      }
    }

    graph.set(
      file,
      dependencies
    );
  }

  return {
    graph,
    unresolved
  };
}

function getEntrypointFiles() {
  return ENTRYPOINTS
    .map(item =>
      path.join(ROOT, item)
    )
    .filter(file =>
      fs.existsSync(file)
    );
}

function computeReachable(
  graph,
  roots
) {
  const reachable =
    new Set();

  const stack =
    [...roots];

  while (stack.length) {
    const current =
      stack.pop();

    if (
      !current ||
      reachable.has(current)
    ) {
      continue;
    }

    reachable.add(current);

    const dependencies =
      graph.get(current) ||
      [];

    for (
      const dependency
      of dependencies
    ) {
      if (!reachable.has(dependency)) {
        stack.push(dependency);
      }
    }
  }

  return reachable;
}

function basenameWithoutExtension(value) {
  return path
    .basename(
      normalize(value)
        .replace(/\/index$/i, ""),
      ".js"
    )
    .toLowerCase();
}

function commonPrefixScore(
  sourceFile,
  candidate
) {
  const sourceParts =
    relative(sourceFile)
      .split("/");

  const candidateParts =
    relative(candidate)
      .split("/");

  let score = 0;

  const limit =
    Math.min(
      sourceParts.length,
      candidateParts.length
    );

  for (
    let index = 0;
    index < limit;
    index += 1
  ) {
    if (
      sourceParts[index] !==
      candidateParts[index]
    ) {
      break;
    }

    score += 20;
  }

  return score;
}

function scoreCandidate(
  sourceFile,
  request,
  candidate,
  reachable
) {
  let score = 0;

  const sourceRelative =
    relative(sourceFile);

  const candidateRelative =
    relative(candidate);

  const requestNormalized =
    normalize(request)
      .replace(/\.js$/i, "");

  const requestedBase =
    basenameWithoutExtension(
      requestNormalized
    );

  const candidateBase =
    basenameWithoutExtension(
      candidate
    );

  if (
    requestedBase ===
    candidateBase
  ) {
    score += 100;
  }

  score +=
    commonPrefixScore(
      sourceFile,
      candidate
    );

  if (
    reachable.has(candidate)
  ) {
    score += 60;
  }

  const sourceTop =
    sourceRelative.split("/")[0];

  const candidateTop =
    candidateRelative.split("/")[0];

  if (
    sourceTop ===
    candidateTop
  ) {
    score += 35;
  }

  if (
    candidateRelative.startsWith(
      "CORE/"
    )
  ) {
    score += 10;
  }

  if (
    candidateRelative.startsWith(
      "SERVICES/"
    )
  ) {
    score += 10;
  }

  if (
    /CANONICAL/i.test(request) &&
    /CANONICAL/i.test(
      candidateRelative
    )
  ) {
    score += 40;
  }

  if (
    /provider/i.test(request) &&
    /PROVIDERS\//i.test(
      candidateRelative
    )
  ) {
    score += 25;
  }

  if (
    /backup|legacy|test|registry_convergence/i
      .test(candidateRelative)
  ) {
    score -= 200;
  }

  return score;
}

function candidateFiles(
  allFiles,
  request
) {
  const wanted =
    basenameWithoutExtension(
      request
    );

  return allFiles.filter(
    file =>
      basenameWithoutExtension(file) ===
      wanted
  );
}

function makeRelativeRequire(
  sourceFile,
  targetFile
) {
  let value =
    normalize(
      path.relative(
        path.dirname(sourceFile),
        targetFile
      )
    );

  value =
    value.replace(
      /\.js$/i,
      ""
    );

  if (!value.startsWith(".")) {
    value = `./${value}`;
  }

  return value;
}

function replaceRequire(
  source,
  oldRequest,
  newRequest
) {
  const escaped =
    oldRequest.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const regex =
    new RegExp(
      `(require\\s*\\(\\s*["'])${escaped}(["']\\s*\\))`,
      "g"
    );

  let count = 0;

  const updated =
    source.replace(
      regex,
      (
        complete,
        prefix,
        suffix
      ) => {
        count += 1;

        return (
          prefix +
          newRequest +
          suffix
        );
      }
    );

  return {
    updated,
    count
  };
}

function backupFile(file) {
  const destination =
    path.join(
      BACKUP_ROOT,
      path.relative(ROOT, file)
    );

  ensureDir(
    path.dirname(destination)
  );

  fs.copyFileSync(
    file,
    destination
  );

  return destination;
}

function checkSyntax(file) {
  const result =
    spawnSync(
      process.execPath,
      [
        "--check",
        file
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30000
      }
    );

  return {
    ok:
      result.status === 0,

    output:
      String(
        result.stderr ||
        result.stdout ||
        ""
      ).trim()
  };
}

function findExecutionAuthorities(
  files,
  reachable
) {
  const results = [];

  for (const file of files) {
    if (!reachable.has(file)) {
      continue;
    }

    const source =
      readText(file);

    const regex =
      /\.runNext\s*\(/g;

    let match;

    while (
      (
        match =
          regex.exec(source)
      )
    ) {
      results.push({
        file:
          relative(file),

        line:
          source
            .slice(0, match.index)
            .split(/\r?\n/)
            .length
      });
    }
  }

  return results;
}

function findCycles(
  graph,
  reachable
) {
  const cycles = [];
  const completed =
    new Set();

  const active =
    new Set();

  const stack = [];

  function visit(node) {
    if (!reachable.has(node)) {
      return;
    }

    if (active.has(node)) {
      const index =
        stack.indexOf(node);

      if (index >= 0) {
        cycles.push(
          stack
            .slice(index)
            .concat(node)
            .map(relative)
        );
      }

      return;
    }

    if (completed.has(node)) {
      return;
    }

    active.add(node);
    stack.push(node);

    for (
      const dependency
      of graph.get(node) || []
    ) {
      visit(dependency);
    }

    stack.pop();
    active.delete(node);
    completed.add(node);
  }

  for (const node of reachable) {
    visit(node);
  }

  const unique = [];
  const fingerprints =
    new Set();

  for (const cycle of cycles) {
    const fingerprint =
      cycle
        .slice(0, -1)
        .sort()
        .join("|");

    if (
      fingerprints.has(
        fingerprint
      )
    ) {
      continue;
    }

    fingerprints.add(
      fingerprint
    );

    unique.push(cycle);
  }

  return unique;
}

function run() {
  console.log("");
  console.log(
    "=============================================="
  );
  console.log(
    " BUILD119 PRODUCTION REACHABILITY REPAIR"
  );
  console.log(
    "=============================================="
  );

  ensureDir(BACKUP_ROOT);

  const files =
    walk(ROOT);

  const initial =
    buildGraph(files);

  const roots =
    getEntrypointFiles();

  const reachable =
    computeReachable(
      initial.graph,
      roots
    );

  const liveUnresolved =
    initial.unresolved.filter(
      item =>
        reachable.has(
          item.sourceFile
        )
    );

  const repairResults = [];

  for (
    const dependency
    of liveUnresolved
  ) {
    const candidates =
      candidateFiles(
        files,
        dependency.request
      );

    const ranked =
      candidates
        .map(candidate => ({
          candidate,
          file:
            relative(candidate),
          score:
            scoreCandidate(
              dependency.sourceFile,
              dependency.request,
              candidate,
              reachable
            )
        }))
        .sort(
          (a, b) =>
            b.score -
            a.score
        );

    if (!ranked.length) {
      repairResults.push({
        ...dependency,
        status:
          "NO_CANDIDATE"
      });

      continue;
    }

    const best =
      ranked[0];

    const second =
      ranked[1] ||
      {
        score:
          Number.NEGATIVE_INFINITY
      };

    const margin =
      best.score -
      second.score;

    if (
      best.score < 100 ||
      margin < 30
    ) {
      repairResults.push({
        ...dependency,

        status:
          "AMBIGUOUS",

        candidates:
          ranked.map(item => ({
            file:
              item.file,
            score:
              item.score
          }))
      });

      continue;
    }

    const source =
      readText(
        dependency.sourceFile
      );

    const newRequest =
      makeRelativeRequire(
        dependency.sourceFile,
        best.candidate
      );

    const replacement =
      replaceRequire(
        source,
        dependency.request,
        newRequest
      );

    if (
      replacement.count === 0
    ) {
      repairResults.push({
        ...dependency,

        status:
          "PATTERN_NOT_FOUND",

        selected:
          best.file,

        newRequest
      });

      continue;
    }

    const backup =
      backupFile(
        dependency.sourceFile
      );

    fs.writeFileSync(
      dependency.sourceFile,
      replacement.updated,
      "utf8"
    );

    const syntax =
      checkSyntax(
        dependency.sourceFile
      );

    if (!syntax.ok) {
      fs.copyFileSync(
        backup,
        dependency.sourceFile
      );

      repairResults.push({
        ...dependency,

        status:
          "ROLLED_BACK",

        selected:
          best.file,

        syntaxError:
          syntax.output
      });

      continue;
    }

    repairResults.push({
      ...dependency,

      status:
        "REPAIRED",

      selected:
        best.file,

      selectedScore:
        best.score,

      margin,

      newRequest,

      backup:
        relative(backup)
    });
  }

  const finalFiles =
    walk(ROOT);

  const finalGraph =
    buildGraph(finalFiles);

  const finalRoots =
    getEntrypointFiles();

  const finalReachable =
    computeReachable(
      finalGraph.graph,
      finalRoots
    );

  const finalLiveUnresolved =
    finalGraph.unresolved.filter(
      item =>
        finalReachable.has(
          item.sourceFile
        )
    );

  const executionAuthorities =
    findExecutionAuthorities(
      finalFiles,
      finalReachable
    );

  const cycles =
    findCycles(
      finalGraph.graph,
      finalReachable
    );

  const build116 =
    readJson(
      AUDIT_FILE,
      {}
    );

  const build118 =
    readJson(
      BUILD118_FILE,
      {}
    );

  const summary = {
    filesDiscovered:
      finalFiles.length,

    productionEntrypoints:
      finalRoots.map(relative),

    reachableProductionFiles:
      finalReachable.size,

    unreachableFiles:
      finalFiles.length -
      finalReachable.size,

    unresolvedBefore:
      liveUnresolved.length,

    repaired:
      repairResults.filter(
        item =>
          item.status ===
          "REPAIRED"
      ).length,

    ambiguous:
      repairResults.filter(
        item =>
          item.status ===
          "AMBIGUOUS"
      ).length,

    noCandidate:
      repairResults.filter(
        item =>
          item.status ===
          "NO_CANDIDATE"
      ).length,

    rolledBack:
      repairResults.filter(
        item =>
          item.status ===
          "ROLLED_BACK"
      ).length,

    unresolvedAfter:
      finalLiveUnresolved.length,

    activeExecutionAuthorities:
      executionAuthorities.length,

    activeCircularDependencies:
      cycles.length
  };

  const report = {
    build:
      "BUILD119",

    generatedAt:
      new Date().toISOString(),

    priorAuditSummary:
      build116.summary ||
      null,

    priorBuild118Summary:
      build118.summary ||
      null,

    summary,

    repairResults,

    unresolvedProductionImports:
      finalLiveUnresolved.map(item => ({
        source:
          item.source,

        request:
          item.request,

        expected:
          item.expected,

        line:
          item.line
      })),

    executionAuthorities,

    circularDependencies:
      cycles,

    reachableFiles:
      Array.from(
        finalReachable
      )
        .map(relative)
        .sort(),

    backupRoot:
      BACKUP_ROOT
  };

  fs.writeFileSync(
    REPORT_FILE,
    JSON.stringify(
      report,
      null,
      2
    ),
    "utf8"
  );

  console.log("");
  console.log(
    "BUILD119 COMPLETE"
  );

  console.log("");
  console.log(
    JSON.stringify(
      summary,
      null,
      2
    )
  );

  console.log("");
  console.log(
    "Active execution authorities:"
  );

  console.log(
    JSON.stringify(
      executionAuthorities,
      null,
      2
    )
  );

  console.log("");
  console.log(
    "Active circular dependencies:"
  );

  console.log(
    JSON.stringify(
      cycles,
      null,
      2
    )
  );

  console.log("");
  console.log(
    `Report: ${REPORT_FILE}`
  );

  console.log(
    `Backups: ${BACKUP_ROOT}`
  );

  return report;
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(
      "BUILD119 FAILED"
    );

    console.error(
      error.stack ||
      error.message
    );

    process.exitCode = 1;
  }
}

module.exports = {
  run
};
