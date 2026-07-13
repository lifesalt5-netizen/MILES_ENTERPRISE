const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");

const IGNORE_DIRS = new Set([
  ".git", "node_modules", "DATABASE", "TEMP", ".vscode"
]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function classify(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".js") return "javascript";
  if (ext === ".ps1") return "powershell";
  if (ext === ".json") return "json";
  if (ext === ".csv") return "csv";
  if (ext === ".md") return "markdown";
  return "other";
}

function scan() {
  const files = walk(ROOT).map(file => {
    const rel = path.relative(ROOT, file);
    const stat = fs.statSync(file);
    return {
      path: rel.replace(/\\/g, "/"),
      type: classify(file),
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString()
    };
  });

  const summary = files.reduce((acc, f) => {
    acc[f.type] = (acc[f.type] || 0) + 1;
    return acc;
  }, {});

  return {
    root: ROOT,
    generatedAt: new Date().toISOString(),
    totalFiles: files.length,
    summary,
    files
  };
}

function writeReport() {
  const report = scan();
  const outDir = path.join(ROOT, "DATA", "builder");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "project_scan.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  return { outFile, report };
}

module.exports = { scan, writeReport };
