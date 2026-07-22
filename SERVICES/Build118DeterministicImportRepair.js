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

const REPORT_FILE =
  path.join(
    ROOT,
    "DATA",
    "runtime",
    "build118_import_repair.json"
  );

const BACKUP_ROOT =
  path.join(
    ROOT,
    "DATA",
    "runtime",
    "build118_backups",
    new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, "")
      .slice(0, 14)
  );

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "DATA",
  "runtime",
  "_BACKUPS",
  "_LEGACY_BUILDS",
  "TESTS",
  "stabilization_backups",
  "MILES_BUILD036_SINGLE_EXECUTION_AUTHORITY",
  "MILES_BUILD037_WORKFLOW_PERSISTENCE",
  "MILES_BUILD037_FINAL_FIX",
  "BUILD041_EXECUTIVE_RUNTIME_EVIDENCE"
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
  fs.mkdirSync(dir, {
    recursive: true
  });
}

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, "utf8")
  );
}

function readText(file) {
  return fs.readFileSync(
    file,
    "utf8"
  );
}

function syntaxCheck(file) {
  const result =
    spawnSync(
      process.execPath,
      ["--check", file],
      {
        cwd: ROOT,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30000
      }
    );

  return {
    ok: result.status === 0,
    output: String(
      result.stderr ||
      result.stdout ||
      ""
    ).trim()
  };
}

function excludedDirectory(name) {
  return (
    EXCLUDED_DIRS.has(name) ||
    name.startsWith("_REGISTRY_CONVERGENCE_") ||
    name.startsWith("MILES_BUILD") ||
    name.startsWith("BUILD041_") ||
    name.startsWith("BUILD042_") ||
    name.startsWith("BUILD043_")
  );
}

function excludedFile(file) {
  const rel = relative(file);

  return (
    /\.backup/i.test(rel) ||
    /\.bak$/i.test(rel) ||
    /_backup_/i.test(rel) ||
    /\.old$/i.test(rel) ||
    /StartProductionSystem_NEW\.js$/i.test(rel) ||
    /TestExecutionEngine\.js$/i.test(rel) ||
    /RunCanonicalCoreTest\.js$/i.test(rel)
  );
}

