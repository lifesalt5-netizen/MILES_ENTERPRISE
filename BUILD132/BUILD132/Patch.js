"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const BUILD = "BUILD132";
const packageDir = __dirname;
const root = process.argv[2] || process.env.MILES_ROOT || process.cwd();
const servicesDir = path.join(root, "SERVICES");
const backupRoot = path.join(root, "BACKUPS");
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backupDir = path.join(backupRoot, `${BUILD}_${stamp}`);
const manifestFile = path.join(backupDir, "rollback_manifest.json");

function fail(message) {
  throw new Error(`${BUILD}: ${message}`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copy(source, target) {
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
}

function syntaxCheck(file) {
  cp.execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}

function replaceInstantlyRegistration(file) {
  const patch = JSON.parse(
    fs.readFileSync(path.join(packageDir, "Files", "SERVICES", "ProviderRegistry.js.patch.json"), "utf8")
  );
  let text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  const pattern = /this\.register\(\{\s*id:\s*"INSTANTLY",[\s\S]*?\n\s*\}\);/m;
  const replacement = `this.register({\n            id: "INSTANTLY",\n            department: "Sales",\n            connector: "INSTANTLY",\n            capabilities: ${JSON.stringify(patch.capabilities)},\n            actions: ${JSON.stringify(patch.actions)}\n        });`;
  if (!pattern.test(text)) fail("INSTANTLY ProviderRegistry registration block not found.");
  text = text.replace(pattern, replacement);
  fs.writeFileSync(file, text, "utf8");
}

function rollback(records) {
  for (const record of records.slice().reverse()) {
    if (record.existed) copy(record.backup, record.target);
    else if (fs.existsSync(record.target)) fs.unlinkSync(record.target);
  }
}

function main() {
  if (!fs.existsSync(servicesDir)) fail(`SERVICES directory not found at ${servicesDir}`);
  const required = [
    path.join(servicesDir, "ProviderRegistry.js"),
    path.join(root, "PROVIDERS", "providers", "InstantlyProvider.js"),
    path.join(root, "CONNECTORS", "INSTANTLY", "instantly.js")
  ];
  required.forEach(file => { if (!fs.existsSync(file)) fail(`Missing dependency: ${file}`); });

  ensureDir(backupDir);
  const targets = [
    path.join(servicesDir, "InstantlyLiveIntegrationService.js"),
    path.join(servicesDir, "ProviderRegistry.js")
  ];
  const records = targets.map(target => {
    const existed = fs.existsSync(target);
    const backup = path.join(backupDir, path.basename(target));
    if (existed) copy(target, backup);
    return { target, backup, existed };
  });
  fs.writeFileSync(manifestFile, JSON.stringify({ build: BUILD, root, createdAt: new Date().toISOString(), records }, null, 2));

  try {
    copy(
      path.join(packageDir, "Files", "SERVICES", "InstantlyLiveIntegrationService.js"),
      path.join(servicesDir, "InstantlyLiveIntegrationService.js")
    );
    replaceInstantlyRegistration(path.join(servicesDir, "ProviderRegistry.js"));
    syntaxCheck(path.join(servicesDir, "InstantlyLiveIntegrationService.js"));
    syntaxCheck(path.join(servicesDir, "ProviderRegistry.js"));
    console.log(`${BUILD} PATCH COMPLETE`);
    console.log(`BACKUP: ${backupDir}`);
  } catch (error) {
    rollback(records);
    console.error(`${BUILD} FAILED. AUTOMATIC ROLLBACK COMPLETE.`);
    throw error;
  }
}

main();
