"use strict";

const crypto = require("crypto");
const fs = require("fs");
const moduleApi = require("module");
const path = require("path");

const SOURCE_EXTENSIONS = new Set([".js", ".cjs", ".mjs"]);
const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".git",
  ".github",
  "node_modules",
  "DATA",
  "ARCHIVE",
  "coverage",
  "dist",
  "build",
  "logs",
  "state",
  "recovery"
]);

function normalizeRelative(value) {
  return String(value || "")
    .split(path.sep)
    .join("/")
    .replace(/^\.\//, "");
}

function isInsideRoot(rootDir, targetPath) {
  const relative = path.relative(rootDir, targetPath);
  return (
    relative === "" ||
    (
      !relative.startsWith("..") &&
      !path.isAbsolute(relative)
    )
  );
}

function packageName(specifier) {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0];
}

class RepositoryUnderstandingService {
  constructor(options = {}) {
    this.service = "REPOSITORY_UNDERSTANDING";
    this.rootDir = path.resolve(
      options.rootDir ||
      process.env.MILES_ROOT ||
      path.resolve(__dirname, "..", "..")
    );
    this.ignoredDirectories = new Set(
      options.ignoredDirectories ||
      DEFAULT_IGNORED_DIRECTORIES
    );
    this.maxSourceBytes = Number(
      options.maxSourceBytes || 2 * 1024 * 1024
    );
    this.outputFile =
      options.outputFile ||
      path.join(
        this.rootDir,
        "DATA",
        "runtime",
        "engineering",
        "repository_dependency_graph.json"
      );
    this.generatedAt =
      options.generatedAt ||
      (() => new Date().toISOString());
    this.builtins = new Set(
      moduleApi.builtinModules.flatMap(name => [
        name,
        name.replace(/^node:/, ""),
        `node:${name.replace(/^node:/, "")}`
      ])
    );
  }

  scanFiles() {
    const files = [];
    const skipped = [];
    const visit = directory => {
      const entries = fs
        .readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        if (entry.isSymbolicLink()) {
          skipped.push({
            path: normalizeRelative(
              path.relative(this.rootDir, path.join(directory, entry.name))
            ),
            reason: "SYMLINK_SKIPPED"
          });
          continue;
        }

        if (
          entry.isDirectory() &&
          this.ignoredDirectories.has(entry.name)
        ) {
          continue;
        }

        const fullPath = path.join(directory, entry.name);
        if (!isInsideRoot(this.rootDir, fullPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          visit(fullPath);
          continue;
        }

        const extension = path.extname(entry.name).toLowerCase();
        if (
          SOURCE_EXTENSIONS.has(extension) ||
          normalizeRelative(path.relative(this.rootDir, fullPath)) ===
            "package.json"
        ) {
          const stat = fs.statSync(fullPath);
          if (stat.size > this.maxSourceBytes) {
            skipped.push({
              path: normalizeRelative(
                path.relative(this.rootDir, fullPath)
              ),
              reason: "SOURCE_TOO_LARGE",
              bytes: stat.size
            });
            continue;
          }
          files.push({
            fullPath,
            relativePath: normalizeRelative(
              path.relative(this.rootDir, fullPath)
            ),
            bytes: stat.size
          });
        }
      }
    };

    visit(this.rootDir);
    return { files, skipped };
  }

