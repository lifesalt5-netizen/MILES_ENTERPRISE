/**
 * MILES Capability Registry Service
 * Version: 1.0.0
 *
 * Purpose:
 * Converts repository components into operational capabilities.
 *
 * Depends on:
 * DATA/repository/repository_registry.json
 *
 * Builder Action:
 * CAPABILITY_REGISTRY
 *
 * Outputs:
 * DATA/capability/capability_registry.json
 * DATA/capability/capability_summary.json
 * DATA/capability/capability_owner_map.json
 * DATA/capability/capability_execution_map.json
 * DATA/capability/capability_report.md
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const REPOSITORY_REGISTRY = path.join(ROOT, "DATA", "repository", "repository_registry.json");
const OUT_DIR = path.join(ROOT, "DATA", "capability");

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
    if (!fs.existsSync(file)) {
        throw new Error(`Required file not found: ${file}`);
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(name, data) {
    ensureDir(OUT_DIR);
    fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2), "utf8");
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

class CapabilityRegistryService {

    run() {
        const startedAt = Date.now();

        console.log("");
        console.log("========================================");
        console.log(" MILES Capability Registry");
        console.log("========================================");

        const registry = this.buildRegistry();
        this.save(registry);

        const durationMs = Date.now() - startedAt;

        console.log("");
        console.log("Capability Registry Complete");
        console.log(`Capabilities: ${registry.statistics.totalCapabilities}`);
        console.log(`Executable Capabilities: ${registry.statistics.executableCapabilities}`);
        console.log(`Autonomy Score: ${registry.autonomy.score}`);
        console.log("");

        return {
            ok: true,
            action: "CAPABILITY_REGISTRY",
            generatedAt: registry.generatedAt,
            durationMs,
            outDir: OUT_DIR,
            statistics: registry.statistics,
            autonomy: registry.autonomy
        };
    }

    buildRegistry() {
        const repo = readJson(REPOSITORY_REGISTRY);
        const generatedAt = new Date().toISOString();

        const components = repo.components || [];

        const capabilities = this.extractCapabilities(components);
        const ownerMap = this.buildOwnerMap(capabilities);
        const executionMap = this.buildExecutionMap(capabilities);
        const gaps = this.findCapabilityGaps(capabilities);
        const autonomy = this.scoreAutonomy(capabilities, gaps);

        return {
            generatedAt,
            sourceRepositoryRegistryGeneratedAt: repo.generatedAt,
            mission: "MILES becomes the autonomous Digital COO for P2GC.",
            capabilities,
            ownerMap,
            executionMap,
            gaps,
            statistics: this.statistics(capabilities, gaps),
            autonomy
        };
    }

    extractCapabilities(components) {
        const capabilityMap = new Map();

        for (const component of components) {
            const detected = component.capabilities || [];
            const inferred = this.inferCapabilities(component);
            const all = unique([...detected, ...inferred]);

            for (const cap of all) {
                if (!capabilityMap.has(cap)) {
                    capabilityMap.set(cap, {
                        id: cap,
                        name: this.humanize(cap),
                        category: this.category(cap),
                        description: this.describe(cap),
                        owners: [],
                        components: [],
                        executable: false,
                        governance: this.governance(cap),
                        autonomyImpact: this.autonomyImpact(cap),
                        reducesKevinWorkload: true,
                        status: "DISCOVERED"
                    });
                }

                const record = capabilityMap.get(cap);

                record.owners.push(component.owner || "Unknown");

                record.components.push({
                    componentId: component.id,
                    path: component.path,
                    name: component.name,
                    componentTypes: component.componentTypes,
                    owner: component.owner,
                    dependencies: component.dependencies || [],
                    events: component.events || {},
                    status: component.status
                });

                if (this.isExecutable(component)) {
                    record.executable = true;
                }
            }
        }

        const capabilities = Array.from(capabilityMap.values());

        for (const cap of capabilities) {
            cap.owners = unique(cap.owners);
            cap.componentCount = cap.components.length;
            cap.primaryOwner = cap.owners[0] || "Unknown";
            cap.status = cap.executable ? "EXECUTABLE_CANDIDATE" : "DISCOVERED_ONLY";
        }

        return capabilities.sort((a, b) => a.id.localeCompare(b.id));
    }

    inferCapabilities(component) {
        const p = (component.path || "").toLowerCase();
        const n = (component.name || "").toLowerCase();
        const types = component.componentTypes || [];
        const caps = [];

        if (p.includes("instantly") || p.includes("campaign") || p.includes("outbound")) {
            caps.push("outbound_campaign_operations");
        }

        if (p.includes("website") || p.includes("b12") || p.includes("seo")) {
            caps.push("website_operations");
        }

        if (p.includes("orion") || p.includes("contractor") || p.includes("recompete")) {
            caps.push("orion_intelligence_operations");
        }

        if (p.includes("crm") || p.includes("pipeline") || p.includes("proposal") || p.includes("revenue")) {
            caps.push("revenue_operations");
        }

        if (p.includes("executive") || p.includes("brief") || p.includes("dashboard")) {
            caps.push("executive_intelligence");
        }

        if (p.includes("coo") || p.includes("orchestrator") || p.includes("decision") || p.includes("planner")) {
            caps.push("coo_orchestration");
        }

        if (p.includes("runtime") || p.includes("kernel") || p.includes("pm2")) {
            caps.push("runtime_operations");
        }

        if (p.includes("learning") || p.includes("confidence") || p.includes("history")) {
            caps.push("self_learning_operations");
        }

        if (p.includes("builder") || p.includes("registry") || p.includes("scanner") || p.includes("analyzer")) {
            caps.push("self_engineering_operations");
        }

        if (types.includes("connector")) caps.push("connector_operations");
        if (types.includes("provider")) caps.push("provider_operations");
        if (types.includes("worker")) caps.push("worker_execution");
        if (types.includes("service")) caps.push("service_execution");
        if (types.includes("api")) caps.push("api_surface");

        return caps;
    }

    isExecutable(component) {
        const types = component.componentTypes || [];

        return (
            types.includes("service") ||
            types.includes("worker") ||
            types.includes("connector") ||
            types.includes("provider") ||
            types.includes("runtime") ||
            types.includes("automation")
        );
    }

    buildOwnerMap(capabilities) {
        const ownerMap = {};

        for (const cap of capabilities) {
            for (const owner of cap.owners) {
                if (!ownerMap[owner]) ownerMap[owner] = [];
                ownerMap[owner].push({
                    capabilityId: cap.id,
                    name: cap.name,
                    executable: cap.executable,
                    componentCount: cap.componentCount
                });
            }
        }

        return ownerMap;
    }

    buildExecutionMap(capabilities) {
        const executionMap = {};

        for (const cap of capabilities) {
            executionMap[cap.id] = {
                capability: cap.name,
                executable: cap.executable,
                primaryOwner: cap.primaryOwner,
                governance: cap.governance,
                autonomyImpact: cap.autonomyImpact,
                candidateExecutors: cap.components
                    .filter(c => {
                        const types = c.componentTypes || [];
                        return (
                            types.includes("service") ||
                            types.includes("worker") ||
                            types.includes("connector") ||
                            types.includes("provider") ||
                            types.includes("runtime")
                        );
                    })
                    .map(c => ({
                        path: c.path,
                        name: c.name,
                        componentTypes: c.componentTypes,
                        owner: c.owner
                    }))
            };
        }

        return executionMap;
    }

    findCapabilityGaps(capabilities) {
        const byId = new Set(capabilities.map(c => c.id));

        const requiredForCOO = [
            "repository_awareness",
            "self_engineering_operations",
            "runtime_operations",
            "coo_orchestration",
            "executive_intelligence",
            "revenue_operations",
            "outbound_campaign_operations",
            "website_operations",
            "orion_intelligence_operations",
            "connector_operations",
            "provider_operations",
            "worker_execution",
            "self_learning_operations"
        ];

        return requiredForCOO
            .filter(id => !byId.has(id))
            .map(id => ({
                capabilityId: id,
                name: this.humanize(id),
                severity: "HIGH",
                reason: "Required for autonomous Digital COO operation but not detected in repository registry."
            }));
    }

    scoreAutonomy(capabilities, gaps) {
        let score = 100;

        score -= Math.min(35, gaps.length * 5);

        const executableCount = capabilities.filter(c => c.executable).length;
        const total = capabilities.length || 1;
        const executableRatio = executableCount / total;

        if (executableRatio < 0.5) score -= 20;
        else if (executableRatio < 0.75) score -= 10;

        const hasCOO = capabilities.some(c => c.id === "coo_orchestration");
        const hasRevenue = capabilities.some(c => c.id === "revenue_operations");
        const hasLearning = capabilities.some(c => c.id === "self_learning_operations");

        if (!hasCOO) score -= 15;
        if (!hasRevenue) score -= 10;
        if (!hasLearning) score -= 10;

        score = Math.max(0, score);

        return {
            score,
            status:
                score >= 90 ? "AUTONOMY_READY" :
                score >= 75 ? "STRONG" :
                score >= 60 ? "PARTIAL" :
                "NEEDS_BUILD",
            executableRatio,
            totalCapabilities: capabilities.length,
            executableCapabilities: executableCount,
            gaps: gaps.length
        };
    }

    statistics(capabilities, gaps) {
        return {
            totalCapabilities: capabilities.length,
            executableCapabilities: capabilities.filter(c => c.executable).length,
            discoveredOnlyCapabilities: capabilities.filter(c => !c.executable).length,
            highAutonomyImpact: capabilities.filter(c => c.autonomyImpact === "HIGH" || c.autonomyImpact === "CRITICAL").length,
            governanceApprovalRequired: capabilities.filter(c => c.governance.requiresApproval).length,
            gaps: gaps.length
        };
    }

    category(capabilityId) {
        if (capabilityId.includes("revenue") || capabilityId.includes("campaign")) return "Revenue";
        if (capabilityId.includes("website") || capabilityId.includes("marketing")) return "Marketing";
        if (capabilityId.includes("orion") || capabilityId.includes("government")) return "ORION";
        if (capabilityId.includes("runtime") || capabilityId.includes("kernel")) return "Runtime";
        if (capabilityId.includes("engineering") || capabilityId.includes("repository")) return "Engineering";
        if (capabilityId.includes("learning")) return "Learning";
        if (capabilityId.includes("executive") || capabilityId.includes("coo")) return "Executive";
        if (capabilityId.includes("connector") || capabilityId.includes("provider") || capabilityId.includes("worker")) return "Infrastructure";
        return "General";
    }

    governance(capabilityId) {
        const approvalRequired = [
            "pricing_changes",
            "client_proposal_send",
            "contract_signing",
            "data_deletion"
        ];

        return {
            requiresApproval: approvalRequired.includes(capabilityId),
            approvalLevel: approvalRequired.includes(capabilityId) ? "KEVIN" : "AUTONOMOUS_ALLOWED"
        };
    }

    autonomyImpact(capabilityId) {
        if (["coo_orchestration", "runtime_operations", "self_learning_operations", "self_engineering_operations"].includes(capabilityId)) return "CRITICAL";
        if (["revenue_operations", "outbound_campaign_operations", "orion_intelligence_operations", "executive_intelligence"].includes(capabilityId)) return "HIGH";
        if (["website_operations", "connector_operations", "provider_operations", "worker_execution"].includes(capabilityId)) return "MEDIUM";
        return "LOW";
    }

    describe(capabilityId) {
        const descriptions = {
            repository_awareness: "Understands the MILES codebase and component inventory.",
            self_engineering_operations: "Can inspect, maintain, and improve MILES engineering assets.",
            runtime_operations: "Can monitor and manage runtime systems.",
            coo_orchestration: "Can coordinate business operations across P2GC.",
            executive_intelligence: "Can produce executive summaries, KPIs, priorities, and business briefings.",
            revenue_operations: "Can monitor and act on revenue, pipeline, CRM, and proposals.",
            outbound_campaign_operations: "Can operate Instantly and outbound email campaigns.",
            website_operations: "Can operate website improvements, forms, pages, and conversion systems.",
            orion_intelligence_operations: "Can operate ORION contractor, buyer, opportunity, and recommendation intelligence.",
            connector_operations: "Can integrate external systems.",
            provider_operations: "Can retrieve operational data from system providers.",
            worker_execution: "Can execute assigned work items.",
            self_learning_operations: "Can learn from outcomes and improve future behavior."
        };

        return descriptions[capabilityId] || `Detected capability: ${this.humanize(capabilityId)}.`;
    }

    humanize(value) {
        return String(value)
            .replace(/_/g, " ")
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    save(registry) {
        ensureDir(OUT_DIR);

        writeJson("capability_registry.json", registry);
        writeJson("capability_summary.json", {
            generatedAt: registry.generatedAt,
            statistics: registry.statistics,
            autonomy: registry.autonomy,
            gaps: registry.gaps
        });
        writeJson("capability_owner_map.json", {
            generatedAt: registry.generatedAt,
            ownerMap: registry.ownerMap
        });
        writeJson("capability_execution_map.json", {
            generatedAt: registry.generatedAt,
            executionMap: registry.executionMap
        });

        fs.writeFileSync(
            path.join(OUT_DIR, "capability_report.md"),
            this.renderReport(registry),
            "utf8"
        );
    }

    renderReport(registry) {
        const caps = registry.capabilities
            .map(c => `| ${c.name} | ${c.category} | ${c.executable ? "Yes" : "No"} | ${c.primaryOwner} | ${c.autonomyImpact} |`)
            .join("\n");

        const gaps = registry.gaps.length
            ? registry.gaps.map(g => `- ${g.name}: ${g.reason}`).join("\n")
            : "No critical COO capability gaps detected.";

        return `# MILES Capability Registry Report

Generated: ${registry.generatedAt}

## Mission

MILES becomes the autonomous Digital COO for P2GC.

## Autonomy Status

Status: ${registry.autonomy.status}  
Score: ${registry.autonomy.score}

## Summary

| Metric | Count |
|---|---:|
| Total Capabilities | ${registry.statistics.totalCapabilities} |
| Executable Capabilities | ${registry.statistics.executableCapabilities} |
| Discovered Only | ${registry.statistics.discoveredOnlyCapabilities} |
| High/Critical Autonomy Impact | ${registry.statistics.highAutonomyImpact} |
| Governance Approval Required | ${registry.statistics.governanceApprovalRequired} |
| Gaps | ${registry.statistics.gaps} |

## Capabilities

| Capability | Category | Executable | Primary Owner | Autonomy Impact |
|---|---|---:|---|---|
${caps}

## Gaps

${gaps}

## Next Step

Use this Capability Registry as input for the Executive Brain.

The Executive Brain will decide what work should happen using:
- company state,
- capability availability,
- governance rules,
- task priority,
- execution readiness.
`;
    }
}

module.exports = new CapabilityRegistryService();