function walk(dir, output = []) {
  let entries = [];

  try {
    entries = fs.readdirSync(dir, {
      withFileTypes: true
    });
  } catch {
    return output;
  }

  for (const entry of entries) {
    const full =
      path.join(dir, entry.name);

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

function requestBasename(request) {
  const cleaned =
    normalize(request)
      .replace(/\/index$/i, "")
      .replace(/\.js$/i, "");

  return path.posix.basename(cleaned);
}

function candidateFiles(
  allFiles,
  request
) {
  const wanted =
    requestBasename(request)
      .toLowerCase();

  return allFiles.filter(file => {
    const base =
      path.basename(
        file,
        ".js"
      ).toLowerCase();

    return base === wanted;
  });
}

function makeRelativeRequire(
  sourceFile,
  targetFile,
  originalRequest
) {
  let value =
    normalize(
      path.relative(
        path.dirname(sourceFile),
        targetFile
      )
    );

  value =
    value.replace(/\.js$/i, "");

  if (!value.startsWith(".")) {
    value = `./${value}`;
  }

  if (
    /\/index$/i.test(value) &&
    !/\/index$/i.test(originalRequest)
  ) {
    value =
      value.replace(/\/index$/i, "");
  }

  return value;
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

  let replacements = 0;

  const updated =
    source.replace(
      regex,
      (
        full,
        prefix,
        suffix
      ) => {
        replacements += 1;

        return (
          prefix +
          newRequest +
          suffix
        );
      }
    );

  return {
    updated,
    replacements
  };
}

function collectUnresolved(audit) {
  const output = [];

  for (const item of audit.files || []) {
    for (
      const dependency
      of item.unresolvedRequires || []
    ) {
      output.push({
        source:
          item.file,

        request:
          dependency.request,

        expected:
          dependency.resolved || null
      });
    }
  }

  return output;
}

function run() {
  console.log("");
  console.log(
    "=============================================="
  );
  console.log(
    " BUILD118 DETERMINISTIC IMPORT REPAIR"
  );
  console.log(
    "=============================================="
  );

  if (!fs.existsSync(AUDIT_FILE)) {
    throw new Error(
      `Audit not found: ${AUDIT_FILE}`
    );
  }

  ensureDir(BACKUP_ROOT);

  const audit =
    readJson(AUDIT_FILE);

  const unresolved =
    collectUnresolved(audit);

  const allFiles =
    walk(ROOT);

  const results = [];
  const changedFiles =
    new Set();

  for (const dependency of unresolved) {
    const sourceFile =
      path.join(
        ROOT,
        dependency.source
      );

    if (!fs.existsSync(sourceFile)) {
      results.push({
        ...dependency,
        status:
          "SKIPPED_SOURCE_MISSING"
      });

      continue;
    }

    const candidates =
      candidateFiles(
        allFiles,
        dependency.request
      );

    if (candidates.length === 0) {
      results.push({
        ...dependency,
        status:
          "SKIPPED_NO_CANDIDATE"
      });

      continue;
    }

    if (candidates.length > 1) {
      results.push({
        ...dependency,
        status:
          "SKIPPED_AMBIGUOUS",
        candidates:
          candidates.map(relative)
      });

      continue;
    }

    const targetFile =
      candidates[0];

    const newRequest =
      makeRelativeRequire(
        sourceFile,
        targetFile,
        dependency.request
      );

    if (
      newRequest ===
      dependency.request
    ) {
      results.push({
        ...dependency,
        status:
          "SKIPPED_SAME_PATH",
        target:
          relative(targetFile)
      });

      continue;
    }

    const original =
      readText(sourceFile);

    const replacement =
      replaceRequire(
        original,
        dependency.request,
        newRequest
      );

    if (
      replacement.replacements === 0
    ) {
      results.push({
        ...dependency,
        status:
          "SKIPPED_PATTERN_NOT_FOUND",
        target:
          relative(targetFile),
        proposedRequest:
          newRequest
      });

      continue;
    }

    const backup =
      backupFile(sourceFile);

    fs.writeFileSync(
      sourceFile,
      replacement.updated,
      "utf8"
    );

    const syntax =
      syntaxCheck(sourceFile);

    if (!syntax.ok) {
      fs.copyFileSync(
        backup,
        sourceFile
      );

      results.push({
        ...dependency,
        status:
          "ROLLED_BACK_SYNTAX_FAILURE",
        target:
          relative(targetFile),
        proposedRequest:
          newRequest,
        syntaxError:
          syntax.output
      });

      continue;
    }

    changedFiles.add(
      relative(sourceFile)
    );

    results.push({
      ...dependency,
      status:
        "REPAIRED",
      target:
        relative(targetFile),
      newRequest,
      replacements:
        replacement.replacements,
      backup:
        relative(backup)
    });
  }

  const summary = {
    total:
      results.length,

    repaired:
      results.filter(
        item =>
          item.status === "REPAIRED"
      ).length,

    noCandidate:
      results.filter(
        item =>
          item.status ===
          "SKIPPED_NO_CANDIDATE"
      ).length,

    ambiguous:
      results.filter(
        item =>
          item.status ===
          "SKIPPED_AMBIGUOUS"
      ).length,

    patternNotFound:
      results.filter(
        item =>
          item.status ===
          "SKIPPED_PATTERN_NOT_FOUND"
      ).length,

    rolledBack:
      results.filter(
        item =>
          item.status ===
          "ROLLED_BACK_SYNTAX_FAILURE"
      ).length,

    changedFiles:
      changedFiles.size
  };

  const report = {
    build:
      "BUILD118",

    generatedAt:
      new Date().toISOString(),

    sourceAudit:
      AUDIT_FILE,

    backupRoot:
      BACKUP_ROOT,

    summary,

    changedFiles:
      Array.from(changedFiles),

    results
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
    "BUILD118 COMPLETE"
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
      "BUILD118 FAILED"
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
