"use strict";

/**
 * EXEC_006 Provider Synchronization Service
 * Complete replacement file.
 */

const fs = require("fs");
const path = require("path");
const authority = require("./ProviderAuthorityRegistryService");
const adapters = require("./ProviderInterfaceAdapterService");
const bindings = require("./ProviderCapabilityBindingService");
const instantly = require("./InstantlyProviderCompatibilityService");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "provider_sync");

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function writeJson(file, value) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8"); }

class ProviderSynchronizationService {
    async run(input = {}) {
        const startedAt = Date.now();
        const registry = authority.run(input);
        const interfaceAdapters = adapters.run(input);
        const capabilityBindings = bindings.run(input);
        const liveReadTest = await this.liveReadTest(input);

        const mismatches = this.detectMismatches(registry, interfaceAdapters, capabilityBindings, liveReadTest);
        const result = {
            ok: mismatches.filter(m => m.severity === "ERROR").length === 0,
            action: "PROVIDER_SYNC",
            type: "MILES_PROVIDER_SYNCHRONIZATION",
            build: "EXEC_006",
            generatedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
            registry,
            interfaceAdapters,
            capabilityBindings,
            liveReadTest,
            mismatches,
            summary: {
                providers: registry.summary.total,
                ready: registry.summary.ready,
                readReady: registry.summary.readReady,
                writeReady: registry.summary.writeReady,
                compatibleAdapters: interfaceAdapters.summary.compatible,
                mismatches: mismatches.length,
                errors: mismatches.filter(m => m.severity === "ERROR").length,
                instantlyReadReady: Boolean(liveReadTest?.ok)
            },
            outDir: OUT_DIR
        };
        writeJson(path.join(OUT_DIR, "provider_synchronization.json"), result);
        writeJson(path.join(OUT_DIR, "latest_provider_synchronization.json"), result);
        fs.writeFileSync(path.join(OUT_DIR, "provider_synchronization_report.md"), this.renderReport(result), "utf8");
        return result;
    }

    async liveReadTest(input = {}) {
        if (input.skipLiveRead === true) return { ok: true, skipped: true, reason: "skipLiveRead requested" };
        if (!process.env.INSTANTLY_API_KEY) {
            return { ok: false, provider: "instantly", status: "MISSING_CREDENTIALS", message: "INSTANTLY_API_KEY not set; live read test skipped." };
        }
        return await instantly.listCampaigns({ limit: 1 });
    }

    detectMismatches(registry, interfaceAdapters, capabilityBindings, liveReadTest) {
        const mismatches = [];
        for (const adapter of interfaceAdapters.adapters) {
            if (!adapter.compatible) {
                mismatches.push({ severity: "ERROR", provider: adapter.provider, message: `Provider adapter missing required methods: ${adapter.missingMethods.join(", ")}` });
            }
        }
        const inst = registry.providers.find(p => p.key === "instantly");
        if (process.env.INSTANTLY_API_KEY && inst && !inst.executable) {
            mismatches.push({ severity: "ERROR", provider: "instantly", message: "INSTANTLY_API_KEY is present but authority registry does not mark Instantly executable." });
        }
        if (process.env.INSTANTLY_API_KEY && !liveReadTest.ok) {
            mismatches.push({ severity: "WARNING", provider: "instantly", message: "Instantly key is present but live read test did not pass.", detail: liveReadTest.message || liveReadTest.status });
        }
        const bind = capabilityBindings.bindings.instantly;
        if (inst && bind && inst.executable !== bind.executable) {
            mismatches.push({ severity: "ERROR", provider: "instantly", message: "Authority registry and capability binding disagree on Instantly executable state." });
        }
        return mismatches;
    }

    renderReport(result) {
        const mismatches = result.mismatches.length
            ? result.mismatches.map(m => `- ${m.severity} / ${m.provider}: ${m.message}`).join("\n")
            : "- None";
        return `# EXEC_006 Provider Synchronization Report\n\nGenerated: ${result.generatedAt}\n\n## Summary\n\nProviders: ${result.summary.providers}\nReady: ${result.summary.ready}\nRead Ready: ${result.summary.readReady}\nWrite Ready: ${result.summary.writeReady}\nCompatible Adapters: ${result.summary.compatibleAdapters}\nInstantly Read Ready: ${result.summary.instantlyReadReady ? "Yes" : "No"}\nErrors: ${result.summary.errors}\n\n## Mismatches\n\n${mismatches}\n`;
    }
}

module.exports = new ProviderSynchronizationService();
