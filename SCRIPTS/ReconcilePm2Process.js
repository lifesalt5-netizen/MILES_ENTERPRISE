"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.env.MILES_ROOT || process.cwd();
let PM2_CLI_CACHE = null;

function normalizePath(value) {
  if (!value) return "";
  const resolved = path.resolve(String(value));
  return process.platform === "win32" ? resolved.replace(/\//g, "\\").toLowerCase() : resolved;
}
function appPath(app) { return normalizePath(app && app.pm2_env && app.pm2_env.pm_exec_path); }
function normalizeArgs(value) { if (Array.isArray(value)) return value.map(v => String(v)); if (value == null || value === "") return []; return [String(value)]; }
function argsEqual(a,b) { const left=normalizeArgs(a), right=normalizeArgs(b); return left.length===right.length && left.every((v,i)=>v===right[i]); }

function existingFile(value) {
  if (!value) return null;
  try {
    const resolved = path.resolve(String(value));
    return fs.statSync(resolved).isFile() ? resolved : null;
  } catch { return null; }
}

function pm2CliCandidates(env = process.env) {
  const candidates = [];
  const add = value => { if (value) candidates.push(value); };

  add(env.MILES_PM2_CLI);
  add(path.join(ROOT, "node_modules", "pm2", "bin", "pm2"));
  if (env.APPDATA) add(path.join(env.APPDATA, "npm", "node_modules", "pm2", "bin", "pm2"));
  if (env.npm_config_prefix) add(path.join(env.npm_config_prefix, "node_modules", "pm2", "bin", "pm2"));
  if (env.NPM_CONFIG_PREFIX) add(path.join(env.NPM_CONFIG_PREFIX, "node_modules", "pm2", "bin", "pm2"));

  if (process.platform === "win32") {
    try {
      const where = spawnSync("where.exe", ["pm2"], { cwd: ROOT, env, encoding: "utf8", windowsHide: true });
      const wrappers = String(where.stdout || "").split(/\r?\n/).map(v => v.trim()).filter(Boolean);
      for (const wrapper of wrappers) {
        const dir = path.dirname(wrapper);
        add(path.join(dir, "node_modules", "pm2", "bin", "pm2"));
      }
    } catch {}
  }

  return [...new Set(candidates.map(v => path.resolve(String(v))))];
}

function resolvePm2Cli(env = process.env) {
  if (PM2_CLI_CACHE && existingFile(PM2_CLI_CACHE)) return PM2_CLI_CACHE;
  for (const candidate of pm2CliCandidates(env)) {
    const found = existingFile(candidate);
    if (found) {
      PM2_CLI_CACHE = found;
      return found;
    }
  }
  const searched = pm2CliCandidates(env);
  throw new Error(`PM2 CLI JavaScript entry point not found. Searched: ${searched.join(", ") || "no candidates"}. Set MILES_PM2_CLI to the full path of pm2\\bin\\pm2 if PM2 is installed in a custom location.`);
}

function spawnPm2(args) {
  const common = { cwd:ROOT, env:process.env, encoding:"utf8", windowsHide:true };
  const cli = resolvePm2Cli(process.env);
  return spawnSync(process.execPath, [cli, ...args], common);
}

function runPm2(args, allowFailure = false) {
  const result = spawnPm2(args);
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || result.error?.stack || result.error?.message || "");
  const code = typeof result.status === "number" ? result.status : 1;
  if (result.error && !allowFailure) throw result.error;
  if (code !== 0 && !allowFailure) throw new Error(`pm2 ${args.join(" ")} failed (${code}): ${stderr || stdout}`.trim());
  return { code, stdout, stderr };
}

