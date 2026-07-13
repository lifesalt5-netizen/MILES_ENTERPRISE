"use strict";

const BasePlanner = require("./BasePlanner");

class OrionPlanner extends BasePlanner {
  constructor() {
    super({
      domain: "orion",
      workforce: "ORION Workforce",
      priority: "HIGH"
    });
  }

  matches(objective = "", context = {}) {
    const text = [
      objective,
      context.provider,
      context.domain,
      context.discoveryReason,
      context.discoveredWorkId
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return /orion|governmentdata|government data|govdata|usaspending|usa spending|gsa|gsa elibrary|elibrary|va fss|vafss|sam|sam\.gov|forecast|forecasts|rfi|rfis|sources sought|source sought|procurement|acquisition|award|awards|vehicle|vehicles|contractor|buyer|opportunit|recompete|recommendation|persona|database|sqlite|intelligence/.test(text);
  }

  createPlan(objective, context = {}) {
    const text = [
      objective,
      context.provider,
      context.domain,
      context.discoveryReason,
      context.discoveredWorkId
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const isGovernmentData =
      /governmentdata|government data|govdata|usaspending|usa spending|gsa|gsa elibrary|elibrary|va fss|vafss|sam|sam\.gov|forecast|forecasts|rfi|rfis|sources sought|source sought|procurement|acquisition|award|awards|vehicle|vehicles|intelligence/.test(text);

    const requiredCapabilities = isGovernmentData
      ? [
          "government_data.refresh.status",
          "government_data.source.health.audit",
          "orion.data.inventory.evaluate",
          "executive.update.generate"
        ]
      : [
          "orion.sqlite.read",
          "orion.database.health.audit",
          "orion.data.inventory.evaluate",
          "executive.update.generate"
        ];

    const steps = isGovernmentData
      ? [
          this.createStep(1, "government_data.refresh.status", {
            department: "ORION",
            provider: "GovernmentData",
            action: "checkGovernmentDataRefreshStatus",
            expectedOutput: "Current refresh status for USAspending, GSA eLibrary, VA FSS, SAM, forecasts, RFIs, sources sought, and other scheduled intelligence pulls.",
            verification: "Verify last refresh, next refresh, source availability, failures, and records changed are captured."
          }),
          this.createStep(2, "government_data.source.health.audit", {
            department: "ORION",
            provider: "GovernmentData",
            action: "auditGovernmentDataSources",
            expectedOutput: "Government data source health assessment.",
            verification: "Verify source availability, connector readiness, stale data, and failed pulls are identified."
          }),
          this.createStep(3, "orion.data.inventory.evaluate", {
            department: "ORION",
            provider: "OrionProvider",
            action: "evaluateDataReadiness",
            expectedOutput: "ORION readiness impact from current government data status.",
            verification: "Verify the output identifies stale intelligence, missing source refreshes, and blocked ORION updates."
          }),
          this.createStep(4, "executive.update.generate", {
            department: "Executive",
            provider: "OrionProvider",
            action: "generateExecutiveUpdate",
            expectedOutput: "Executive government intelligence status update.",
            verification: "Verify update explains current data status, failures, risks, and next autonomous actions."
          })
        ]
      : [
          this.createStep(1, "orion.sqlite.read", {
            department: "ORION",
            provider: "OrionProvider",
            action: "readDatabaseStatus",
            expectedOutput: "Current ORION production database counts and table health.",
            verification: "Verify contractor, buyer, opportunity, recompete, recommendation, and persona counts are captured."
          }),
          this.createStep(2, "orion.database.health.audit", {
            department: "ORION",
            provider: "OrionProvider",
            action: "auditDatabaseHealth",
            expectedOutput: "ORION database health assessment.",
            verification: "Verify database access, table availability, and expected production counts."
          }),
          this.createStep(3, "orion.data.inventory.evaluate", {
            department: "ORION",
            provider: "OrionProvider",
            action: "evaluateDataReadiness",
            expectedOutput: "ORION data readiness and missing implementation list.",
            verification: "Verify the output identifies missing tables, weak joins, or blocked intelligence layers."
          }),
          this.createStep(4, "executive.update.generate", {
            department: "Executive",
            provider: "OrionProvider",
            action: "generateExecutiveUpdate",
            expectedOutput: "Executive ORION status update.",
            verification: "Verify update explains current status, risks, and next actions."
          })
        ];

    return {
      matched: true,
      domain: this.domain,
      workforce: this.workforce,
      requiredCapabilities,
      steps,
      executionAuthority: "MILES_AUTONOMOUS_COO",
      approvalRequired: false,
      providers: isGovernmentData ? ["GovernmentData", "OrionProvider"] : ["OrionProvider"],
      verificationChecklist: isGovernmentData
        ? [
            "Government data refresh status was checked.",
            "USAspending, GSA eLibrary, VA FSS, SAM, forecasts, RFIs, and sources sought were evaluated.",
            "Source freshness and connector health were reviewed.",
            "ORION impact was identified.",
            "Executive update was generated."
          ]
        : [
            "ORION database can be read.",
            "Core production counts are captured.",
            "Data health is evaluated.",
            "Executive update is generated."
          ],
      successCriteria: isGovernmentData
        ? [
            "Government intelligence status is current.",
            "Stale or failed data pulls are identified.",
            "Next autonomous refresh action is available.",
            "No CEO approval is required for routine data refresh checks."
          ]
        : [
            "ORION status is current.",
            "Missing implementation is clearly identified.",
            "Next operational action is available."
          ],
      context
    };
  }
}

module.exports = new OrionPlanner();