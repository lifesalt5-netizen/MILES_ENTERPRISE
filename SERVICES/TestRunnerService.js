"use strict";

/*
==========================================================
 MILES OS
 TestRunnerService
 Autonomous Verification Engine
 Version: 1.0.0
==========================================================
*/

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

class TestRunnerService {

    constructor() {

        this.version = "1.0.0";

        this.root = process.env.MILES_ROOT || process.cwd();

        this.testTimeout = 30000;

    }

    async run(testPlan = {}) {

        const result = {

            ok: true,

            timestamp: new Date().toISOString(),

            runner: "MILES Test Runner",

            version: this.version,

            tests: [],

            summary: {

                total: 0,

                passed: 0,

                failed: 0,

                warnings: 0

            },

            errors: []

        };

        try {

            const tests = testPlan.tests || [];

            for (const test of tests) {

                const output = this.executeTest(test);

                result.tests.push(output);

                result.summary.total++;

                if (output.status === "PASS")
                    result.summary.passed++;

                else if (output.status === "FAIL") {

                    result.summary.failed++;

                    result.ok = false;

                }

                else {

                    result.summary.warnings++;

                }

            }

        }

        catch (err) {

            result.ok = false;

            result.errors.push(err.message);

        }

        return result;

    }

    executeTest(test) {

        try {

            switch (test.type) {

                case "file_exists":
                    return this.fileExists(test);

                case "module_load":
                    return this.moduleLoad(test);

                case "json":
                    return this.jsonTest(test);

                case "folder_exists":
                    return this.folderExists(test);

                case "command":
                    return this.commandTest(test);

                default:

                    return {

                        name: test.name,

                        status: "WARN",

                        message: "Unknown test type."

                    };

            }

        }

        catch (err) {

            return {

                name: test.name,

                status: "FAIL",

                message: err.message

            };

        }

    }

    fileExists(test) {

        const exists = fs.existsSync(test.path);

        return {

            name: test.name,

            status: exists ? "PASS" : "FAIL",

            file: test.path

        };

    }

    folderExists(test) {

        const exists =

            fs.existsSync(test.path) &&

            fs.lstatSync(test.path).isDirectory();

        return {

            name: test.name,

            status: exists ? "PASS" : "FAIL",

            folder: test.path

        };

    }

    moduleLoad(test) {

        delete require.cache[require.resolve(test.module)];

        require(test.module);

        return {

            name: test.name,

            status: "PASS",

            module: test.module

        };

    }

    jsonTest(test) {

        const raw = fs.readFileSync(test.file, "utf8");

        JSON.parse(raw);

        return {

            name: test.name,

            status: "PASS",

            file: test.file

        };

    }

    commandTest(test) {

        const parts = test.command.split(" ");

        const exe = parts.shift();

        const proc = spawnSync(

            exe,

            parts,

            {

                cwd: this.root,

                timeout: this.testTimeout,

                encoding: "utf8"

            }

        );

        if (proc.status === 0) {

            return {

                name: test.name,

                status: "PASS",

                output: proc.stdout.trim()

            };

        }

        return {

            name: test.name,

            status: "FAIL",

            output: proc.stderr.trim()

        };

    }

}

module.exports = new TestRunnerService();