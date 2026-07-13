"use strict";

/**
 * MILES Builder Service
 * EXEC_002 Provider Controllers replacement dispatcher.
 * Preserves prior actions and adds provider controller actions.
 */

class BuilderService {
    async execute(task = {}) {
        const action = (task.action || task.type || "PROVIDER_CONTROLLERS").toUpperCase();
        const commands = {
            PROVIDER_CONTROLLERS: () => require("../SERVICES/ProviderControllerRegistryService").run(task),
            PROVIDER_CONTROLLER_HEALTH: () => require("../SERVICES/ProviderControllerHealthService").run(task),
            PROVIDER_CONTROLLER_EXECUTE: () => require("../SERVICES/ProviderControllerExecutionService").run(task),
            EXEC_002_VERIFY: async () => {
                const registry = require("../SERVICES/ProviderControllerRegistryService").run(task);
                const health = await require("../SERVICES/ProviderControllerHealthService").run(task);
                const test = await require("../SERVICES/ProviderControllerExecutionService").run({ provider:"filesystem", operation:"ENSURE_DIRECTORY", payload:{ path:"DATA\\provider_controllers\\verify" }});
                return { ok: true, action:"EXEC_002_VERIFY", registry, health, test };
            }
        };
        if (!commands[action]) {
            try {
                const previous = require("./BuilderService.previous");
                if (previous && previous.execute) return previous.execute(task);
            } catch {}
            return { ok:false, action, error:`Unsupported builder action: ${action}`, supportedActions:Object.keys(commands) };
        }
        return await commands[action]();
    }
}
module.exports = new BuilderService();
