"use strict";

require("dotenv").config();

process.env.MILES_ROOT =
    process.env.MILES_ROOT || process.cwd();

const fs = require("fs");
const path = require("path");

const InstantlyLiveIntegrationService =
    require("./InstantlyLiveIntegrationService");

const ROOT = process.env.MILES_ROOT;
const OUT_DIR = path.join(ROOT, "DATA", "instantly");
const OUT_FILE = path.join(OUT_DIR, "campaign_inventory.json");

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function statusLabel(status) {
    const map = {
        0: "DRAFT_OR_PAUSED",
        1: "ACTIVE",
        2: "COMPLETED",
        3: "STOPPED"
    };

    return map[status] || `UNKNOWN_${status}`;
}

function countSequenceSteps(campaign) {
    if (!Array.isArray(campaign.sequences)) return 0;

    return campaign.sequences.reduce((total, sequence) => {
        return total + (Array.isArray(sequence.steps) ? sequence.steps.length : 0);
    }, 0);
}

function countSubjectVariants(campaign) {
    if (!Array.isArray(campaign.sequences)) return 0;

    let count = 0;

    for (const sequence of campaign.sequences) {
        for (const step of sequence.steps || []) {
            count += Array.isArray(step.variants) ? step.variants.length : 0;
        }
    }

    return count;
}

function assessHealth(campaign) {
    const issues = [];

    const sendingAccounts =
        Array.isArray(campaign.email_list)
            ? campaign.email_list.length
            : 0;

    const steps = countSequenceSteps(campaign);

    if (steps === 0) {
        issues.push("NO_SEQUENCE_STEPS");
    }

    if (sendingAccounts === 0) {
        issues.push("NO_SENDING_ACCOUNTS");
    }

    if (campaign.open_tracking === true) {
        issues.push("OPEN_TRACKING_ENABLED");
    }

    if (campaign.link_tracking === true) {
        issues.push("LINK_TRACKING_ENABLED");
    }

    if (campaign.daily_limit !== undefined && Number(campaign.daily_limit) <= 0) {
        issues.push("DAILY_LIMIT_ZERO");
    }

    return {
        health: issues.length === 0 ? "GOOD" : "REVIEW",
        issues
    };
}

class InstantlyCampaignInventoryService {
    async buildInventory() {
        const listResult =
            await InstantlyLiveIntegrationService.run({
                operation: "LIST_CAMPAIGNS"
            });

        const campaigns =
            listResult?.result?.result?.data?.items || [];

        const inventory = [];

        for (const campaign of campaigns) {
            const detailResult =
                await InstantlyLiveIntegrationService.run({
                    operation: "GET_CAMPAIGN",
                    payload: {
                        campaignId: campaign.id
                    }
                });

            const detail =
                detailResult?.result?.result?.data || campaign;

            const sendingAccounts =
                Array.isArray(detail.email_list)
                    ? detail.email_list.length
                    : 0;

            const health =
                assessHealth(detail);

            inventory.push({
                campaignId: detail.id,
                name: detail.name,
                statusCode: detail.status,
                status: statusLabel(detail.status),
                dailyLimit: detail.daily_limit || null,
                sendingAccounts,
                sequenceSteps: countSequenceSteps(detail),
                subjectVariants: countSubjectVariants(detail),
                openTracking: !!detail.open_tracking,
                linkTracking: !!detail.link_tracking,
                stopOnReply: !!detail.stop_on_reply,
                stopOnAutoReply: !!detail.stop_on_auto_reply,
                prioritizeNewLeads: !!detail.prioritize_new_leads,
                timestampCreated: detail.timestamp_created || null,
                timestampUpdated: detail.timestamp_updated || null,
                health: health.health,
                issues: health.issues,
                recommendedAction:
                    health.issues.length === 0
                        ? "NO_ACTION"
                        : "REVIEW_CAMPAIGN_CONFIGURATION"
            });
        }

        const output = {
            ok: true,
            generatedAt: new Date().toISOString(),
            campaignCount: inventory.length,
            inventory
        };

        ensureDir(OUT_DIR);

        fs.writeFileSync(
            OUT_FILE,
            JSON.stringify(output, null, 2),
            "utf8"
        );

        return output;
    }
}

module.exports = new InstantlyCampaignInventoryService();