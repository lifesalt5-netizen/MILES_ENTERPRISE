"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const file = path.join(ROOT, "CORE", "TaskQueue.js");

if (!fs.existsSync(file)) {
  throw new Error(`TaskQueue.js not found: ${file}`);
}

let text = fs.readFileSync(file, "utf8");
const signature = "    writeJsonDirect(tasks) {";
const start = text.indexOf(signature);

if (start < 0) {
  throw new Error("writeJsonDirect(tasks) method not found.");
}

let i = start + signature.length;
let depth = 1;
let quote = null;
let escape = false;
let lineComment = false;
let blockComment = false;

for (; i < text.length; i++) {
  const ch = text[i];
  const next = text[i + 1];

  if (lineComment) {
    if (ch === "\n") lineComment = false;
    continue;
  }

  if (blockComment) {
    if (ch === "*" && next === "/") {
      blockComment = false;
      i++;
    }
    continue;
  }

  if (quote) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === quote) quote = null;
    continue;
  }

  if (ch === "'" || ch === '"' || ch === "`") {
    quote = ch;
    continue;
  }

  if (ch === "/" && next === "/") {
    lineComment = true;
    i++;
    continue;
  }

  if (ch === "/" && next === "*") {
    blockComment = true;
    i++;
    continue;
  }

  if (ch === "{") depth++;
  if (ch === "}") {
    depth--;
    if (depth === 0) break;
  }
}

if (depth !== 0) {
  throw new Error("Could not find closing brace for writeJsonDirect(tasks).");
}

const end = i + 1;
const replacement = `    writeJsonDirect(tasks) {
        if (!Array.isArray(tasks)) {
            tasks = [];
        }

        this.ensureRuntime();

        const tmp = \`${"${this.queuePath}"}.tmp_${"${process.pid}"}_${"${Date.now()}"}\`;
        const json = JSON.stringify(tasks, null, 2);

        try {
            // Write a fully materialized temp file first so rename/copy always has a source.
            const fd = fs.openSync(tmp, "w");
            try {
                fs.writeFileSync(fd, json, "utf8");
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }

            if (!fs.existsSync(tmp)) {
                throw new Error(\`TaskQueue temp file was not created: ${"${tmp}"}\`);
            }

            // Preserve the current canonical queue as last-good before replacing it.
            if (fs.existsSync(this.queuePath)) {
                try {
                    fs.copyFileSync(this.queuePath, this.lastGoodPath);
                } catch (backupError) {
                    console.error(
                        "[TaskQueue] Last-good snapshot refresh failed:",
                        backupError.message
                    );
                }
            }

            try {
                fs.renameSync(tmp, this.queuePath);
            } catch (renameError) {
                if (["EPERM", "EACCES", "EBUSY", "EEXIST"].includes(renameError.code)) {
                    console.error(
                        \`[TaskQueue] Atomic rename failed (${"${renameError.code}"}). Falling back to in-place copy: ${"${this.queuePath}"}\`
                    );
                    fs.copyFileSync(tmp, this.queuePath);
                } else {
                    throw renameError;
                }
            }

            // Validate the canonical queue after commit before refreshing last-good.
            const committedRaw = this.sanitizeJsonText(
                fs.readFileSync(this.queuePath, "utf8")
            );
            const committed = JSON.parse(committedRaw);

            if (!Array.isArray(committed)) {
                throw new Error("Committed TaskQueue is not an array.");
            }

            try {
                fs.copyFileSync(this.queuePath, this.lastGoodPath);
            } catch (backupError) {
                console.error(
                    "[TaskQueue] Last-good post-commit refresh failed:",
                    backupError.message
                );
            }
        } catch (error) {
            if (
                !fs.existsSync(this.queuePath) &&
                fs.existsSync(this.lastGoodPath)
            ) {
                fs.copyFileSync(this.lastGoodPath, this.queuePath);
            }

            throw error;
        } finally {
            try {
                if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
            } catch {}
        }
    }`;

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backup = `${file}.BEFORE_WRITEJSONDIRECT_REBUILD_${stamp}`;
fs.copyFileSync(file, backup);

text = text.slice(0, start) + replacement + text.slice(end);
fs.writeFileSync(file, text, "utf8");

console.log("=== TASKQUEUE writeJsonDirect REBUILD P0 ===");
console.log("patched:", file);
console.log("backup :", backup);
console.log("change : rebuilt writeJsonDirect() with temp-file write, fsync, Windows fallback, validation, and last-good recovery");
console.log("next   : node --check .\\CORE\\TaskQueue.js");
