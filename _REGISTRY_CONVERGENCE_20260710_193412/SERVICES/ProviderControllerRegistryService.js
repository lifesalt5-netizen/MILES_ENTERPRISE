"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "provider_controllers");
function ensureDir(dir){ fs.mkdirSync(dir,{recursive:true}); }
function writeJson(file,value){ ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value,null,2), "utf8"); }
class ProviderControllerRegistryService {
    constructor(){
        this.controllers = {
            instantly: require("./InstantlyProviderController"),
            google_workspace: require("./GoogleWorkspaceProviderController"),
            namecheap: require("./NamecheapProviderController"),
            website: require("./WebsiteProviderController"),
            orion: require("./OrionProviderController"),
            filesystem: require("./FileSystemProviderController")
        };
    }
    get(provider){ return this.controllers[String(provider||"").toLowerCase()] || null; }
    list(){ return Object.values(this.controllers).map(c => c.status()); }
    run(){
        const generatedAt = new Date().toISOString();
        const providers = this.list();
        const result = {
            ok:true,
            action:"PROVIDER_CONTROLLERS",
            type:"MILES_PROVIDER_CONTROLLER_REGISTRY",
            build:"EXEC_002",
            generatedAt,
            providers,
            summary:{ total: providers.length, executable: providers.filter(p=>p.executable).length, credentialsConfigured: providers.filter(p=>p.credentialsPresent).length },
            outDir: OUT_DIR
        };
        ensureDir(OUT_DIR);
        writeJson(path.join(OUT_DIR,"provider_controllers.json"), result);
        fs.writeFileSync(path.join(OUT_DIR,"provider_controllers_report.md"), this.render(result), "utf8");
        return result;
    }
    render(result){ return `# EXEC_002 Provider Controllers\n\nGenerated: ${result.generatedAt}\n\nTotal: ${result.summary.total}\nExecutable: ${result.summary.executable}\nCredentials Configured: ${result.summary.credentialsConfigured}\n\n${result.providers.map(p=>`- ${p.providerName} (${p.provider}) — executable=${p.executable}, credentials=${p.credentialsPresent}`).join("\n")}\n`; }
}
module.exports = new ProviderControllerRegistryService();
