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
        const workforceRoute = {
            provider: "MarketingProvider",
            connector: "WORKFORCE",
            system: "MarketingProvider",
            department: "Revenue Operations",
            assignedTo: "InstantlyExecutiveAdvisor",
            requiresKevin: false
        };

        //
        // Always refresh business state first
        //

        workPackages.push({
            ...workforceRoute,
            priority: 1,
            taskType: "REFRESH_CAMPAIGN_INVENTORY",
            capability: "marketing.campaign.audit",
            action: "campaign_audit",
            governanceIntent: "AUDIT",
            description: "Refresh live campaign inventory."
        });

        workPackages.push({
            ...workforceRoute,
            priority: 2,
            taskType: "REFRESH_SENDING_ACCOUNT_INVENTORY",
            capability: "revenue.outbound.capacity.audit",
            action: "capacity_audit",
            governanceIntent: "AUDIT",
            description: "Refresh mailbox inventory."
        });

        workPackages.push({
            ...workforceRoute,
            priority: 3,
            taskType: "REFRESH_SEGMENT_INVENTORY",
            capability: "revenue.outbound.segment.audit",
            action: "segment_audit",
            governanceIntent: "AUDIT",
            description: "Load lead segment inventory."
        });

        //
        // Compare current state
        //

        workPackages.push({
            ...workforceRoute,
            priority: 4,
            taskType: "COMPARE_SEGMENTS_TO_CAMPAIGNS",
            capability: "revenue.outbound.plan",
            action: "plan_marketing_actions",
            governanceIntent: "PLAN",
            description: "Determine campaign coverage."
        });

        workPackages.push({
            ...workforceRoute,
            priority: 5,
            taskType: "IDENTIFY_MISSING_CAMPAIGNS",
            capability: "revenue.outbound.plan",
            action: "plan_marketing_actions",
            governanceIntent: "PLAN",
            description: "Identify segments needing campaigns."
        });

        workPackages.push({
            ...workforceRoute,
            priority: 6,
            taskType: "IDENTIFY_CAMPAIGNS_WITHOUT_INBOXES",
            capability: "revenue.outbound.capacity.audit",
            action: "capacity_audit",
            governanceIntent: "AUDIT",
            description: "Locate campaigns without sending accounts."
        });

        workPackages.push({
            ...workforceRoute,
            priority: 7,
            taskType: "IDENTIFY_CAMPAIGNS_WITHOUT_LEADS",
            capability: "revenue.outbound.segment.audit",
            action: "segment_audit",
            governanceIntent: "AUDIT",
            description: "Locate campaigns with no leads."
        });

        //
        // Build execution queue
        //

        workPackages.push({
            ...workforceRoute,
            priority: 8,
            taskType: "BUILD_EXECUTION_QUEUE",
            capability: "revenue.outbound.plan",
            action: "plan_marketing_actions",
            governanceIntent: "PLAN",
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
