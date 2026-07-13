const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");

function safePath(relativePath) {
  const full = path.resolve(ROOT, relativePath);
  if (!full.startsWith(ROOT)) {
    throw new Error(`Unsafe path outside repo: ${relativePath}`);
  }
  return full;
}

function read(relativePath) {
  const full = safePath(relativePath);
  return fs.readFileSync(full, "utf8");
}

function write(relativePath, content) {
  const full = safePath(relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
  return full;
}

function exists(relativePath) {
  return fs.existsSync(safePath(relativePath));
}

module.exports = { read, write, exists, safePath };
