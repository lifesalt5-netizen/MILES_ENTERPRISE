"use strict";

/*
==========================================================
 MILES OS
 RuntimeRecoveryService
 Autonomous Runtime Recovery Engine
 Version: 1.1.0
==========================================================
*/

const { spawn } = require("child_process");

class RuntimeRecoveryService {

    constructor() {

        this.version = "1.1.0";

        this.maxAttempts = 3;

    }

    async recover(recoveryPlan = {}) {

        const result = {

            ok: true,

            timestamp: new Date().toISOString(),

            runtimeId: recoveryPlan.runtimeId || null,

            service: recoveryPlan.service || "UNKNOWN",

            attempts: [],

            recovered: false,

            errors: []

        };

        try {

            for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {

                const response = await this.executeRecovery(
                    recoveryPlan,
                    attempt
                );

                result.attempts.push(response);

                if (response.success) {

                    result.recovered = true;

                    return result;

                }

            }

            result.ok = false;
            result.errors.push("Automatic recovery failed.");

        }
        catch (err) {

            result.ok = false;
            result.errors.push(err.message);

        }

        return result;

    }

    executeRecovery(plan, attempt) {

        return new Promise(resolve => {

            if (!plan.command) {

                return resolve({

                    attempt,

                    success: false,

                    message: "No recovery command supplied."

                });

            }

            let stdout = "";
            let stderr = "";

            const child = spawn(

                plan.command,

                plan.args || [],

                {

                    shell: true,

                    cwd: process.cwd(),

                    windowsHide: true,

                    stdio: ["ignore", "pipe", "pipe"]

                }

            );

            child.stdout.on("data", data => {

                stdout += data.toString();

            });

            child.stderr.on("data", data => {

                stderr += data.toString();

            });

            child.on("error", err => {

                resolve({

                    attempt,

                    success: false,

                    exitCode: -1,

                    stdout: stdout.trim(),

                    error: err.message

                });

            });

            child.on("close", code => {

                resolve({

                    attempt,

                    success: code === 0,

                    exitCode: code,

                    stdout: stdout.trim(),

                    error: stderr.trim()

                });

            });

        });

    }

}

module.exports = new RuntimeRecoveryService();