"use strict";
const fs = require("fs");
const path = require("path");
const registry = require("./ProviderControllerRegistryService");
const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT,"DATA","provider_controllers");
const HISTORY = path.join(OUT_DIR,"provider_execution_history.json");
function ensureDir(dir){ fs.mkdirSync(dir,{recursive:true}); }
function readJson(file,fallback){ try{ if(!fs.existsSync(file)) return fallback; return JSON.parse(fs.readFileSync(file,"utf8")); } catch { return fallback; } }
function writeJson(file,value){ ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value,null,2), "utf8"); }
function append(record){ const h = readJson(HISTORY, []); h.push(record); writeJson(HISTORY, h.slice(-1000)); }
class ProviderControllerExecutionService {
    async run(input={}){
        const actionRecord = input.actionRecord || input;
        const providerKey = String(actionRecord.provider || "filesystem").toLowerCase();
        const controller = registry.get(providerKey);
        const generatedAt = new Date().toISOString();
        if(!controller){
            const result = { ok:false, action:"PROVIDER_CONTROLLER_EXECUTION", generatedAt, provider:providerKey, status:"UNKNOWN_PROVIDER", executed:false };
            append(result); return result;
        }
        const connection = await controller.connect();
        const execution = await controller.execute(actionRecord);
        const verification = await controller.verify(actionRecord, execution);
        const result = { ok:true, action:"PROVIDER_CONTROLLER_EXECUTION", build:"EXEC_002", generatedAt, provider:providerKey, operation: actionRecord.operation, connection, execution, verification, status: verification.verified ? "VERIFIED" : execution.status, executed: execution.executed === true, verified: verification.verified === true };
        ensureDir(OUT_DIR); writeJson(path.join(OUT_DIR,"latest_provider_execution.json"), result); append(result); return result;
    }
}
module.exports = new ProviderControllerExecutionService();
