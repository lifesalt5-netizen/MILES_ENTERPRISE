const { execSync } = require("child_process");
const path = require("path");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");

function smokeTest() {
  try {
    const out = execSync("node .\\CORE\\Kernel\\StartMiles.js", {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 8000,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { ok: true, output: out };
  } catch (e) {
    return {
      ok: false,
      output: (e.stdout || "") + "\n" + (e.stderr || "") + "\n" + e.message
    };
  }
}

module.exports = { smokeTest };
