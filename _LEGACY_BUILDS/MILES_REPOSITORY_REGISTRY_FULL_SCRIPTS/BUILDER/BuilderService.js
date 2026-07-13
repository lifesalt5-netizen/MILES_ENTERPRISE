/**
 * MILES Builder Service
 * Version: 1.1.0
 *
 * Complete replacement file.
 *
 * Adds:
 * - REPOSITORY_REGISTRY
 *
 * Preserves:
 * - SCAN_PROJECT
 * - STATUS
 * - SMOKE_TEST
 * - ANALYZE_PROJECT
 * - BUILD_PLAN
 * - TEST_RUNTIME
 * - BUILD_CONNECTOR
 */

"use strict";

const scanner = require("./ProjectScanner");
const git = require("./GitManager");
const runtime = require("./RuntimeController");

class BuilderService {

    scanProject() {
        return scanner.writeReport();
    }

    status() {
        return {
            generatedAt: new Date().toISOString(),
            branch: git.currentBranch(),
            gitStatus: git.status()
        };
    }

    smokeTest() {
        return runtime.smokeTest();
    }

    async execute(task = {}) {
        const action = (task.action || task.type || "SCAN_PROJECT").toUpperCase();

        const commands = {

            SCAN_PROJECT: () => {
                const { outFile, report } = this.scanProject();

                return {
                    ok: true,
                    action,
                    outFile,
                    totalFiles: report.totalFiles,
                    summary: report.summary
                };
            },

            STATUS: () => ({
                ok: true,
                action,
                status: this.status()
            }),

            SMOKE_TEST: () => ({
                ok: true,
                action,
                result: this.smokeTest()
            }),

            ANALYZE_PROJECT: () => {
                const { outFile, result } =
                    require("./ProjectAnalyzer").writeReport();

                return {
                    ok: true,
                    action: "ANALYZE_PROJECT",
                    outFile,
                    analysis: result
                };
            },

            BUILD_PLAN: () =>
                require("./BuildPlanner").run(),

            TEST_RUNTIME: () =>
                require("./RuntimeController").fullTest(),

            BUILD_CONNECTOR: () =>
                require("./ConnectorBuilder").run(task),

            REPOSITORY_REGISTRY: () =>
                require("../SERVICES/RepositoryRegistryService").run(task)

        };

        if (!commands[action]) {
            return {
                ok: false,
                action,
                error: `Unsupported builder action: ${action}`,
                supportedActions: Object.keys(commands)
            };
        }

        return await commands[action]();
    }
}

module.exports = new BuilderService();
