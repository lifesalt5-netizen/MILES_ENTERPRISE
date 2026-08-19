"use strict";

const fs = require("fs");

const input = process.argv[2];
if (!input) {
  console.error("Usage: node project_pm2_jlist.js <pm2-jlist.json>");
  process.exit(2);
}

const raw = fs.readFileSync(input, "utf8").replace(/^\uFEFF/, "");
const apps = JSON.parse(raw);

const clean = value => String(value ?? "").replace(/[\t\r\n]/g, " ");

for (const app of apps) {
  const env = app.pm2_env || {};
  process.stdout.write([
    app.pid ?? "",
    app.pm_id ?? "",
    clean(app.name),
    clean(env.status),
    clean(env.pm_cwd),
    clean(env.pm_exec_path)
  ].join("\t") + "\n");
}
