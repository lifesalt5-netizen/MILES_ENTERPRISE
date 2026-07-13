"use strict";

/*
  MILES ENTERPRISE
  File: SERVICES/CommandIntentPlannerService.js
  Purpose:
    Translate CEO-level natural-language commands into supported,
    governed MILES operations.

  Routing rules:
    1. Explicit supported actions are honored only when they are the whole
       instruction, such as "Miles, run STATUS."
    2. Executive revenue missions take precedence over operational reviews.
    3. Instantly reviews route to INSTANTLY_LIVE.
    4. Broad revenue objectives route to BUSINESS_EXECUTION.
    5. The unsupported MILES_EXECUTE action is never emitted.
    6. Connector selection happens after intent, workflow, capability,
       provider, and action selection.
*/

const SUPPORTED_MILES_ACTIONS = new Set([
  "SCAN_PROJECT",
  "STATUS",
  "SMOKE_TEST",
  "ANALYZE_PROJECT",
  "BUILD_PLAN",
  "TEST_RUNTIME",
  "BUILD_CONNECTOR",
  "REPOSITORY_REGISTRY",
  "CAPABILITY_REGISTRY",
  "EXECUTIVE_BRAIN",
  "COMPANY_STATE",
  "TASK_ROUTER",
  "COO_LOOP",
  "EXECUTIVE_DASHBOARD",
  "SELF_LEARNING",
  "ACTION_ENGINE",
  "PROVIDER_CONTROLLERS",
  "PROVIDER_CONTROLLER_HEALTH",
  "PROVIDER_CONTROLLER_EXECUTE",
  "INSTANTLY_LIVE",
  "CONTROLLED_WRITE",
  "BUSINESS_EXECUTION",
  "PROVIDER_AUTHORITY",
  "PROVIDER_INTERFACE_ADAPTERS",
  "PROVIDER_CAPABILITY_BINDINGS",
  "PROVIDER_SYNC",
  "ENGINEERING_IMPROVEMENT",
  "ENGINEERING_ANALYZE",
  "ENGINEERING_PLAN",
  "ENGINEERING_IMPLEMENT",
  "ENGINEERING_VALIDATE",
  "ENGINEERING_REPORT",
  "SELF_MAINTENANCE",
  "SELF_MAINTENANCE_DIAGNOSE",
  "SELF_MAINTENANCE_PLAN",
  "SELF_MAINTENANCE_VALIDATE",
  "SELF_MAINTENANCE_REPORT",
  "WEBSITE_REVIEW"
]);

class CommandIntentPlannerService {
  plan(operation = {}) {
    const raw = String(
      operation.command ||
      operation.action ||
      operation.title ||
      ""
    ).trim();

    const text = raw.toLowerCase();

    const directAction =
      this.resolveExplicitMilesAction(raw);

    if (directAction) {
      return this.buildPlan({
        raw,
        intent: this.intentForAction(directAction),
        workflow: directAction,
        capability: directAction,
        provider: "MILES",
        connector: "MILES",
        action: directAction,
        steps: [
          {
            step: 1,
            provider: "MILES",
            connector: "MILES",
            capability: directAction,
            action: directAction,
            objective: raw
          }
        ]
      });
    }

    const intent =
      this.resolveIntent(text, operation);

    const workflow =
      this.resolveWorkflow(
        text,
        intent,
        operation
      );

    const capability =
      this.resolveCapability(
        text,
        intent,
        workflow,
        operation
      );

    const provider =
      this.resolveProvider(
        text,
        intent,
        workflow,
        capability,
        operation
      );

    const action =
      this.resolveAction(
        text,
        intent,
        workflow,
        capability,
        provider,
        operation
      );

    const connector =
      this.resolveConnector(
        provider,
        action,
        capability,
        operation
      );

    const steps =
      this.resolveSteps(
        text,
        intent,
        workflow,
        capability,
        provider,
        connector,
        action
      );

    return this.buildPlan({
      raw,
      intent,
      workflow,
      capability,
      provider,
      connector,
      action,
      steps
    });
  }

  buildPlan({
    raw,
    intent,
    workflow,
    capability,
    provider,
    connector,
    action,
    steps
  }) {
    return {
      ok: true,
      intent,
      workflow,
      capability,
      provider,
      system: provider,
      connector,
      department:
        this.resolveDepartment(
          intent,
          provider
        ),
      action,
      objective: raw,
      originalCommand: raw,
      steps,
      plannedAt:
        new Date().toISOString()
    };
  }

