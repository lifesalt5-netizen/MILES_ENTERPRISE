const { execSync } = require("child_process");
const path = require("path");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");

function run(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function status() {
  try { return run("git status --short"); }
  catch (e) { return e.message; }
}

function currentBranch() {
  try { return run("git branch --show-current"); }
  catch { return "unknown"; }
}

function commit(message) {
  run("git add .");
  const s = status();
  if (!s) return "No changes to commit.";
  return run(`git commit -m "${message.replace(/"/g, "'")}"`);
}

module.exports = { run, status, currentBranch, commit };