function parsePm2Jlist(raw) {
  const text = String(raw || "").replace(/\u001b\[[0-9;]*m/g, "").trim();
  try {
    const parsed = JSON.parse(text || "[]");
    if (Array.isArray(parsed)) return parsed;
  } catch {}
  const lines = text.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  throw new Error(`Unable to parse PM2 jlist output: ${text.slice(0, 2000)}`);
}

function readApps() {
  const r=runPm2(["jlist"]);
  return parsePm2Jlist(r.stdout);
}

function buildPlan(apps,name,scriptPath,scriptArgs=[]) {
  const targetPath=normalizePath(scriptPath); const desiredArgs=normalizeArgs(scriptArgs); const named=apps.find(app=>String(app.name)===String(name))||null; const sameScript=apps.filter(app=>appPath(app)===targetPath); const deleteIds=[];
  if(named&&(appPath(named)!==targetPath||!argsEqual(named.pm2_env?.args,desiredArgs))) deleteIds.push(named.pm_id);
  for(const app of sameScript) if(String(app.name)!==String(name)) deleteIds.push(app.pm_id);
  return {targetPath,namedCorrect:Boolean(named&&appPath(named)===targetPath&&argsEqual(named.pm2_env?.args,desiredArgs)),desiredArgs,deleteIds:[...new Set(deleteIds.filter(v=>v!==undefined&&v!==null))]};
}
function sleep(ms){const end=Date.now()+ms;while(Date.now()<end)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Math.min(250,end-Date.now()));}
function waitForOnline(name,scriptPath,timeoutMs=20000){const targetPath=normalizePath(scriptPath);const deadline=Date.now()+timeoutMs;let last=null;while(Date.now()<deadline){const apps=readApps();last=apps.find(app=>String(app.name)===String(name))||null;if(last&&appPath(last)===targetPath&&last.pm2_env?.status==="online"&&Number(last.pid||0)>0)return last;sleep(500);}throw new Error(`PM2 app ${name} did not become online. Last state=${JSON.stringify(last)}`);}
function removeConflicts(name,scriptPath,scriptArgs=[]){const apps=readApps();const plan=buildPlan(apps,name,scriptPath,scriptArgs);for(const id of plan.deleteIds){const r=runPm2(["delete",String(id)],true);if(r.code!==0)throw new Error(`Unable to delete conflicting PM2 app id=${id}: ${r.stderr||r.stdout}`);}return readApps();}

function reconcile(name,scriptArg,scriptArgs=[]) {
  const scriptPath=path.resolve(ROOT,scriptArg); const desiredArgs=normalizeArgs(scriptArgs); let apps=removeConflicts(name,scriptPath,desiredArgs); const named=apps.find(app=>String(app.name)===String(name))||null;
  if(named&&appPath(named)===normalizePath(scriptPath)&&argsEqual(named.pm2_env?.args,desiredArgs)){
    const r=runPm2(["restart",name,"--update-env"],true);if(r.code!==0)throw new Error(`Unable to restart ${name}: ${r.stderr||r.stdout}`);
  }else{
    const startArgs=["start",scriptPath,"--name",name,"--update-env"];if(desiredArgs.length)startArgs.push("--",...desiredArgs);
    let r=runPm2(startArgs,true);
    if(r.code!==0&&/already launched/i.test(`${r.stdout}\n${r.stderr}`)){
      apps=readApps();const same=apps.filter(app=>appPath(app)===normalizePath(scriptPath));for(const app of same){const del=runPm2(["delete",String(app.pm_id)],true);if(del.code!==0)throw new Error(`Unable to remove stale script registration id=${app.pm_id}`);}r=runPm2(startArgs,true);
    }
    if(r.code!==0)throw new Error(`Unable to create canonical PM2 app ${name}: ${r.stderr||r.stdout}`.trim());
  }
  const online=waitForOnline(name,scriptPath);const finalApps=readApps();const duplicates=finalApps.filter(app=>appPath(app)===normalizePath(scriptPath)&&String(app.name)!==String(name));if(duplicates.length)throw new Error(`Duplicate PM2 registrations remain for ${scriptPath}: ${duplicates.map(x=>`${x.name}#${x.pm_id}`).join(", ")}`);
  const result={ok:true,name,pid:Number(online.pid||0),status:online.pm2_env?.status||null,script:online.pm2_env?.pm_exec_path||null,pmId:online.pm_id,args:normalizeArgs(online.pm2_env?.args),pm2Cli:resolvePm2Cli(process.env)};console.log(JSON.stringify(result));return result;
}

if(require.main===module){const [name,scriptArg,...scriptArgs]=process.argv.slice(2);if(!name||!scriptArg){console.error("Usage: node SCRIPTS/ReconcilePm2Process.js <name> <scriptPath> [script args...]");process.exit(2);}try{reconcile(name,scriptArg,scriptArgs)}catch(error){console.error(error.stack||error.message);process.exit(1);}}
module.exports={normalizePath,appPath,normalizeArgs,argsEqual,buildPlan,reconcile,runPm2,spawnPm2,pm2CliCandidates,resolvePm2Cli,parsePm2Jlist};
