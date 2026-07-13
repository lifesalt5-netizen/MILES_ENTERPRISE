"use strict";
const BaseProviderController = require("./BaseProviderController");

class InstantlyProviderController extends BaseProviderController {
    constructor() {
        super({
            key: "instantly",
            name: "Instantly",
            executable: false,
            envKeys: ["INSTANTLY_API_KEY"],
            supportedOperations: [
                "HEALTH_CHECK",
                "LIST_CAMPAIGNS",
                "CREATE_CAMPAIGN",
                "PAUSE_CAMPAIGN",
                "RESUME_CAMPAIGN",
                "UPLOAD_LEADS",
                "ASSIGN_SENDING_ACCOUNTS",
                "GENERATE_CAMPAIGN_REPORT"
            ]
        });
    }
}
module.exports = new InstantlyProviderController();
