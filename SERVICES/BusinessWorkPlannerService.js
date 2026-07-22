"use strict";

/*
    BUILD E004
    Business Work Planner Service

    Purpose:
    Convert CEO objectives into executable business work packages.

    This service DOES NOT execute work.
    It only determines what work should exist.
*/

class BusinessWorkPlannerService {

    async plan(task = {}) {

        const objective =
            task.objective ||
            task.payload?.objective ||
            task.command ||
            "";

        const workPackages = [];

        //
        // Always refresh business state first
        //

        workPackages.push({
            priority: 1,
            taskType: "REFRESH_CAMPAIGN_INVENTORY",
            provider: "Instantly",
            action: "LIST_CAMPAIGNS",
            description: "Refresh live campaign inventory."
        });

        workPackages.push({
            priority: 2,
            taskType: "REFRESH_SENDING_ACCOUNT_INVENTORY",
            provider: "Instantly",
            action: "LIST_SENDING_ACCOUNTS",
            description: "Refresh mailbox inventory."
        });

        workPackages.push({
            priority: 3,
            taskType: "REFRESH_SEGMENT_INVENTORY",
            provider: "Revenue",
            action: "LOAD_SEGMENTS",
            description: "Load lead segment inventory."
        });

        //
        // Compare current state
        //

        workPackages.push({
            priority: 4,
            taskType: "COMPARE_SEGMENTS_TO_CAMPAIGNS",
            provider: "Revenue",
            action: "COMPARE",
            description: "Determine campaign coverage."
        });

        workPackages.push({
            priority: 5,
            taskType: "IDENTIFY_MISSING_CAMPAIGNS",
            provider: "Revenue",
            action: "DISCOVER_MISSING_CAMPAIGNS",
            description: "Identify segments needing campaigns."
        });

        workPackages.push({
            priority: 6,
            taskType: "IDENTIFY_CAMPAIGNS_WITHOUT_INBOXES",
            provider: "Instantly",
            action: "CHECK_CAMPAIGN_INBOXES",
            description: "Locate campaigns without sending accounts."
        });

        workPackages.push({
            priority: 7,
            taskType: "IDENTIFY_CAMPAIGNS_WITHOUT_LEADS",
            provider: "Instantly",
            action: "CHECK_CAMPAIGN_LEADS",
            description: "Locate campaigns with no leads."
        });

        //
        // Build execution queue
        //

        workPackages.push({
            priority: 8,
            taskType: "BUILD_EXECUTION_QUEUE",
            provider: "MILES",
            action: "QUEUE_WORK",
            description: "Create prioritized execution queue."
        });

        return {

            ok: true,

            service: "BusinessWorkPlannerService",

            objective,

            generatedAt: new Date().toISOString(),

            workPackageCount: workPackages.length,

            workPackages

        };

    }

}

module.exports = new BusinessWorkPlannerService();
module.exports.BusinessWorkPlannerService = BusinessWorkPlannerService;