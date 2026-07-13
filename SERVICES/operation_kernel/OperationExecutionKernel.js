"use strict";

/*
==========================================================
 MILES OS
 BUILD_044
 Operation Execution Kernel
 Version: 1.0.0
==========================================================
*/

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();

function now() {
    return new Date().toISOString();
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback = {}) {
    try {
        if (!fs.existsSync(file)) return fallback;

        const raw = fs.readFileSync(file, "utf8").trim();

        if (!raw) return fallback;

        return JSON.parse(raw);

    } catch {

        return fallback;

    }
}

function writeJson(file, data) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function appendJsonl(file, data) {
    ensureDir(path.dirname(file));
    fs.appendFileSync(file, JSON.stringify(data) + "\n");
}

class OperationExecutionKernel {

    constructor() {

        this.name = "OPERATION_EXECUTION_KERNEL";
        this.version = "1.0.0";

        this.outputDir = path.join(
            ROOT,
            "DATA",
            "operation_kernel"
        );

    }

    run() {

        ensureDir(this.outputDir);

        const inputs = this.loadInputs();

        const decisions = this.buildDecisionQueue(inputs);

        const executionPlan = this.buildExecutionPlan(decisions);

        const report = {

            ok: true,

            service: this.name,

            version: this.version,

            generatedAt: now(),

            status: "OPERATION_KERNEL_ACTIVE",

            decisions,

            executionPlan

        };

        writeJson(

            path.join(
                this.outputDir,
                "latest_execution_report.json"
            ),

            report

        );

        appendJsonl(

            path.join(
                this.outputDir,
                "execution_history.jsonl"
            ),

            {

                timestamp: now(),

                status: "COMPLETE",

                decisions: decisions.length,

                executionItems: executionPlan.length

            }

        );

        return {

            ok: true,

            service: this.name,

            version: this.version,

            generatedAt: now(),

            decisions: decisions.length,

            executionItems: executionPlan.length,

            status: "READY_FOR_WORKERS"

        };

    }

    loadInputs() {

        return {

            capabilityBacklog: readJson(

                path.join(

                    ROOT,

                    "DATA",

                    "capability_backlog",

                    "latest_capability_backlog.json"

                )

            ),

            repairPlan: readJson(

                path.join(

                    ROOT,

                    "DATA",

                    "autonomous_repair",

                    "latest_repair_plan.json"

                )

            ),

            missionPlan: readJson(

                path.join(

                    ROOT,

                    "DATA",

                    "executive",

                    "latest_mission_plan.json"

                )

            ),

            universalHealth: readJson(

                path.join(

                    ROOT,

                    "DATA",

                    "executive",

                    "latest_universal_health.json"

                )

            ),

            cooCycle: readJson(

                path.join(

                    ROOT,

                    "DATA",

                    "runtime",

                    "latest_coo_cycle.json"

                )

            )

        };

    }

    buildDecisionQueue(inputs) {

        const queue = [];

        queue.push({

            id: "SALES_COO",

            priority: 1,

            worker: "SalesCOOWorker",

            action: "Prepare autonomous sales execution",

            approvalRequired: false

        });

        queue.push({

            id: "INSTANTLY_COO",

            priority: 2,

            worker: "InstantlyCOOWorker",

            action: "Prepare outbound execution",

            approvalRequired: false

        });

        queue.push({

            id: "WEBSITE_COO",

            priority: 3,

            worker: "WebsiteCOOWorker",

            action: "Prepare website execution",

            approvalRequired: true

        });

        queue.push({

            id: "ORION_COO",

            priority: 4,

            worker: "OrionCOOWorker",

            action: "Prepare intelligence execution",

            approvalRequired: false

        });

        return queue;

    }

    buildExecutionPlan(queue) {

        return queue.map(item => ({

            workId:

                "WORK_" +

                Date.now() +

                "_" +

                item.id,

            worker:

                item.worker,

            priority:

                item.priority,

            action:

                item.action,

            approvalRequired:

                item.approvalRequired,

            status:

                item.approvalRequired

                    ? "WAITING_FOR_APPROVAL"

                    : "READY"

        }));

    }

}

module.exports = new OperationExecutionKernel();