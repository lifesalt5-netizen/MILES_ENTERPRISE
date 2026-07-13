"use strict";

/** EXEC_006 Provider Capability Binding Service - Complete replacement file. */

const fs = require("fs");
const path = require("path");
const authority = require("./ProviderAuthorityRegistryService");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "provider_sync");

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function writeJson(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8"); }

class ProviderCapabilityBindingService {
    run(input = {}) {
        const registry = authority.run(input);
        const bindings = {};
        for (const provider of registry.providers) {
            bindings[provider.key] = {
                provider: provider.key,
                providerName: provider.name,
                executable: provider.executable,
                status: provider.status,
                credentialsPresent: provider.credentialsPresent,
                readOperations: provider.capabilities.read.operations,
                writeOperations: provider.capabilities.write.operations,
                writeEnabled: provider.capabilities.write.enabled,
                operations: provider.supportedOperations.reduce((acc, op) => {
                    acc[op] = {
                        provider: provider.key,
                        operation: op,
                        executable: provider.executable,
                        readOnly: provider.capabilities.read.operations.includes(op),
                        write: provider.capabilities.write.operations.includes(op),
                        authorized: provider.capabilities.read.operations.includes(op) || provider.capabilities.write.enabled
                    };
                    return acc;
                }, {})
            };
        }
        const result = {
            ok: true,
            action: "PROVIDER_CAPABILITY_BINDINGS",
            build: "EXEC_006",
            generatedAt: new Date().toISOString(),
            bindings,
            summary: {
                providers: Object.keys(bindings).length,
                executableProviders: Object.values(bindings).filter(b => b.executable).length,
                operations: Object.values(bindings).reduce((sum, b) => sum + Object.keys(b.operations).length, 0)
            },
            outDir: OUT_DIR
        };
        writeJson(path.join(OUT_DIR, "provider_capability_bindings.json"), result);
        return result;
    }
}

module.exports = new ProviderCapabilityBindingService();
