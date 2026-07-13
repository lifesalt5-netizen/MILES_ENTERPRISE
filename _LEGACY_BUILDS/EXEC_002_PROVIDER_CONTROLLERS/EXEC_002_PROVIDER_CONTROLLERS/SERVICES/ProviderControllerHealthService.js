"use strict";
const fs = require("fs");
const path = require("path");
const registry = require("./ProviderControllerRegistryService");
const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT,"DATA","provider_controllers");
function ensureDir(dir){ fs.mkdirSync(dir,{recursive:true}); }
function writeJson(file,value){ ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value,null,2), "utf8"); }
class ProviderControllerHealthService {
    async run(){
        const generatedAt = new Date().toISOString();
        const providers = registry.list();
        const checks = providers.map(p=>({ ok:true, provider:p.provider, providerName:p.providerName, executable:p.executable, credentialsPresent:p.credentialsPresent, status:p.executable ? "READY" : "INSTALLED_SAFE_MODE" }));
        const result = { ok:true, action:"PROVIDER_CONTROLLER_HEALTH", build:"EXEC_002", generatedAt, status:"READY", checks, summary:{ total:checks.length, ready:checks.filter(c=>c.executable).length, safeMode:checks.filter(c=>!c.executable).length } };
        ensureDir(OUT_DIR); writeJson(path.join(OUT_DIR,"provider_controller_health.json"), result); return result;
    }
}
module.exports = new ProviderControllerHealthService();
