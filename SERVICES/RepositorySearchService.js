"use strict";

/*
  MILES Enterprise
  File: SERVICES/RepositorySearchService.js
  Purpose:
    Fast repository-wide source search without traversing generated data,
    dependencies, backups, or archived builds.
*/

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "DATA",
  "BACKUPS",
  "backup",
  "backups",
  "runtime",
  "_REFERENCE",
  "_LEGACY_BUILDS",
  "_REGISTRY_CONVERGENCE_20260710_192356",
  "_REGISTRY_CONVERGENCE_20260710_193412",
  "MILES_Runtime_Registry_Service_V2_v2.0"
]);

const ALLOWED_EXTENSIONS = new Set([
  ".js",
  ".json",
  ".ps1",
  ".md",
  ".txt",
  ".yml",
  ".yaml"
]);

function now() {
  return new Date().toISOString();
}

function safeRead(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return "";
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;

  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(full, results);
      continue;
    }

    if (ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }

  return results;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSearchPatterns(task = {}) {
  const payload = task.payload || {};
  const plan = payload.plan || task.plan || {};

  const source =
    task.query ||
    task.pattern ||
    payload.query ||
    payload.pattern ||
    plan.originalCommand ||
    plan.objective ||
    payload.objective ||
    payload.command ||
    task.command ||
    "";

  if (Array.isArray(source)) {
    return source.map(String).map(v => v.trim()).filter(Boolean).slice(0, 30);
  }

  const text = String(source);
  const quoted = [...text.matchAll(/["'`](.+?)["'`]/g)]
    .map(match => match[1].trim())
    .filter(Boolean);

  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !/^search the repository/i.test(line))
    .filter(line => !/^return:/i.test(line))
    .filter(line => !/^\d+\./.test(line))
    .filter(line => line.length <= 160);

  const candidates = [...quoted, ...lines];
  const unique = [];

  for (const candidate of candidates) {
    if (!unique.includes(candidate)) unique.push(candidate);
  }

  return unique.slice(0, 30);
}

class RepositorySearchService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || ROOT;
    this.outDir = path.join(this.rootDir, "DATA", "repository_search");
  }

  relative(file) {
    return path.relative(this.rootDir, file).replace(/\\/g, "/");
  }

  searchPatterns(patterns = []) {
    const normalized = patterns
      .map(pattern => pattern instanceof RegExp ? pattern : String(pattern).trim())
      .filter(Boolean);

    const compiled = normalized.map(pattern => ({
      source: String(pattern),
      regex: pattern instanceof RegExp
        ? pattern
        : new RegExp(escapeRegex(pattern), "i")
    }));

    if (!compiled.length) return [];

    const files = walk(this.rootDir);
    const matches = [];

    for (const file of files) {
      const text = safeRead(file);
      if (!text) continue;

      const lines = text.split(/\r?\n/);

      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];

        for (const pattern of compiled) {
          if (pattern.regex.test(line)) {
            matches.push({
              file: this.relative(file),
              line: index + 1,
              pattern: pattern.source,
              text: line.trim()
            });
          }
        }
      }
    }

    return matches;
  }

  findWriteCapabilities() {
    return this.searchPatterns([
      "writeFile",
      "writeFileSync",
      "createWriteStream",
      "CodeWriter",
      "ReplacementWriter",
      "ReplacementGenerator",
      "PatchEngine",
      "PatchGenerator",
      "CodeGenerator",
      "EngineeringWriter",
      "RuntimeWriter",
      "TemplateEngine",
      "PROPOSAL_CREATED",
      "productionModified",
      "approvalRequired",
      "safeMode"
    ]);
  }

  inspectEngineeringService() {
    const file = path.join(
      this.rootDir,
      "SERVICES",
      "EngineeringImprovementService.js"
    );

    const text = safeRead(file);
    const lines = text.split(/\r?\n/);
    const methods = [];

    for (let index = 0; index < lines.length; index++) {
      const match = lines[index].match(/^\s*(\w+)\s*\([^)]*\)\s*\{/);

      if (match) {
        methods.push({
          method: match[1],
          line: index + 1,
          text: lines[index].trim()
        });
      }
    }

    return {
      file: "SERVICES/EngineeringImprovementService.js",
      exists: fs.existsSync(file),
      methods,
      containsWriteFile: /writeFile|writeFileSync|createWriteStream/.test(text),
      containsProposalCreated: /PROPOSAL_CREATED/.test(text),
      containsProductionModifiedFalse: /productionModified:\s*false/.test(text),
      containsApprovalRequiredTrue: /approvalRequired:\s*true/.test(text),
      containsSafeModeTrue: /safeMode:\s*true/.test(text)
    };
  }

  auditCodeWriterCapability() {
    const matches = this.findWriteCapabilities();
    const engineering = this.inspectEngineeringService();

    const codeWriterNamedMatches = matches.filter(match =>
      /CodeWriter|ReplacementWriter|ReplacementGenerator|PatchEngine|PatchGenerator|CodeGenerator|EngineeringWriter|RuntimeWriter|TemplateEngine/i.test(
        match.text
      )
    );

    const writeMatches = matches.filter(match =>
      /writeFile|writeFileSync|createWriteStream/i.test(match.text)
    );

    return {
      ok: true,
      service: "RepositorySearchService",
      action: "CODE_WRITER_CAPABILITY_AUDIT",
      rootDir: this.rootDir,
      generatedAt: now(),
      productionCodeGenerationEngineExists: codeWriterNamedMatches.length > 0,
      engineeringService: engineering,
      counts: {
        totalMatches: matches.length,
        writeMatches: writeMatches.length,
        codeWriterNamedMatches: codeWriterNamedMatches.length
      },
      writeMatches,
      codeWriterNamedMatches,
      allMatches: matches
    };
  }

  search(task = {}) {
    const patterns = extractSearchPatterns(task);
    const matches = this.searchPatterns(patterns);

    return {
      ok: true,
      service: "RepositorySearchService",
      action: "REPOSITORY_SEARCH",
      query: patterns,
      count: matches.length,
      matches,
      searchedAt: now()
    };
  }

  report(task = {}) {
    const payload = task.payload || {};
    const plan = payload.plan || task.plan || {};

    const action = String(
      task.action ||
      plan.action ||
      payload.action ||
      task.type ||
      "CODE_WRITER_CAPABILITY_AUDIT"
    ).toUpperCase();

    const result =
      action === "REPOSITORY_SEARCH"
        ? this.search(task)
        : this.auditCodeWriterCapability(task);

    fs.mkdirSync(this.outDir, { recursive: true });

    const outFile = path.join(
      this.outDir,
      `${action.toLowerCase()}_${Date.now()}.json`
    );

    fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");

    return {
      ...result,
      outFile
    };
  }

  run(task = {}) {
    const payload = task.payload || {};
    const plan = payload.plan || task.plan || {};

    const action = String(
      task.action ||
      plan.action ||
      payload.action ||
      task.type ||
      "CODE_WRITER_CAPABILITY_AUDIT"
    ).toUpperCase();

    if (
      action === "REPOSITORY_SEARCH" ||
      action === "CODE_WRITER_CAPABILITY_AUDIT" ||
      action === "REPOSITORY_EVIDENCE_REPORT"
    ) {
      return this.report(task);
    }

    return {
      ok: false,
      service: "RepositorySearchService",
      action,
      error: `Unsupported repository search action: ${action}`,
      supportedActions: [
        "REPOSITORY_SEARCH",
        "CODE_WRITER_CAPABILITY_AUDIT",
        "REPOSITORY_EVIDENCE_REPORT"
      ]
    };
  }

  async execute(task = {}) {
    return this.run(task);
  }
}

module.exports = new RepositorySearchService();