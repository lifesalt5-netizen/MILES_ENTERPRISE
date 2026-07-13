"use strict";
const systemRootGuard = require("./SERVICES/SystemRootGuard");
systemRootGuard.enforce();
const guardResult = systemRootGuard.enforce();

if (guardResult.status === "FRAGMENTED") {
  console.log("");
  console.log("====================================");
  console.log("❌ MILES HARD STOP ACTIVATED");
  console.log("System is fragmented across folders");
  console.log("Fix duplicates before running COO loop");
  console.log("====================================");
  console.log("");

  process.exit(1);
}
const fs = require("fs");
const path = require("path");

class SystemRootGuard {
  constructor() {
    this.root = process.cwd();
    this.requiredRootName = "MILES_OS";
    this.blockedFolders = [
      "MILES_BACKUPS",
      "MILES_OS_BACKUP",
      "MILES_AUTONOMOUS",
      "MILES_ARCHIVE"
    ];
  }

  validateRoot() {
    const ok = this.root.includes(this.requiredRootName);

    if (!ok) {
      throw new Error(
        `[ROOT VIOLATION] System must run inside ${this.requiredRootName}. Current: ${this.root}`
      );
    }

    return true;
  }

  scanForDuplicates(baseDir = this.root) {
    const results = [];

    function walk(dir) {
      try {
        const items = fs.readdirSync(dir);

        for (const item of items) {
          const full = path.join(dir, item);

          try {
            const stat = fs.statSync(full);

            if (stat.isDirectory()) {
              if (
                item.toLowerCase().includes("miles") &&
                item !== "MILES_OS"
              ) {
                results.push(full);
              }

              walk(full);
            }
          } catch {}
        }
      } catch {}
    }

    walk(baseDir);

    return results;
  }

  checkBlockedFolders() {
    const found = [];

    for (const folder of this.blockedFolders) {
      const full = path.join("D:\\P2GC_Intelligence", folder);

      if (fs.existsSync(full)) {
        found.push(full);
      }
    }

    return found;
  }

  generateSystemMap() {
    const duplicates = this.scanForDuplicates();
    const blocked = this.checkBlockedFolders();

    const map = {
      root: this.root,
      timestamp: new Date().toISOString(),
      duplicates,
      blocked,
      status: duplicates.length > 0 || blocked.length > 0 ? "FRAGMENTED" : "CLEAN"
    };

    const outDir = path.join(this.root, "DATA", "system");
    fs.mkdirSync(outDir, { recursive: true });

    fs.writeFileSync(
      path.join(outDir, "system_root_map.json"),
      JSON.stringify(map, null, 2)
    );

    return map;
  }

  enforce() {
    this.validateRoot();

    const map = this.generateSystemMap();

    console.log("\n==============================");
    console.log("MILES SYSTEM ROOT GUARD");
    console.log("==============================");
    console.log("Root:", map.root);
    console.log("Status:", map.status);
    console.log("Duplicates:", map.duplicates.length);
    console.log("Blocked folders:", map.blocked.length);
    console.log("==============================\n");

    if (map.status === "FRAGMENTED") {
      console.log("⚠️ SYSTEM FRAGMENTATION DETECTED");
      console.log("Review system_root_map.json");
    }

    return map;
  }
}

module.exports = new SystemRootGuard();