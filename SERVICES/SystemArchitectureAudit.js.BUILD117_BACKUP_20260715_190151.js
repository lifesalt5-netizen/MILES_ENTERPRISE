"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..");

const OUTPUT_DIR =
  path.join(ROOT, "DATA", "runtime");

const JSON_REPORT =
  path.join(
    OUTPUT_DIR,
    "build116_architecture_audit.json"
  );

const MD_REPORT =
  path.join(
    OUTPUT_DIR,
    "build116_architecture_audit.md"
  );

const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".idea",
  ".vscode",
  "DATA",
  "_BACKUPS",
  "_LEGACY_BUILDS",
  "runtime",
  "stabilization_backups",
  "MILES_BUILD036_SINGLE_EXECUTION_AUTHORITY",
  "MILES_BUILD037_WORKFLOW_PERSISTENCE",
  "MILES_BUILD037_FINAL_FIX",
  "BUILD041_EXECUTIVE_RUNTIME_EVIDENCE"
]);

const EXCLUDED_FILE_PATTERNS = [
  /\.backup_/i,
  /\.backup\./i,
  /\.bak$/i,
  /\.before_/i,
  /\.beforebuild/i,
  /\.build\d+_backup/i,
  /\.old$/i,
  /_backup_/i,
  /StartProductionSystem_NEW\.js$/i
];

const ENTRYPOINT_NAMES = new Set([
  "StartMilesProduction.js",
  "StartProductionSystem.js",
  "StartAutonomousCOO.js",
  "StartExecutiveDashboard.js",
  "StartMiles.js"
]);

function now() {
  return new Date().toISOString();
}

function normalizeSlash(value) {
  return String(value || "")
    .replace(/\\/g, "/");
}

function relative(file) {
  return normalizeSlash(
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

function shouldExcludeDirectory(name) {
  return EXCLUDED_DIRECTORIES.has(name);
}

function shouldExcludeFile(file) {
  const rel =
    relative(file);

  return EXCLUDED_FILE_PATTERNS.some(
    pattern =>
      pattern.test(rel)
  );
}

function walkDirectory(dir, output = []) {
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
      if (
        shouldExcludeDirectory(
          entry.name
        )
      ) {
        continue;
      }

      walkDirectory(
        full,
        output
      );

      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith(".js") &&
      !shouldExcludeFile(full)
    ) {
      output.push(full);
    }
  }

  return output;
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
    status:
      result.status,
    error:
      String(
        result.stderr ||
        result.stdout ||
        ""
      ).trim()
  };
}

function extractRequires(source) {
  const requires = [];

  const regex =
    /require\s*\(\s*["']([^"']+)["']\s*\)/g;

  let match;

  while (
    (
      match =
        regex.exec(source)
    )
  ) {
    requires.push({
      request:
        match[1],
      index:
        match.index
    });
  }

  return requires;
}

