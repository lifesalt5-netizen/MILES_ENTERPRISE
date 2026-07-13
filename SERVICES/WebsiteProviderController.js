"use strict";
const BaseProviderController = require("./BaseProviderController");
class WebsiteProviderController extends BaseProviderController {
    constructor() {
        super({
            key: "website",
            name: "Website",
            executable: false,
            envKeys: [],
            supportedOperations: ["HEALTH_CHECK", "BACKUP_SITE", "UPDATE_PAGE", "PUBLISH_PAGE", "VERIFY_PAGE", "GENERATE_WEBSITE_REPORT"]
        });
    }
}
module.exports = new WebsiteProviderController();
