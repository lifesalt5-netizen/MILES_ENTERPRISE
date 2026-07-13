"use strict";
const BaseProviderController = require("./BaseProviderController");
class OrionProviderController extends BaseProviderController {
    constructor() {
        super({
            key: "orion",
            name: "ORION",
            executable: true,
            envKeys: [],
            supportedOperations: ["HEALTH_CHECK", "REFRESH_DATASETS", "RUN_INTELLIGENCE_JOB", "GENERATE_ORION_REPORT", "VERIFY_DATABASE"]
        });
    }
}
module.exports = new OrionProviderController();
