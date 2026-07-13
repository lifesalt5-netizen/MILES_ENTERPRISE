const fs = require("fs");
const path = require("path");
const { getConfigHealth } = require("../CONFIG/ConfigurationManager");

const STATE_PATH = path.join(
    process.cwd(),
    "DATA",
    "state",
    "executive_state.json"
);

function ensureDir() {
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function buildExecutiveState(input = {}) {
    ensureDir();

    const config = getConfigHealth();

    const connectors = input.connectors || {};
    const queue = input.queue || {};
    const workforce = input.workforce || {};
    const capabilities = input.capabilities || {};
    const workflow = input.workflow || {};
    const recovery = input.recovery || {};

    const warnings = [];
    const errors = [];

    for (const item of config.optional || []) {
        if (!item.present) {
            warnings.push("Missing optional config: " + item.key);
        }
    }

    for (const c of Object.values(connectors)) {
        if (c && c.healthy === false) {
            warnings.push("Connector unhealthy: " + (c.name || "UNKNOWN"));
        }
    }

    if (workforce.ok === false) {
        warnings.push("Workforce service unhealthy");
    }

    if (capabilities.ok === false) {
        warnings.push("Capability service unhealthy");
    }

    if (workflow.ok === false) {
        warnings.push("Workflow service unhealthy");
    }

    if ((queue.failed || 0) > 0) {
        warnings.push("Failed tasks present: " + queue.failed);
    }

    const state = {
        generatedAt: new Date().toISOString(),

        runtime: {
            mode: process.env.MILES_ENV || "local",
            node: process.version,
            cwd: process.cwd(),
            platform: process.platform
        },

        configuration: {
            healthy: config.required.every(x => x.ok),
            failSoft: config.failSoft,
            envExists: config.envExists,
            required: config.required,
            optional: config.optional
        },

        connectors,
        workforce,
        capabilities,
        workflow,
        queue,
        recovery,

        health: {
            overall: warnings.length === 0 && errors.length === 0 ? "HEALTHY" : "DEGRADED",
            warnings,
            errors
        }
    };

    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

    return state;
}

function readExecutiveState() {
    if (!fs.existsSync(STATE_PATH)) {
        return null;
    }

    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}

module.exports = {
    buildExecutiveState,
    readExecutiveState
};