  resolveExplicitMilesAction(raw) {
    const normalized =
      String(raw || "")
        .trim()
        .toUpperCase()
        .replace(/[.!?]+$/g, "")
        .trim();

    /*
      Only treat a capability as explicit when the complete command reduces
      to that capability name after removing harmless command prefixes.

      Valid:
        STATUS
        Run STATUS
        Miles, run STATUS
        Miles: PROVIDER_AUTHORITY

      Not explicit:
        Review campaign status and execute the work.
        Identify every campaign and its status.
    */

    const explicit =
      normalized
        .replace(/^MILES[\s,:-]*/i, "")
        .replace(/^PLEASE[\s,:-]*/i, "")
        .replace(/^RUN[\s,:-]*/i, "")
        .trim();

    if (
      SUPPORTED_MILES_ACTIONS.has(
        explicit
      )
    ) {
      return explicit;
    }

    return null;
  }

  intentForAction(action) {
    if (
      action.startsWith("ENGINEERING_") ||
      action.startsWith(
        "SELF_MAINTENANCE"
      )
    ) {
      return "ENGINEERING";
    }

    if (
      [
        "INSTANTLY_LIVE",
        "BUSINESS_EXECUTION",
        "CONTROLLED_WRITE"
      ].includes(action)
    ) {
      return "REVENUE_OPERATIONS";
    }

    return "EXECUTIVE_COMMAND";
  }

  resolveIntent(
    text,
    operation = {}
  ) {
    if (operation.intent) {
      return String(
        operation.intent
      );
    }

    /*
      Mission classification must happen before operational review
      classification. A command such as "own Instantly end to end" may also
      mention replies, warmup, deliverability, and campaign status.
    */

    if (
      this.isRevenueOperationsMission(
        text
      )
    ) {
      return "REVENUE_OPERATIONS";
    }

    if (
      this.isInstantlyOperationalReview(
        text
      )
    ) {
      return "BUSINESS_OPERATION";
    }

    if (
      /^miles executive directive/i
        .test(text) ||
      /^miles engineering directive/i
        .test(text) ||
      /build\s+\d+/i.test(text) ||
      /current planner|command intent planner|replace keyword routing|hierarchical intent/
        .test(text) ||
      /execution layer|execution service|dispatch|dispatcher/
        .test(text) ||
      /repository search|code writer|runtime diagnostic|runtime trace|diagnostic harness/
        .test(text) ||
      /improve miles|fix miles|repair miles|maintain miles|upgrade miles/
        .test(text) ||
      /self improve|self maintenance|autonomous improvement|engineering improvement/
        .test(text)
    ) {
      return "ENGINEERING";
    }

    if (
      /executive integration audit|integration audit|audit.*pipeline|verify.*pipeline/
        .test(text) ||
      /full ceo command pipeline|wire existing services/
        .test(text)
    ) {
      return "EXECUTIVE_AUDIT";
    }

    if (
      /check orion|orion health|orion system health|check.*orion.*health/
        .test(text)
    ) {
      return "CONNECTOR_OPERATION";
    }

    if (
      /review website|website review|check website|website health/
        .test(text)
    ) {
      return "BUSINESS_OPERATION";
    }

    if (
      /google workspace|gmail|calendar|google drive/
        .test(text)
    ) {
      return "BUSINESS_OPERATION";
    }

    if (
      /linkedin|company page|engagement/
        .test(text)
    ) {
      return "BUSINESS_OPERATION";
    }

    if (
      /what can you do|supported action/
        .test(text)
    ) {
      return "EXECUTIVE_STATUS";
    }

    /*
      A generic use of the word "status" is not enough to force STATUS.
      Explicit STATUS commands are already handled by
      resolveExplicitMilesAction().
    */

    return "GENERAL_EXECUTIVE_COMMAND";
  }

  isRevenueOperationsMission(text) {
    return (
      /own.*(outbound|revenue|instantly|campaign)/
        .test(text) ||
      /(take over|manage|operate).*(instantly|outbound|campaign|revenue)/
        .test(text) ||
      /expand outbound/
        .test(text) ||
      /increase booked meetings/
        .test(text) ||
      /increase.*outbound capacity/
        .test(text) ||
      /create.*mailbox/
        .test(text) ||
      /create.*email.*domain/
        .test(text) ||
      /provision.*mailbox/
        .test(text) ||
      /assign.*campaign/
        .test(text) ||
      /upload.*lead/
        .test(text) ||
      /match.*lead.*segment/
        .test(text) ||
      /track.*response/
        .test(text) ||
      /run.*campaign/
        .test(text) ||
      /launch.*campaign/
        .test(text)
    );
  }

  isInstantlyOperationalReview(text) {
    const hasReviewVerb =
      /review|assess|audit|inspect|check|analyze|report/
        .test(text);

    const hasInstantlyTopic =
      /instantly|campaign health|deliverability|bounce|warmup|reply|replies/
        .test(text);

    return (
      /review instantly/
        .test(text) ||
      /instantly health/
        .test(text) ||
      (
        hasReviewVerb &&
        hasInstantlyTopic
      )
    );
  }