function resolveRequire(
  sourceFile,
  request
) {
  if (
    !request ||
    !request.startsWith(".")
  ) {
    return {
      type: "EXTERNAL",
      request,
      resolved: null,
      exists: true
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
    path.join(
      base,
      "index.js"
    )
  ];

  for (const candidate of candidates) {
    if (
      fs.existsSync(candidate) &&
      fs.statSync(candidate)
        .isFile()
    ) {
      return {
        type: "LOCAL",
        request,
        resolved:
          relative(candidate),
        exists: true
      };
    }
  }

  return {
    type: "LOCAL",
    request,
    resolved:
      relative(
        candidates[1]
      ),
    exists: false
  };
}

function findMatches(
  source,
  regex
) {
  const matches = [];

  let match;

  while (
    (
      match =
        regex.exec(source)
    )
  ) {
    const before =
      source.slice(
        0,
        match.index
      );

    const line =
      before.split(/\r?\n/)
        .length;

    matches.push({
      line,
      text:
        String(
          match[0]
        ).trim()
    });
  }

  return matches;
}

function classifyTaskQueueAdd(
  source
) {
  const calls = [];

  const regex =
    /taskQueue\s*\.\s*add\s*\(([\s\S]{0,800}?)\)\s*;?/g;

  let match;

  while (
    (
      match =
        regex.exec(source)
    )
  ) {
    const args =
      String(
        match[1] ||
        ""
      ).trim();

    const line =
      source
        .slice(
          0,
          match.index
        )
        .split(/\r?\n/)
        .length;

    let classification =
      "UNKNOWN";

    if (
      /^[A-Za-z_$][\w$]*$/
        .test(args)
    ) {
      classification =
        "OBJECT_OR_SINGLE_ARGUMENT";
    } else if (
      args.startsWith("{")
    ) {
      classification =
        "OBJECT_LITERAL";
    } else if (
      args.includes(",")
    ) {
      classification =
        "MULTI_ARGUMENT";
    }

    calls.push({
      line,
      classification,
      expression:
        args.slice(
          0,
          500
        )
    });
  }

  return calls;
}

function detectExports(source) {
  return {
    moduleExports:
      /module\.exports\s*=/
        .test(source),
    namedExports:
      /module\.exports\.[A-Za-z_$]/
        .test(source),
    classDeclarations:
      findMatches(
        source,
        /class\s+[A-Za-z_$][\w$]*/g
      ).map(item => item.text),
    functionDeclarations:
      findMatches(
        source,
        /(?:async\s+)?function\s+[A-Za-z_$][\w$]*/g
      ).map(item => item.text)
  };
}

function analyzeFile(file) {
  const source =
    readText(file);

  const requires =
    extractRequires(source)
      .map(item => ({
        ...item,
        ...resolveRequire(
          file,
          item.request
        )
      }));

  const taskQueueAdds =
    classifyTaskQueueAdd(
      source
    );

  return {
    file:
      relative(file),

    bytes:
      Buffer.byteLength(
        source,
        "utf8"
      ),

    lines:
      source
        .split(/\r?\n/)
        .length,

    syntax:
      checkSyntax(file),

    requires,

    unresolvedRequires:
      requires.filter(
        item =>
          item.type === "LOCAL" &&
          item.exists === false
      ),

    taskQueueAdds,

    taskQueueImports:
      requires.filter(
        item =>
          /(?:^|\/)TaskQueue(?:\.js)?$/
            .test(
              normalizeSlash(
                item.request
              )
            )
      ),

    executionServiceImports:
      requires.filter(
        item =>
          /ExecutionService/
            .test(
              item.request
            )
      ),

    capabilityDispatcherImports:
      requires.filter(
        item =>
          /CapabilityDispatcherService/
            .test(
              item.request
            )
      ),

    queueConsumers: {
      list:
        findMatches(
          source,
          /taskQueue\s*\.\s*list\s*\(/g
        ),
      update:
        findMatches(
          source,
          /taskQueue\s*\.\s*update\s*\(/g
        ),
      claimNext:
        findMatches(
          source,
          /taskQueue\s*\.\s*claimNext\s*\(/g
        ),
      runNext:
        findMatches(
          source,
          /\.runNext\s*\(/g
        )
    },

    runtimePatterns: {
      setInterval:
        findMatches(
          source,
          /setInterval\s*\(/g
        ),
      processSpawn:
        findMatches(
          source,
          /(?:spawn|fork|execFile)\s*\(/g
        ),
      listen:
        findMatches(
          source,
          /\.listen\s*\(/g
        )
    },

    providerPatterns: {
      providerClass:
        /class\s+\w*Provider\b/
          .test(source),
      executeTask:
        /async\s+executeTask\s*\(/
          .test(source),
      refresh:
        /async\s+refresh\s*\(/
          .test(source),
      shutdown:
        /async\s+shutdown\s*\(/
          .test(source)
    },

    exports:
      detectExports(source)
  };
}

function groupByBasename(files) {
  const groups = {};

  for (const file of files) {
    const basename =
      path.basename(file);

    groups[basename] =
      groups[basename] ||
      [];

    groups[basename]
      .push(
        relative(file)
      );
  }

  return Object.entries(groups)
    .filter(
      ([, locations]) =>
        locations.length > 1
    )
    .map(
      ([basename, locations]) => ({
        basename,
        locations
      })
    )
    .sort(
      (a, b) =>
        b.locations.length -
        a.locations.length
    );
}

function buildDependencyGraph(
  analyses
) {
  const graph = {};

  for (const item of analyses) {
    graph[item.file] =
      item.requires
        .filter(
          dependency =>
            dependency.type ===
              "LOCAL" &&
            dependency.exists
        )
        .map(
          dependency =>
            dependency.resolved
        );
  }

  return graph;
}

function findCycles(graph) {
  const cycles = [];
  const visited = new Set();
  const active = new Set();
  const stack = [];

  function visit(node) {
    if (active.has(node)) {
      const index =
        stack.indexOf(node);

      if (index >= 0) {
        cycles.push(
          stack
            .slice(index)
            .concat(node)
        );
      }

      return;
    }

    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    active.add(node);
    stack.push(node);

    const dependencies =
      graph[node] ||
      [];

    for (
      const dependency
      of dependencies
    ) {
      if (
        graph[dependency]
      ) {
        visit(dependency);
      }
    }

    stack.pop();
    active.delete(node);
  }

  for (
    const node
    of Object.keys(graph)
  ) {
    visit(node);
  }

  const unique = [];
  const fingerprints =
    new Set();

  for (const cycle of cycles) {
    const normalized =
      cycle
        .slice(0, -1)
        .sort()
        .join("|");

    if (
      fingerprints.has(
        normalized
      )
    ) {
      continue;
    }

    fingerprints.add(
      normalized
    );

    unique.push(cycle);
  }

  return unique;
}

function inspectQueue() {
  try {
    const taskQueue =
      require(
        path.join(
          ROOT,
          "CORE",
          "TaskQueue"
        )
      );

    const tasks =
      typeof taskQueue.list ===
        "function"
        ? taskQueue.list()
        : [];

    const counts = {};

    for (const task of tasks) {
      const status =
        String(
          task.status ||
          "UNKNOWN"
        ).toUpperCase();

      counts[status] =
        (
          counts[status] ||
          0
        ) + 1;
    }

    const malformed =
      tasks.filter(
        task =>
          typeof task.type ===
            "object" ||
          task.provider ===
            "UNKNOWN" ||
          task.action ===
            "[OBJECT OBJECT]"
      );

    const staleRunning =
      tasks.filter(task => {
        if (
          String(
            task.status
          ).toUpperCase() !==
          "RUNNING"
        ) {
          return false;
        }

        const updated =
          Date.parse(
            task.updatedAt ||
            task.startedAt ||
            task.createdAt ||
            0
          );

        return (
          Number.isFinite(updated) &&
          Date.now() - updated >
            15 * 60 * 1000
        );
      });

    return {
      ok: true,
      total:
        tasks.length,
      counts,
      malformedCount:
        malformed.length,
      staleRunningCount:
        staleRunning.length,
      malformedSample:
        malformed
          .slice(0, 20),
      staleRunningSample:
        staleRunning
          .slice(0, 20)
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error.stack ||
        error.message
    };
  }
}

function calculateSeverity(
  finding
) {
  if (
    finding.category ===
      "SYNTAX" ||
    finding.category ===
      "UNRESOLVED_IMPORT"
  ) {
    return "CRITICAL";
  }

  if (
    finding.category ===
      "TASK_QUEUE_SINGLE_ARGUMENT" ||
    finding.category ===
      "MULTIPLE_EXECUTION_AUTHORITIES"
  ) {
    return "HIGH";
  }

  if (
    finding.category ===
      "DUPLICATE_BASENAME" ||
    finding.category ===
      "CIRCULAR_DEPENDENCY"
  ) {
    return "MEDIUM";
  }

  return "LOW";
}

function buildFindings(
  analyses,
  duplicates,
  cycles,
  queue
) {
  const findings = [];

  for (const item of analyses) {
    if (!item.syntax.ok) {
      findings.push({
        category:
          "SYNTAX",
        file:
          item.file,
        message:
          item.syntax.error ||
          "JavaScript syntax check failed."
      });
    }

    for (
      const dependency
      of item.unresolvedRequires
    ) {
      findings.push({
        category:
          "UNRESOLVED_IMPORT",
        file:
          item.file,
        message:
          `Unresolved local import: ${dependency.request}`,
        resolved:
          dependency.resolved
      });
    }

    for (
      const call
      of item.taskQueueAdds
    ) {
      if (
        call.classification ===
          "OBJECT_OR_SINGLE_ARGUMENT" ||
        call.classification ===
          "OBJECT_LITERAL"
      ) {
        findings.push({
          category:
            "TASK_QUEUE_SINGLE_ARGUMENT",
          file:
            item.file,
          line:
            call.line,
          message:
            "TaskQueue.add is called with one object argument. Verify the authoritative TaskQueue supports complete task objects.",
          expression:
            call.expression
        });
      }
    }
  }

  for (
    const duplicate
    of duplicates
  ) {
    findings.push({
      category:
        "DUPLICATE_BASENAME",
      file:
        duplicate.basename,
      message:
        `Duplicate active basename found in ${duplicate.locations.length} locations.`,
      locations:
        duplicate.locations
    });
  }

  for (const cycle of cycles) {
    findings.push({
      category:
        "CIRCULAR_DEPENDENCY",
      file:
        cycle[0],
      message:
        "Circular local dependency detected.",
      cycle
    });
  }

  const runNextFiles =
    analyses.filter(
      item =>
        item.queueConsumers
          .runNext.length > 0
    );

  if (
    runNextFiles.length > 1
  ) {
    findings.push({
      category:
        "MULTIPLE_EXECUTION_AUTHORITIES",
      file:
        "RUNTIME",
      message:
        `${runNextFiles.length} active files invoke runNext(). Confirm only one production execution authority.`,
      files:
        runNextFiles.map(
          item => ({
            file:
              item.file,
            lines:
              item.queueConsumers
                .runNext
                .map(
                  match =>
                    match.line
                )
          })
        )
    });
  }

  if (
    queue.ok &&
    queue.malformedCount > 0
  ) {
    findings.push({
      category:
        "PERSISTED_MALFORMED_TASKS",
      file:
        "CORE/TaskQueue",
      message:
        `${queue.malformedCount} malformed historical task records remain persisted.`,
      count:
        queue.malformedCount
    });
  }

  if (
    queue.ok &&
    queue.staleRunningCount > 0
  ) {
    findings.push({
      category:
        "STALE_RUNNING_TASKS",
      file:
        "CORE/TaskQueue",
      message:
        `${queue.staleRunningCount} RUNNING task(s) appear stale.`,
      count:
        queue.staleRunningCount
    });
  }

  return findings.map(
    finding => ({
      severity:
        calculateSeverity(
          finding
        ),
      ...finding
    })
  );
}

function summarizeFindings(
  findings
) {
  const summary = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0
  };

  for (const finding of findings) {
    summary[
      finding.severity
    ] =
      (
        summary[
          finding.severity
        ] ||
        0
      ) + 1;
  }

  return summary;
}

function toMarkdown(report) {
  const lines = [];

  lines.push(
    "# BUILD116 — MILES Architecture Audit"
  );

  lines.push("");
  lines.push(
    `Generated: ${report.generatedAt}`
  );

  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(
    `- Active JavaScript files scanned: ${report.summary.filesScanned}`
  );
  lines.push(
    `- Syntax failures: ${report.summary.syntaxFailures}`
  );
  lines.push(
    `- Unresolved local imports: ${report.summary.unresolvedImports}`
  );
  lines.push(
    `- TaskQueue.add call sites: ${report.summary.taskQueueAddCalls}`
  );
  lines.push(
    `- Provider implementations: ${report.summary.providers}`
  );
  lines.push(
    `- Duplicate active basenames: ${report.summary.duplicateBasenames}`
  );
  lines.push(
    `- Circular dependencies: ${report.summary.circularDependencies}`
  );

  lines.push("");
  lines.push("## Finding Severity");
  lines.push("");
  lines.push(
    `- Critical: ${report.findingSummary.CRITICAL}`
  );
  lines.push(
    `- High: ${report.findingSummary.HIGH}`
  );
  lines.push(
    `- Medium: ${report.findingSummary.MEDIUM}`
  );
  lines.push(
    `- Low: ${report.findingSummary.LOW}`
  );

  lines.push("");
  lines.push("## Queue State");
  lines.push("");

  if (report.queue.ok) {
    lines.push(
      `- Total: ${report.queue.total}`
    );

    for (
      const [
        status,
        count
      ]
      of Object.entries(
        report.queue.counts
      )
    ) {
      lines.push(
        `- ${status}: ${count}`
      );
    }

    lines.push(
      `- Malformed historical records: ${report.queue.malformedCount}`
    );

    lines.push(
      `- Stale RUNNING records: ${report.queue.staleRunningCount}`
    );
  } else {
    lines.push(
      `- Queue inspection failed: ${report.queue.error}`
    );
  }

  lines.push("");
  lines.push("## Findings");
  lines.push("");

  if (!report.findings.length) {
    lines.push(
      "No structural findings detected."
    );
  }

  for (
    const finding
    of report.findings
  ) {
    lines.push(
      `### ${finding.severity} — ${finding.category}`
    );

    lines.push("");
    lines.push(
      `File: \`${finding.file}\``
    );

    if (finding.line) {
      lines.push(
        `Line: ${finding.line}`
      );
    }

    lines.push("");
    lines.push(
      finding.message
    );

    if (finding.files) {
      lines.push("");
      lines.push("Affected files:");

      for (
        const item
        of finding.files
      ) {
        lines.push(
          `- \`${item.file}\` — lines ${item.lines.join(", ")}`
        );
      }
    }

    if (finding.locations) {
      lines.push("");
      lines.push("Locations:");

      for (
        const location
        of finding.locations
      ) {
        lines.push(
          `- \`${location}\``
        );
      }
    }

    if (finding.cycle) {
      lines.push("");
      lines.push(
        `Cycle: ${finding.cycle.join(" → ")}`
      );
    }

    lines.push("");
  }

  lines.push("");
  lines.push("## Production Entry Points");
  lines.push("");

  for (
    const entrypoint
    of report.entrypoints
  ) {
    lines.push(
      `- \`${entrypoint.file}\``
    );
  }

  return lines.join("\n");
}

function run() {
  ensureDir(
    OUTPUT_DIR
  );

  const startedAt =
    Date.now();

  console.log("");
  console.log(
    "=============================================="
  );
  console.log(
    " BUILD116 MILES FULL ARCHITECTURE AUDIT"
  );
  console.log(
    "=============================================="
  );

  const files =
    walkDirectory(ROOT);

  console.log(
    `Scanning ${files.length} active JavaScript files...`
  );

  const analyses = [];

  let index = 0;

  for (const file of files) {
    index += 1;

    if (
      index % 50 === 0 ||
      index === files.length
    ) {
      console.log(
        `Checked ${index}/${files.length}`
      );
    }

    analyses.push(
      analyzeFile(file)
    );
  }

  const duplicates =
    groupByBasename(
      files
    );

  const graph =
    buildDependencyGraph(
      analyses
    );

  const cycles =
    findCycles(
      graph
    );

  const queue =
    inspectQueue();

  const findings =
    buildFindings(
      analyses,
      duplicates,
      cycles,
      queue
    );

  const findingSummary =
    summarizeFindings(
      findings
    );

  const entrypoints =
    analyses
      .filter(
        item =>
          ENTRYPOINT_NAMES.has(
            path.basename(
              item.file
            )
          )
      )
      .map(item => ({
        file:
          item.file,
        syntax:
          item.syntax
      }));

  const summary = {
    filesScanned:
      analyses.length,

    syntaxFailures:
      analyses.filter(
        item =>
          !item.syntax.ok
      ).length,

    unresolvedImports:
      analyses.reduce(
        (
          count,
          item
        ) =>
          count +
          item
            .unresolvedRequires
            .length,
        0
      ),

    taskQueueAddCalls:
      analyses.reduce(
        (
          count,
          item
        ) =>
          count +
          item
            .taskQueueAdds
            .length,
        0
      ),

    taskQueueSingleArgumentCalls:
      analyses.reduce(
        (
          count,
          item
        ) =>
          count +
          item.taskQueueAdds
            .filter(
              call =>
                call.classification ===
                  "OBJECT_OR_SINGLE_ARGUMENT" ||
                call.classification ===
                  "OBJECT_LITERAL"
            )
            .length,
        0
      ),

    providers:
      analyses.filter(
        item =>
          item.providerPatterns
            .providerClass
      ).length,

    duplicateBasenames:
      duplicates.length,

    circularDependencies:
      cycles.length,

    runNextAuthorities:
      analyses
        .filter(
          item =>
            item
              .queueConsumers
              .runNext
              .length > 0
        )
        .map(
          item =>
            item.file
        ),

    durationMs:
      Date.now() -
      startedAt
  };

  const report = {
    build:
      "BUILD116",

    generatedAt:
      now(),

    root:
      ROOT,

    summary,

    findingSummary,

    queue,

    entrypoints,

    findings,

    taskQueueCallSites:
      analyses
        .filter(
          item =>
            item
              .taskQueueAdds
              .length > 0
        )
        .map(item => ({
          file:
            item.file,
          calls:
            item.taskQueueAdds
        })),

    executionAuthorities:
      analyses
        .filter(
          item =>
            item
              .queueConsumers
              .runNext
              .length > 0
        )
        .map(item => ({
          file:
            item.file,
          runNext:
            item
              .queueConsumers
              .runNext
        })),

    providers:
      analyses
        .filter(
          item =>
            item.providerPatterns
              .providerClass
        )
        .map(item => ({
          file:
            item.file,
          patterns:
            item.providerPatterns
        })),

    duplicateBasenames:
      duplicates,

    circularDependencies:
      cycles,

    files:
      analyses
  };

  fs.writeFileSync(
    JSON_REPORT,
    JSON.stringify(
      report,
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    MD_REPORT,
    toMarkdown(report),
    "utf8"
  );

  console.log("");
  console.log(
    "BUILD116 AUDIT COMPLETE"
  );

  console.log("");
  console.log(
    `Files scanned: ${summary.filesScanned}`
  );

  console.log(
    `Syntax failures: ${summary.syntaxFailures}`
  );

  console.log(
    `Unresolved imports: ${summary.unresolvedImports}`
  );

  console.log(
    `TaskQueue.add calls: ${summary.taskQueueAddCalls}`
  );

  console.log(
    `Single-object queue calls: ${summary.taskQueueSingleArgumentCalls}`
  );

  console.log(
    `Execution authorities: ${summary.runNextAuthorities.length}`
  );

  console.log(
    `Providers: ${summary.providers}`
  );

  console.log(
    `Circular dependencies: ${summary.circularDependencies}`
  );

  console.log("");
  console.log(
    "Findings:"
  );

  console.log(
    JSON.stringify(
      findingSummary,
      null,
      2
    )
  );

  if (queue.ok) {
    console.log("");
    console.log(
      "Queue:"
    );

    console.log(
      JSON.stringify(
        {
          total:
            queue.total,
          counts:
            queue.counts,
          malformed:
            queue.malformedCount,
          staleRunning:
            queue.staleRunningCount
        },
        null,
        2
      )
    );
  }

  console.log("");
  console.log(
    `JSON report: ${JSON_REPORT}`
  );

  console.log(
    `Markdown report: ${MD_REPORT}`
  );

  console.log("");
  console.log(
    "=============================================="
  );

  return report;
}

if (
  require.main === module
) {
  try {
    run();
  } catch (error) {
    console.error(
      "BUILD116 AUDIT FAILED"
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
