"use strict";

/*
===============================================================================
MILES Enterprise
RepositorySearchService

Purpose
-------
Repository-wide engineering search, capability inspection,
and evidence reporting.

Execution Contract
------------------
All MILES capability services expose:

    execute(task)

ExecutionService
        ↓
Connector
        ↓
RepositorySearchService.execute(task)
        ↓
run(task)
===============================================================================
*/

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();

function now() {
    return new Date().toISOString();
}

function safeRead(file) {
    try {
        return fs.readFileSync(file, "utf8");
    } catch {
        return "";
    }
}

function walk(dir, results = []) {

    if (!fs.existsSync(dir)) return results;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {

        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {

            if (
                entry.name === "node_modules" ||
                entry.name === ".git" ||
                entry.name === "BACKUPS"
            ) {
                continue;
            }

            walk(full, results);

        } else {

            if (
                full.endsWith(".js") ||
                full.endsWith(".json") ||
                full.endsWith(".ps1") ||
                full.endsWith(".md") ||
                full.endsWith(".txt")
            ) {
                results.push(full);
            }

        }

    }

    return results;

}

class RepositorySearchService {

    constructor(options = {}) {

        this.rootDir = options.rootDir || ROOT;
        this.outDir = path.join(this.rootDir, "DATA", "repository_search");

    }

    relative(file) {
        return path.relative(this.rootDir, file).replace(/\\/g, "/");
    }

    searchPatterns(patterns = []) {

        const files = walk(this.rootDir);
        const matches = [];

        for (const file of files) {

            const text = safeRead(file);
            const lines = text.split(/\r?\n/);

            for (let i = 0; i < lines.length; i++) {

                const line = lines[i];

                for (const pattern of patterns) {

                    const regex =
                        pattern instanceof RegExp
                            ? pattern
                            : new RegExp(
                                String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                                "i"
                            );

                    if (regex.test(line)) {

                        matches.push({
                            file: this.relative(file),
                            line: i + 1,
                            pattern: String(pattern),
                            text: line.trim()
                        });

                    }

                }

            }

        }

        return matches;

    }

    findWriteCapabilities() {

        return this.searchPatterns([
            "writeFile",
            "writeFileSync",
            "fs.writeFile",
            "fs.writeFileSync",
            "createWriteStream",
            "CodeWriter",
            "ReplacementWriter",
            "ReplacementGenerator",
            "PatchEngine",
            "PatchGenerator",
            "CodeGenerator",
            "EngineeringWriter",
            "RuntimeWriter",
            "TemplateEngine",
            "replacement source",
            "generate replacement",
            "proposedChangeType",
            "PROPOSAL_CREATED",
            "productionModified",
            "approvalRequired",
            "safeMode"
        ]);

    }

    inspectEngineeringService() {

        const file = path.join(
            this.rootDir,
            "SERVICES",
            "EngineeringImprovementService.js"
        );

        const text = safeRead(file);
        const lines = text.split(/\r?\n/);

        const methods = [];

        for (let i = 0; i < lines.length; i++) {

            const match = lines[i].match(/^\s*(\w+)\s*\([^)]*\)\s*\{/);

            if (match) {

                methods.push({
                    method: match[1],
                    line: i + 1,
                    text: lines[i].trim()
                });

            }

        }

        return {

            file: "SERVICES/EngineeringImprovementService.js",
            exists: fs.existsSync(file),
            methods,
            containsWriteFile: /writeFile|writeFileSync|createWriteStream/.test(text),
            containsProposalCreated: /PROPOSAL_CREATED/.test(text),
            containsProductionModifiedFalse: /productionModified:\s*false/.test(text),
            containsApprovalRequiredTrue: /approvalRequired:\s*true/.test(text),
            containsSafeModeTrue: /safeMode:\s*true/.test(text)

        };

    }

    auditCodeWriterCapability() {

        const matches = this.findWriteCapabilities();
        const engineering = this.inspectEngineeringService();

        const codeWriterNamedMatches = matches.filter(m =>
            /CodeWriter|ReplacementWriter|ReplacementGenerator|PatchEngine|PatchGenerator|CodeGenerator|EngineeringWriter|RuntimeWriter|TemplateEngine/i.test(m.text)
        );

        const writeMatches = matches.filter(m =>
            /writeFile|writeFileSync|createWriteStream/i.test(m.text)
        );

        const engineeringProposalEvidence = matches.filter(m =>
            m.file === "SERVICES/EngineeringImprovementService.js" &&
            /PROPOSAL_CREATED|productionModified|approvalRequired|safeMode|proposedChangeType/i.test(m.text)
        );

        const productionCodeGenerationEngineExists =
            codeWriterNamedMatches.length > 0;

        return {

            ok: true,
            service: "RepositorySearchService",
            action: "CODE_WRITER_CAPABILITY_AUDIT",
            rootDir: this.rootDir,
            generatedAt: now(),

            conclusion:
                productionCodeGenerationEngineExists
                    ? "Potential code-generation components located."
                    : "No dedicated production code-generation engine found.",

            productionCodeGenerationEngineExists,

            engineeringService: engineering,

            counts: {
                totalMatches: matches.length,
                writeMatches: writeMatches.length,
                codeWriterNamedMatches: codeWriterNamedMatches.length,
                engineeringProposalEvidence: engineeringProposalEvidence.length
            },

            writeMatches,
            codeWriterNamedMatches,
            engineeringProposalEvidence,
            allMatches: matches

        };

    }

    search(task = {}) {

        const query =
            task.query ||
            task.pattern ||
            task.payload?.query ||
            task.payload?.pattern ||
            task.payload?.objective ||
            "";

        const patterns = Array.isArray(query)
            ? query
            : [query];

        const matches = this.searchPatterns(patterns);

        return {

            ok: true,
            service: "RepositorySearchService",
            action: "REPOSITORY_SEARCH",
            query,
            count: matches.length,
            matches,
            searchedAt: now()

        };

    }

    report(task = {}) {

        const action = String(
            task.action ||
            task.type ||
            task.payload?.action ||
            "CODE_WRITER_CAPABILITY_AUDIT"
        ).toUpperCase();

        const result =
            action === "REPOSITORY_SEARCH"
                ? this.search(task)
                : this.auditCodeWriterCapability(task);

        fs.mkdirSync(this.outDir, { recursive: true });

        const outFile = path.join(
            this.outDir,
            `${action.toLowerCase()}_${Date.now()}.json`
        );

        fs.writeFileSync(
            outFile,
            JSON.stringify(result, null, 2),
            "utf8"
        );

        return {
            ...result,
            outFile
        };

    }

    run(task = {}) {

        const action = String(
            task.action ||
            task.type ||
            task.payload?.action ||
            "CODE_WRITER_CAPABILITY_AUDIT"
        ).toUpperCase();

        if (
            action === "REPOSITORY_SEARCH" ||
            action === "CODE_WRITER_CAPABILITY_AUDIT" ||
            action === "REPOSITORY_EVIDENCE_REPORT"
        ) {
            return this.report(task);
        }

        return {

            ok: false,
            service: "RepositorySearchService",
            action,

            error:
                `Unsupported repository search action: ${action}`,

            supportedActions: [
                "REPOSITORY_SEARCH",
                "CODE_WRITER_CAPABILITY_AUDIT",
                "REPOSITORY_EVIDENCE_REPORT"
            ]

        };

    }

}

/*
===============================================================================
Standard Execution Contract

Every MILES capability should expose execute(task)

This keeps all internal capability services consistent.
===============================================================================
*/

const service = new RepositorySearchService();

service.execute = async function (task = {}) {

    return this.run(task);

};

module.exports = service;