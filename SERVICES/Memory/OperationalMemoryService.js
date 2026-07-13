"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const MEMORY_DIR = path.join(ROOT, "DATA", "memory");
const MEMORY_FILE = path.join(MEMORY_DIR, "operational_memory.json");

class OperationalMemoryService {

    constructor() {
        fs.mkdirSync(MEMORY_DIR, { recursive: true });

        if (!fs.existsSync(MEMORY_FILE)) {
            fs.writeFileSync(
                MEMORY_FILE,
                JSON.stringify({
                    executions: [],
                    created: new Date().toISOString()
                }, null, 2)
            );
        }
    }

    load() {
        return JSON.parse(fs.readFileSync(MEMORY_FILE));
    }

    save(memory) {
        fs.writeFileSync(
            MEMORY_FILE,
            JSON.stringify(memory, null, 2)
        );
    }

    record(execution) {

        const memory = this.load();

        memory.executions.push({
            id: execution.taskId,
            workPackage: execution.workPackageId,
            objective: execution.objective,
            provider: execution.provider,
            capability: execution.capability,
            action: execution.action,
            executionMode: execution.executionMode,
            status: execution.status,
            timestamp: execution.createdAt,
            decision: execution.output?.decision?.decision,
            confidence: execution.output?.decision?.confidence?.confidenceScore,
            recommendation: execution.output?.recommendation
        });

        if (memory.executions.length > 10000) {
            memory.executions.shift();
        }

        this.save(memory);

        return {
            ok: true,
            totalExecutions: memory.executions.length
        };
    }

    recent(limit = 20) {

        const memory = this.load();

        return memory.executions.slice(-limit);
    }

    statistics() {

        const memory = this.load();

        const completed =
            memory.executions.filter(x => x.status === "COMPLETED").length;

        const failed =
            memory.executions.filter(x => x.status !== "COMPLETED").length;

        return {
            totalExecutions: memory.executions.length,
            completed,
            failed
        };
    }

}

module.exports = new OperationalMemoryService();