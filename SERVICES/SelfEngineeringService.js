"use strict";

/*
==========================================================
 MILES OS
 SelfEngineeringService
 Autonomous Self Engineering Orchestrator
 Version: 1.0.0
==========================================================
*/

const EngineeringPlanner = require("./EngineeringPlannerService");
const CodeRepair = require("./CodeRepairService");
const TestRunner = require("./TestRunnerService");
const RuntimeRecovery = require("./RuntimeRecoveryService");

class SelfEngineeringService {

    constructor() {

        this.version = "1.0.0";

    }

    async execute(finding = {}) {

        const result = {

            ok: true,

            timestamp: new Date().toISOString(),

            finding,

            plan: null,

            repair: null,

            tests: null,

            recovery: null,

            stage: "START",

            errors: []

        };

        try {

            result.stage = "PLAN";

            result.plan =
                EngineeringPlanner.planRepair(finding);

            result.stage = "REPAIR";

            result.repair =
                CodeRepair.repair(result.plan);

            result.stage = "VERIFY";

            result.tests =
                await TestRunner.run({

                    tests:
                        result.plan.testCommands || []

                });

            if (!result.tests.ok) {

                result.stage = "RECOVERY";

                result.recovery =
                    await RuntimeRecovery.recover({

                        runtimeId:
                            finding.runtimeId,

                        service:
                            finding.service,

                        command:
                            finding.restartCommand,

                        args:
                            finding.restartArgs || []

                    });

            }

            result.ok =
                result.tests.ok ||
                (result.recovery &&
                 result.recovery.recovered);

            result.stage = "COMPLETE";

        }

        catch (err) {

            result.ok = false;

            result.stage = "FAILED";

            result.errors.push(err.message);

        }

        return result;

    }

}

module.exports = new SelfEngineeringService();