  parseSpecifiers(source) {
    const found = new Set();
    const patterns = [
      /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
      /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
      /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(source)) !== null) {
        found.add(match[1]);
      }
    }
    return [...found].sort();
  }

  resolveRelative(fromFile, specifier, fileLookup) {
    const basePath = path.resolve(
      path.dirname(fromFile),
      specifier
    );
    const candidates = [
      basePath,
      ...[...SOURCE_EXTENSIONS, ".json"].map(
        extension => `${basePath}${extension}`
      ),
      ...[...SOURCE_EXTENSIONS, ".json"].map(
        extension => path.join(basePath, `index${extension}`)
      )
    ];

    for (const candidate of candidates) {
      if (!isInsideRoot(this.rootDir, candidate)) continue;
      const relative = normalizeRelative(
        path.relative(this.rootDir, candidate)
      );
      const match = fileLookup.get(relative.toLowerCase());
      if (match) return match;
    }
    return null;
  }

  classify(relativePath) {
    const normalized = normalizeRelative(relativePath);
    if (normalized === "package.json") return "MANIFEST";
    if (/^Start[^/]*\.(?:js|cjs|mjs)$/i.test(normalized)) {
      return "ENTRY_POINT";
    }
    if (/^TESTS\//i.test(normalized)) return "TEST";
    if (/^CORE\//i.test(normalized)) return "CORE";
    if (/^SERVICES\//i.test(normalized)) return "SERVICE";
    if (/^CONNECTORS\//i.test(normalized)) return "CONNECTOR";
    if (/^SCRIPTS\//i.test(normalized)) return "SCRIPT";
    if (/^api\//i.test(normalized)) return "API";
    if (/^workers\//i.test(normalized)) return "WORKER";
    return "SOURCE";
  }

  findCycles(adjacency) {
    const state = new Map();
    const stack = [];
    const cycles = new Set();

    const visit = node => {
      state.set(node, 1);
      stack.push(node);

      for (const target of adjacency.get(node) || []) {
        if (!adjacency.has(target)) continue;
        if (!state.has(target)) {
          visit(target);
        } else if (state.get(target) === 1) {
          const start = stack.indexOf(target);
          const cycle = stack.slice(start).concat(target);
          const body = cycle.slice(0, -1);
          const rotations = body.map((_, index) =>
            body.slice(index).concat(body.slice(0, index))
          );
          rotations.sort((a, b) =>
            a.join(">").localeCompare(b.join(">"))
          );
          cycles.add(rotations[0].concat(rotations[0][0]).join(">"));
        }
      }

      stack.pop();
      state.set(node, 2);
    };

    for (const node of [...adjacency.keys()].sort()) {
      if (!state.has(node)) visit(node);
    }

    return [...cycles]
      .sort()
      .slice(0, 100)
      .map(value => value.split(">"));
  }

  readPackageMetadata() {
    const packagePath = path.join(this.rootDir, "package.json");
    if (!fs.existsSync(packagePath)) {
      return {
        ok: true,
        present: false,
        scripts: {},
        declaredPackages: []
      };
    }

    try {
      const manifest = JSON.parse(
        fs.readFileSync(packagePath, "utf8")
      );
      return {
        ok: true,
        present: true,
        name: manifest.name || null,
        version: manifest.version || null,
        scripts: manifest.scripts || {},
        declaredPackages: [
          ...new Set([
            ...Object.keys(manifest.dependencies || {}),
            ...Object.keys(manifest.devDependencies || {}),
            ...Object.keys(manifest.optionalDependencies || {})
          ])
        ].sort()
      };
    } catch (error) {
      return {
        ok: false,
        present: true,
        error: error.message,
        scripts: {},
        declaredPackages: []
      };
    }
  }

  buildGraph() {
    const scan = this.scanFiles();
    const sourceFiles = scan.files.filter(file =>
      SOURCE_EXTENSIONS.has(
        path.extname(file.relativePath).toLowerCase()
      )
    );
    const fileLookup = new Map(
      scan.files.map(file => [
        file.relativePath.toLowerCase(),
        file.relativePath
      ])
    );
    const nodes = [];
    const edges = [];
    const unresolved = [];
    const externalPackages = new Set();

    for (const file of scan.files) {
      const dependencies = [];
      const isSource = SOURCE_EXTENSIONS.has(
        path.extname(file.relativePath).toLowerCase()
      );
      const specifiers = isSource
        ? this.parseSpecifiers(
            fs.readFileSync(file.fullPath, "utf8")
          )
        : [];

      for (const specifier of specifiers) {
        if (
          specifier.startsWith("./") ||
          specifier.startsWith("../")
        ) {
          const target = this.resolveRelative(
            file.fullPath,
            specifier,
            fileLookup
          );
          if (target) {
            edges.push({
              from: file.relativePath,
              to: target,
              specifier
            });
            dependencies.push(target);
          } else {
            unresolved.push({
              from: file.relativePath,
              specifier
            });
          }
          continue;
        }

        const external = packageName(specifier);
        if (!this.builtins.has(specifier) && !this.builtins.has(external)) {
          externalPackages.add(external);
        }
      }

      nodes.push({
        id: file.relativePath,
        type: this.classify(file.relativePath),
        bytes: file.bytes,
        dependencies: [...new Set(dependencies)].sort()
      });
    }

    nodes.sort((a, b) => a.id.localeCompare(b.id));
    edges.sort((a, b) =>
      `${a.from}|${a.to}|${a.specifier}`.localeCompare(
        `${b.from}|${b.to}|${b.specifier}`
      )
    );
    unresolved.sort((a, b) =>
      `${a.from}|${a.specifier}`.localeCompare(
        `${b.from}|${b.specifier}`
      )
    );

    const adjacency = new Map(
      nodes.map(node => [node.id, node.dependencies])
    );
    const cycles = this.findCycles(adjacency);
    const packageMetadata = this.readPackageMetadata();
    const entryPoints = nodes
      .filter(node => node.type === "ENTRY_POINT")
      .map(node => node.id);
    const fingerprint = crypto
      .createHash("sha256")
      .update(JSON.stringify({
        nodes: nodes.map(node => ({
          id: node.id,
          type: node.type,
          bytes: node.bytes
        })),
        edges,
        unresolved,
        externalPackages: [...externalPackages].sort(),
        packageMetadata
      }))
      .digest("hex")
      .toUpperCase();

    const validation = {
      ok:
        packageMetadata.ok === true &&
        new Set(nodes.map(node => node.id)).size === nodes.length &&
        edges.every(edge =>
          adjacency.has(edge.from) &&
          adjacency.has(edge.to)
        ),
      duplicateNodes:
        nodes.length -
        new Set(nodes.map(node => node.id)).size,
      invalidEdges:
        edges.filter(edge =>
          !adjacency.has(edge.from) ||
          !adjacency.has(edge.to)
        ).length,
      packageManifestValid: packageMetadata.ok
    };

    return {
      ok: validation.ok,
      service: this.service,
      mode: "READ_ONLY_ANALYSIS",
      root: this.rootDir,
      generatedAt: this.generatedAt(),
      fingerprint,
      summary: {
        files: nodes.length,
        sourceFiles: sourceFiles.length,
        entryPoints: entryPoints.length,
        internalDependencies: edges.length,
        externalPackages: externalPackages.size,
        unresolvedRelativeImports: unresolved.length,
        dependencyCycles: cycles.length,
        skippedFiles: scan.skipped.length
      },
      validation,
      entryPoints,
      packageMetadata,
      externalPackages: [...externalPackages].sort(),
      nodes,
      edges,
      unresolvedRelativeImports: unresolved,
      dependencyCycles: cycles,
      skippedFiles: scan.skipped
    };
  }

  writeGraph(graph = this.buildGraph()) {
    if (!graph || graph.ok !== true) {
      throw new Error(
        "Repository graph validation failed; artifact was not written."
      );
    }

    fs.mkdirSync(path.dirname(this.outputFile), {
      recursive: true
    });
    const temporary =
      `${this.outputFile}.${process.pid}.${Date.now()}.tmp`;

    fs.writeFileSync(
      temporary,
      JSON.stringify(graph, null, 2),
      "utf8"
    );

    try {
      fs.renameSync(temporary, this.outputFile);
    } catch {
      fs.copyFileSync(temporary, this.outputFile);
      try {
        fs.unlinkSync(temporary);
      } catch {}
    }

    return {
      ok: true,
      filePath: this.outputFile,
      bytes: fs.statSync(this.outputFile).size,
      sha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(this.outputFile))
        .digest("hex")
        .toUpperCase(),
      fingerprint: graph.fingerprint
    };
  }
}

module.exports = RepositoryUnderstandingService;
module.exports.RepositoryUnderstandingService =
  RepositoryUnderstandingService;
module.exports.DEFAULT_IGNORED_DIRECTORIES =
  DEFAULT_IGNORED_DIRECTORIES;
