"use strict";

/*
==========================================================
 MILES OS
 CodeRepairService
 Autonomous Engineering Layer
==========================================================
*/

const fs = require("fs");
const path = require("path");

class CodeRepairService {

    constructor() {

        this.version = "1.0.0";

        this.allowedRepairTypes = [

            "missing_require",
            "invalid_import",
            "missing_provider_registration",
            "missing_connector_registration",
            "json_repair",
            "path_repair",
            "config_repair",
            "logging_repair",
            "folder_creation",
            "provider_defect"

        ];

    }

    repair(plan = {}) {

        const result = {

            ok: true,
            repairId: `REPAIR-${Date.now()}`,
            timestamp: new Date().toISOString(),

            plan,

            actions: [],

            verification: [],

            errors: [],

            requiresKevinApproval: false

        };

        try {

            if (!plan.type) {

                throw new Error("Repair type not supplied.");

            }

            if (!this.allowedRepairTypes.includes(plan.type)) {

                result.ok = false;

                result.requiresKevinApproval = true;

                result.errors.push(
                    `Repair type '${plan.type}' requires approval.`
                );

                return result;

            }

            switch (plan.type) {

                case "missing_require":
                    this.repairMissingRequire(plan, result);
                    break;

                case "invalid_import":
                    this.repairInvalidImport(plan, result);
                    break;

                case "missing_provider_registration":
                    this.registerProvider(plan, result);
                    break;

                case "missing_connector_registration":
                    this.registerConnector(plan, result);
                    break;

                case "json_repair":
                    this.repairJson(plan, result);
                    break;

                case "path_repair":
                    this.repairPath(plan, result);
                    break;

                case "config_repair":
                    this.repairConfig(plan, result);
                    break;

                case "logging_repair":
                    this.repairLogging(plan, result);
                    break;

                case "folder_creation":
                    this.createFolder(plan, result);
                    break;

                case "provider_defect":
                    this.repairProvider(plan, result);
                    break;

                default:

                    result.ok = false;

                    result.errors.push("Unknown repair.");

            }

        }

        catch (err) {

            result.ok = false;

            result.errors.push(err.message);

        }

        return result;

    }

    repairMissingRequire(plan, result) {

        result.actions.push({

            action: "missing_require",

            file: plan.file,

            status: "READY"

        });

    }

    repairInvalidImport(plan, result) {

        result.actions.push({

            action: "invalid_import",

            file: plan.file,

            status: "READY"

        });

    }

    registerProvider(plan, result) {

        result.actions.push({

            action: "register_provider",

            provider: plan.provider,

            status: "READY"

        });

    }

    registerConnector(plan, result) {

        result.actions.push({

            action: "register_connector",

            connector: plan.connector,

            status: "READY"

        });

    }

    repairJson(plan, result) {

        if (!plan.file)
            return;

        const file = path.resolve(plan.file);

        const raw = fs.readFileSync(file, "utf8");

        JSON.parse(raw);

        result.actions.push({

            action: "json_validation",

            file,

            status: "VALID"

        });

    }

    repairPath(plan, result) {

        result.actions.push({

            action: "path_validation",

            target: plan.path,

            exists: fs.existsSync(plan.path)

        });

    }

    repairConfig(plan, result) {

        result.actions.push({

            action: "config_validation",

            config: plan.config,

            status: "READY"

        });

    }

    repairLogging(plan, result) {

        result.actions.push({

            action: "logging_validation",

            file: plan.file,

            status: "READY"

        });

    }

    createFolder(plan, result) {

        if (!plan.folder)
            return;

        if (!fs.existsSync(plan.folder)) {

            fs.mkdirSync(plan.folder, {

                recursive: true

            });

        }

        result.actions.push({

            action: "folder_created",

            folder: plan.folder

        });

    }

    repairProvider(plan, result) {

        result.actions.push({

            action: "provider_repair",

            provider: plan.provider,

            status: "READY"

        });

    }

}

module.exports = new CodeRepairService();