  resolveWorkflow(
    text,
    intent,
    operation = {}
  ) {
    if (operation.workflow) {
      return String(
        operation.workflow
      );
    }

    if (
      intent ===
      "REVENUE_OPERATIONS"
    ) {
      return "REVENUE_OPERATIONS_MISSION";
    }

    if (
      intent ===
      "EXECUTIVE_STATUS"
    ) {
      return "EXECUTIVE_STATUS";
    }

    if (
      intent === "ENGINEERING"
    ) {
      if (
        /repository|search repository|repo search|code search/
          .test(text)
      ) {
        return "ENGINEERING_REPOSITORY_SEARCH";
      }

      if (
        /code writer|writer capability|replacement source|replacement script|patch generator|code generation/
          .test(text)
      ) {
        return "ENGINEERING_CODE_WRITER_AUDIT";
      }

      if (
        /runtime dispatch|dispatch diagnostic|dispatch trace|dispatcher|diagnostic harness|execution path|execution trace/
          .test(text)
      ) {
        return "ENGINEERING_RUNTIME_DISPATCH_DIAGNOSTIC";
      }

      if (
        /self maintenance|self-maintenance|maintenance|health|degraded|repair myself|diagnose miles/
          .test(text)
      ) {
        return "ENGINEERING_SELF_MAINTENANCE";
      }

      return "ENGINEERING_IMPROVEMENT";
    }

    if (
      intent ===
      "EXECUTIVE_AUDIT"
    ) {
      return "EXECUTIVE_INTEGRATION_AUDIT";
    }

    if (
      intent ===
        "CONNECTOR_OPERATION" &&
      /orion/.test(text)
    ) {
      return "ORION_HEALTH_CHECK";
    }

    if (
      intent ===
      "BUSINESS_OPERATION"
    ) {
      if (
        /website/
          .test(text)
      ) {
        return "WEBSITE_REVIEW";
      }

      if (
        /instantly|campaign|deliverability|bounce|warmup|reply|replies/
          .test(text)
      ) {
        return "INSTANTLY_LIVE_REVIEW";
      }

      if (
        /linkedin/
          .test(text)
      ) {
        return "LINKEDIN_REVIEW";
      }

      if (
        /google|gmail|workspace|calendar|drive/
          .test(text)
      ) {
        return "GOOGLE_WORKSPACE_REVIEW";
      }

      return "BUSINESS_REVIEW";
    }

    return "GENERAL_EXECUTIVE_WORKFLOW";
  }

  resolveCapability(
    text,
    intent,
    workflow,
    operation = {}
  ) {
    if (operation.capability) {
      return String(
        operation.capability
      );
    }

    if (
      intent ===
      "REVENUE_OPERATIONS"
    ) {
      return "BUSINESS_EXECUTION";
    }

    if (
      intent ===
      "EXECUTIVE_STATUS"
    ) {
      return "STATUS";
    }

    if (
      intent === "ENGINEERING"
    ) {
      if (
        workflow ===
        "ENGINEERING_REPOSITORY_SEARCH"
      ) {
        return "REPOSITORY_REGISTRY";
      }

      if (
        workflow ===
        "ENGINEERING_CODE_WRITER_AUDIT"
      ) {
        return "ENGINEERING_ANALYZE";
      }

      if (
        workflow ===
        "ENGINEERING_RUNTIME_DISPATCH_DIAGNOSTIC"
      ) {
        return "TEST_RUNTIME";
      }

      if (
        workflow ===
        "ENGINEERING_SELF_MAINTENANCE"
      ) {
        return "SELF_MAINTENANCE";
      }

      return "ENGINEERING_IMPROVEMENT";
    }

    if (
      intent ===
      "EXECUTIVE_AUDIT"
    ) {
      return "ENGINEERING_REPORT";
    }

    if (
      workflow ===
      "ORION_HEALTH_CHECK"
    ) {
      return "ORION_HEALTH";
    }

    if (
      workflow ===
      "WEBSITE_REVIEW"
    ) {
      return "WEBSITE_REVIEW";
    }

    if (
      workflow ===
      "INSTANTLY_LIVE_REVIEW"
    ) {
      return "INSTANTLY_LIVE";
    }

    return "BUSINESS_EXECUTION";
  }

  resolveProvider(
    text,
    intent,
    workflow,
    capability,
    operation = {}
  ) {
    if (
      operation.provider &&
      operation.forceProvider === true
    ) {
      return String(
        operation.provider
      );
    }

    if (
      [
        "REVENUE_OPERATIONS",
        "EXECUTIVE_STATUS",
        "ENGINEERING",
        "EXECUTIVE_AUDIT"
      ].includes(intent)
    ) {
      return "MILES";
    }

    if (
      workflow ===
      "ORION_HEALTH_CHECK"
    ) {
      return "ORION";
    }

    /*
      Business reviews are executed through the MILES builder/controller
      actions already registered in the local system.
    */

    return "MILES";
  }

