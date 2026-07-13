class ExecutiveBriefService {
    constructor(executiveState) {
        if (!executiveState) {
            throw new Error("ExecutiveBriefService requires executiveState.");
        }

        this.state = executiveState;
    }

    generate() {
        return {
            generatedAt: new Date().toISOString(),
            title: "MILES Executive Brief",
            businessHealth: this.state.businessHealth || "Unknown",
            executiveSummary: this.buildExecutiveSummary(),
            todayPriorities: this.buildTodayPriorities(),
            revenueAndMarketing: this.buildMarketingSummary(),
            orion: this.buildOrionSummary(),
            exceptions: this.buildExceptions(),
            recommendations: this.buildRecommendations(),
            executiveDecisionsNeeded: this.buildExecutiveDecisions()
        };
    }

    buildExecutiveSummary() {
        const summary = this.state.executiveSummary || {};

        return {
            overallStatus: this.state.businessHealth || "Unknown",
            providerCoverage: `${summary.healthyProviders || 0}/${summary.totalProviders || 0} providers healthy`,
            criticalProviders: summary.criticalProviders || 0,
            summary: this.getNarrativeSummary()
        };
    }

    getNarrativeSummary() {
        const marketing = this.state.marketing || {};
        const orion = this.state.orion || {};

        return [
            `Marketing has ${marketing.totalCampaigns || 0} campaigns with ${marketing.activeCampaigns || 0} active and ${marketing.pausedCampaigns || 0} paused.`,
            `ORION contains ${orion.contractors || 0} contractors, ${orion.buyers || 0} buyers, and ${orion.opportunities || 0} opportunities.`,
            `Business health is currently ${this.state.businessHealth || "Unknown"}.`
        ];
    }

    buildTodayPriorities() {
        const priorities = [];
        const marketing = this.state.marketing || {};

        if ((marketing.activeCampaigns || 0) < 2 && (marketing.totalCampaigns || 0) > 1) {
            priorities.push({
                priority: 1,
                area: "Marketing",
                action: "Review paused Instantly campaigns and determine which should be resumed.",
                impact: "Improves outbound coverage and revenue generation.",
                owner: "Miles",
                requiresKevin: false
            });
        }

        if (this.state.businessHealth !== "Healthy") {
            priorities.push({
                priority: 1,
                area: "Executive",
                action: "Investigate provider health issues.",
                impact: "Protects business continuity and executive visibility.",
                owner: "Miles",
                requiresKevin: false
            });
        }

        if (priorities.length === 0) {
            priorities.push({
                priority: 2,
                area: "Operations",
                action: "Continue monitoring providers and operational systems.",
                impact: "Maintains business visibility.",
                owner: "Miles",
                requiresKevin: false
            });
        }

        return priorities;
    }

    buildMarketingSummary() {
        const marketing = this.state.marketing || {};

        return {
            totalCampaigns: marketing.totalCampaigns || 0,
            activeCampaigns: marketing.activeCampaigns || 0,
            pausedCampaigns: marketing.pausedCampaigns || 0,
            campaignNames: marketing.campaignNames || [],
            status:
                (marketing.activeCampaigns || 0) > 0
                    ? "Active outreach running"
                    : "No active outreach campaigns detected"
        };
    }

    buildOrionSummary() {
        const orion = this.state.orion || {};

        return {
            database: orion.database || null,
            tableCount: orion.tableCount || 0,
            contractors: orion.contractors || 0,
            buyers: orion.buyers || 0,
            opportunities: orion.opportunities || 0,
            recompetes: orion.recompetes || 0,
            recommendations: orion.recommendations || 0,
            personas: orion.personas || 0,
            status:
                (orion.contractors || 0) > 0 && (orion.opportunities || 0) > 0
                    ? "ORION operational"
                    : "ORION data incomplete"
        };
    }

    buildExceptions() {
        const exceptions = this.state.exceptions || [];

        if (exceptions.length === 0) {
            return [
                {
                    severity: "Info",
                    message: "No executive exceptions detected."
                }
            ];
        }

        return exceptions;
    }

    buildRecommendations() {
        const recommendations = this.state.recommendations || [];

        if (recommendations.length === 0) {
            return [
                "No immediate executive recommendations."
            ];
        }

        return recommendations;
    }

    buildExecutiveDecisions() {
        const decisions = [];

        const criticalExceptions = (this.state.exceptions || []).filter(
            e => e.severity === "Critical"
        );

        for (const exception of criticalExceptions) {
            decisions.push({
                decision: `Resolve ${exception.type}`,
                reason: exception.message,
                recommendedOption: "Authorize Miles to investigate and resolve operational issue.",
                deadline: "Immediate",
                businessImpact: "Prevents interruption to operations."
            });
        }

        return decisions;
    }

    toMarkdown() {
        const brief = this.generate();

        const lines = [];

        lines.push(`# ${brief.title}`);
        lines.push("");
        lines.push(`Generated: ${brief.generatedAt}`);
        lines.push("");
        lines.push(`## Business Health`);
        lines.push("");
        lines.push(`**${brief.businessHealth}**`);
        lines.push("");
        lines.push(`## Executive Summary`);
        lines.push("");

        for (const item of brief.executiveSummary.summary) {
            lines.push(`- ${item}`);
        }

        lines.push("");
        lines.push(`## Today's Priorities`);
        lines.push("");

        for (const item of brief.todayPriorities) {
            lines.push(`- P${item.priority} — ${item.area}: ${item.action}`);
        }

        lines.push("");
        lines.push(`## Marketing`);
        lines.push("");
        lines.push(`- Total Campaigns: ${brief.revenueAndMarketing.totalCampaigns}`);
        lines.push(`- Active Campaigns: ${brief.revenueAndMarketing.activeCampaigns}`);
        lines.push(`- Paused Campaigns: ${brief.revenueAndMarketing.pausedCampaigns}`);

        lines.push("");
        lines.push(`## ORION`);
        lines.push("");
        lines.push(`- Contractors: ${brief.orion.contractors}`);
        lines.push(`- Buyers: ${brief.orion.buyers}`);
        lines.push(`- Opportunities: ${brief.orion.opportunities}`);
        lines.push(`- Recompetes: ${brief.orion.recompetes}`);
        lines.push(`- Recommendations: ${brief.orion.recommendations}`);

        lines.push("");
        lines.push(`## Exceptions`);
        lines.push("");

        for (const exception of brief.exceptions) {
            lines.push(`- ${exception.severity}: ${exception.message}`);
        }

        lines.push("");
        lines.push(`## Recommendations`);
        lines.push("");

        for (const recommendation of brief.recommendations) {
            lines.push(`- ${recommendation}`);
        }

        lines.push("");
        lines.push(`## Executive Decisions Needed`);
        lines.push("");

        if (brief.executiveDecisionsNeeded.length === 0) {
            lines.push("- No Kevin-level decisions required.");
        } else {
            for (const decision of brief.executiveDecisionsNeeded) {
                lines.push(`- ${decision.decision}: ${decision.recommendedOption}`);
            }
        }

        return lines.join("\n");
    }
}

module.exports = ExecutiveBriefService;