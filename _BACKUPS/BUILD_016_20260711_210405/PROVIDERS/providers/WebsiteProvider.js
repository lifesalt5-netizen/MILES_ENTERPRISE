const IDataProvider = require("../contracts/IDataProvider");
const website = require("../../CONNECTORS/WEBSITE/website");

class WebsiteProvider extends IDataProvider {

    constructor() {
        super("Website");

        this.dependencies = ["Website"];

        this.sourceSystems = [
            "CONNECTORS/WEBSITE"
        ];
    }

    async initialize() {
        await this.refresh();
        return true;
    }

    async refresh() {

        this.lastRefresh = new Date().toISOString();

        try {

            const result =
                await website.auditWebsite();

            this.status =
                result.ok ? "Healthy" : "Critical";

            this.metrics =
                result.metrics || {};

            this.exceptions =
                result.ok
                    ? []
                    : [{
                        type: "WebsiteUnavailable",
                        severity: "Critical",
                        message: result.error || "Website audit failed."
                    }];

            this.recommendations =
                result.ok
                    ? []
                    : [
                        "Verify B12 website availability.",
                        "Verify DNS.",
                        "Verify SSL."
                    ];

        } catch (err) {

            this.status = "Critical";

            this.metrics = {};

            this.exceptions = [{
                type: "WebsiteAudit",
                severity: "Critical",
                message: err.message
            }];

            this.recommendations = [
                "Verify Website connector."
            ];
        }
    }

    async shutdown() {
        return true;
    }
}

module.exports = WebsiteProvider;