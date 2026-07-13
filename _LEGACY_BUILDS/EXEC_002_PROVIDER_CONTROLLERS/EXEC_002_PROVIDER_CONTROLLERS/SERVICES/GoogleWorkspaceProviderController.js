"use strict";
const BaseProviderController = require("./BaseProviderController");
class GoogleWorkspaceProviderController extends BaseProviderController {
    constructor() {
        super({
            key: "google_workspace",
            name: "Google Workspace",
            executable: false,
            envKeys: ["GOOGLE_APPLICATION_CREDENTIALS"],
            supportedOperations: ["HEALTH_CHECK", "CREATE_USER", "CREATE_ALIAS", "SUSPEND_USER", "LIST_USERS", "VERIFY_MAILBOX"]
        });
    }
}
module.exports = new GoogleWorkspaceProviderController();
