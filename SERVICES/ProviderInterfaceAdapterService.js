"use strict";

/**
 * EXEC_006 Provider Interface Adapter Service
 * Complete replacement file.
 */

const fs = require("fs");
const path = require("path");
const authority = require("./ProviderAuthorityRegistryService");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "provider_sync");

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function writeJson(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8"); }

class ProviderInterfaceAdapterService {
    run(input = {}) {
        const registry = authority.run(input);
        const adapters = registry.providers.map(p => this.adapterFor(p));
        const result = {
            ok: true,
            action: "PROVIDER_INTERFACE_ADAPTERS",
            build: "EXEC_006",
            generatedAt: new Date().toISOString(),
            adapters,
            summary: {
                total: adapters.length,
                compatible: adapters.filter(a => a.compatible).length,
                missingMethods: adapters.reduce((sum, a) => sum + a.missingMethods.length, 0)
            },
            outDir: OUT_DIR
        };
        writeJson(path.join(OUT_DIR, "provider_interface_adapters.json"), result);
        return result;
    }

    adapterFor(provider) {
        const required = ["connect", "status", "execute"];
        const optional = ["healthCheck", "verify", "rollback", "report"];
        let moduleObject = null;
        const errors = [];
        try {
            moduleObject = require(`./${provider.module}`);
        } catch (error) {
            errors.push(error.message);
        }
        const methods = [...required, ...optional].map(name => ({ name, present: Boolean(moduleObject && typeof moduleObject[name] === "function") }));
        const missingMethods = methods.filter(m => required.includes(m.name) && !m.present).map(m => m.name);
        return {
            provider: provider.key,
            providerName: provider.name,
            module: provider.module,
            compatible: missingMethods.length === 0,
            methods,
            missingMethods,
            errors
        };
    }
}

module.exports = new ProviderInterfaceAdapterService();