  resolveAction(
    text,
    intent,
    workflow,
    capability,
    provider,
    operation = {}
  ) {
    if (
      operation.action &&
      operation.forceAction === true
    ) {
      const forced =
        String(
          operation.action
        ).toUpperCase();

      return forced ===
        "MILES_EXECUTE"
        ? "BUSINESS_EXECUTION"
        : forced;
    }

    if (
      intent ===
      "REVENUE_OPERATIONS"
    ) {
      return "BUSINESS_EXECUTION";
    }

    if (
      intent ===
      "EXECUTIVE_STATUS"
    ) {
      return "STATUS";
    }

    if (
      intent === "ENGINEERING"
    ) {
      return (
        capability ||
        "ENGINEERING_IMPROVEMENT"
      );
    }

    if (
      intent ===
      "EXECUTIVE_AUDIT"
    ) {
      return "ENGINEERING_REPORT";
    }

    if (
      provider === "ORION"
    ) {
      if (
        /table|schema/
          .test(text)
      ) {
        return "ORION_TABLES";
      }

      if (
        /contractor/
          .test(text)
      ) {
        return "ORION_CONTRACTORS";
      }

      if (
        /buyer/
          .test(text)
      ) {
        return "ORION_BUYERS";
      }

      if (
        /opportunit/
          .test(text)
      ) {
        return "ORION_OPPORTUNITIES";
      }

      if (
        /recompete|expiration|expiring/
          .test(text)
      ) {
        return "ORION_RECOMPETES";
      }

      if (
        /recommend/
          .test(text)
      ) {
        return "ORION_RECOMMENDATIONS";
      }

      if (
        /persona/
          .test(text)
      ) {
        return "ORION_PERSONAS";
      }

      if (
        /summary|executive|report|brief/
          .test(text)
      ) {
        return "ORION_SUMMARY";
      }

      return "ORION_HEALTH";
    }

    if (
      workflow ===
      "INSTANTLY_LIVE_REVIEW"
    ) {
      return "INSTANTLY_LIVE";
    }

    if (
      workflow ===
      "WEBSITE_REVIEW"
    ) {
      return "WEBSITE_REVIEW";
    }

    return "BUSINESS_EXECUTION";
  }

  resolveConnector(
    provider,
    action,
    capability,
    operation = {}
  ) {
    if (
      operation.connector &&
      operation.forceConnector === true
    ) {
      return String(
        operation.connector
      );
    }

    return (
      provider === "ORION"
        ? "ORION"
        : "MILES"
    );
  }

  resolveDepartment(
    intent,
    provider
  ) {
    if (
      intent ===
      "REVENUE_OPERATIONS"
    ) {
      return "Revenue Operations";
    }

    if (
      intent === "ENGINEERING"
    ) {
      return "Engineering";
    }

    if (
      provider === "ORION"
    ) {
      return "ORION";
    }

    return "Executive";
  }

  resolveSteps(
    text,
    intent,
    workflow,
    capability,
    provider,
    connector,
    action
  ) {
    if (
      intent ===
      "REVENUE_OPERATIONS"
    ) {
      return [
        {
          step: 1,
          provider: "MILES",
          connector: "MILES",
          capability:
            "PROVIDER_AUTHORITY",
          action:
            "PROVIDER_AUTHORITY",
          objective:
            "Verify authority, credentials, and write permissions for Instantly, Google Workspace, Namecheap, LinkedIn, ORION, and supporting systems."
        },
        {
          step: 2,
          provider: "MILES",
          connector: "MILES",
          capability:
            "PROVIDER_SYNC",
          action:
            "PROVIDER_SYNC",
          objective:
            "Synchronize domains, mailboxes, campaigns, segments, replies, and platform state."
        },
        {
          step: 3,
          provider: "MILES",
          connector: "MILES",
          capability:
            "INSTANTLY_LIVE",
          action:
            "INSTANTLY_LIVE",
          objective:
            "Perform live Instantly inventory, campaign, inbox, warmup, capacity, lead, reply, and deliverability assessment."
        },
        {
          step: 4,
          provider: "MILES",
          connector: "MILES",
          capability:
            "BUSINESS_EXECUTION",
          action:
            "BUSINESS_EXECUTION",
          objective:
            "Create and execute the authorized revenue-operations work required by the CEO objective."
        },
        {
          step: 5,
          provider: "MILES",
          connector: "MILES",
          capability:
            "CONTROLLED_WRITE",
          action:
            "CONTROLLED_WRITE",
          objective:
            "Stage protected external changes for governance approval before any customer-facing or paid action."
        }
      ];
    }

    return [
      {
        step: 1,
        provider,
        connector,
        capability,
        action,
        objective: text
      }
    ];
  }
}

module.exports =
  new CommandIntentPlannerService();