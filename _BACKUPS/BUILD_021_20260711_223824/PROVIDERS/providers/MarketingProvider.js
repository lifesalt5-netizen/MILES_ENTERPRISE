const IDataProvider = require("../contracts/IDataProvider");
const instantly = require("../../CONNECTORS/INSTANTLY/instantly");

class MarketingProvider extends IDataProvider {

    constructor() {

        super("Marketing");

        this.dependencies = [
            "Instantly",
            "Website",
            "LinkedIn",
            "MillionVerifier"
        ];

        this.sourceSystems = [
            "CONNECTORS/INSTANTLY",
            "CONNECTORS/WEBSITE_B12"
        ];

    }

    async initialize() {

        this.status = "Initializing";

        await this.refresh();

        return true;

    }

    async refresh() {

        this.lastRefresh = new Date().toISOString();
        this.dataFreshness = "Live";

        try {

            const response = await instantly.listCampaigns();

            const campaigns = response.items || [];

            const activeCampaigns = campaigns.filter(c => c.status === 1);

            const pausedCampaigns = campaigns.filter(c => c.status !== 1);

            this.status = "Healthy";

            this.metrics = {

                totalCampaigns: campaigns.length,

                activeCampaigns: activeCampaigns.length,

                pausedCampaigns: pausedCampaigns.length,

                campaignNames: campaigns.map(c => c.name),

                campaigns: campaigns.map(c => ({

                    id: c.id,

                    name: c.name,

                    status: c.status,

                    dailyLimit: c.daily_limit || 0,

                    organization: c.organization,

                    owner: c.owned_by,

                    created: c.timestamp_created,

                    updated: c.timestamp_updated

                }))

            };

            this.exceptions = [];

            if (campaigns.length === 0) {

                this.exceptions.push({

                    type: "NoCampaigns",

                    severity: "Warning",

                    message: "No Instantly campaigns were found."

                });

            }

            if (activeCampaigns.length === 0) {

                this.exceptions.push({

                    type: "NoActiveCampaigns",

                    severity: "Warning",

                    message: "All campaigns are currently paused."

                });

            }

            this.recommendations = [];

            if (activeCampaigns.length < 2) {

                this.recommendations.push(
                    "Review campaign schedule and activate additional outreach campaigns."
                );

            }

        }

        catch (err) {

            this.status = "Critical";

            this.metrics = {};

            this.exceptions = [

                {

                    type: "InstantlyAPI",

                    severity: "Critical",

                    message: err.message

                }

            ];

            this.recommendations = [

                "Verify Instantly API connectivity.",
                "Verify INSTANTLY_API_KEY.",
                "Verify internet connectivity."

            ];

        }

    }

    getCampaignByName(name) {

        if (!this.metrics.campaigns) {

            return null;

        }

        return this.metrics.campaigns.find(c => c.name === name);

    }

    getActiveCampaigns() {

        if (!this.metrics.campaigns) {

            return [];

        }

        return this.metrics.campaigns.filter(c => c.status === 1);

    }

    async shutdown() {

        return true;

    }

}

module.exports = MarketingProvider;