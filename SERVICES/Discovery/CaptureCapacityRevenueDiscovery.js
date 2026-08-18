"use strict";

const CaptureCapacityProspectDiscoveryService = require("../revenue/CaptureCapacityProspectDiscoveryService");
const CaptureCapacitySourceBootstrapService = require("../revenue/CaptureCapacitySourceBootstrapService");
const CaptureCapacityOrionSignalBridgeService = require("../revenue/CaptureCapacityOrionSignalBridgeService");

class CaptureCapacityRevenueDiscovery {
  constructor(options = {}) {
    this.service = options.service || new CaptureCapacityProspectDiscoveryService({ maxFiles: 100 });
    this.sourceBootstrap = options.sourceBootstrap || CaptureCapacitySourceBootstrapService;
    this.signalBridge = options.signalBridge || CaptureCapacityOrionSignalBridgeService;
  }

  async discover() {
    const sourceBootstrap = this.sourceBootstrap.apply();
    const signalBridge = this.signalBridge.apply();
    const result = this.service.discover({ maxAudience: 2000 });
    const counts = result.sourceCounts || {};
    const work = [];

    if ((counts.qualifiedRows || 0) > 0) {
      work.push({
        id: "P2GC-CAPTURE-CAPACITY-QUALIFIED-HANDOFF",
        objective: `Hand ${counts.qualifiedRows} evidence-backed, trigger-qualified capture-capacity prospects into the P2GC Capture Intelligence Sprint campaign pipeline.`,
        provider: "Instantly",
        domain: "Revenue Operations",
        priority: "CRITICAL",
        priorityScore: 100,
        reason: "Qualified prospects already passed the Capture Capacity personalization and evidence gates and represent immediate revenue work.",
        capability: "revenue.capture_capacity_handoff",
        metadata: {
          qualifiedRows: counts.qualifiedRows,
          enrichedRows: counts.enrichedRows || 0,
          artifact: result.artifact || null,
          nextAction: result.nextAction,
          sourceBootstrapStatus: sourceBootstrap.status,
          sourceBootstrapArtifact: sourceBootstrap.artifact || null,
          signalBridgeStatus: signalBridge.status,
          verifiedOrionSignals: signalBridge.verifiedSignalCount || 0,
          orionValidationQueue: signalBridge.validationQueueCount || 0,
          signalBridgeArtifact: signalBridge.artifact || null
        },
        discoveredAt: new Date().toISOString()
      });
    } else if ((counts.contactRows || 0) === 0) {
      work.push({
        id: "P2GC-CAPTURE-CAPACITY-CONTACT-SUPPLY",
        objective: "Refresh the capture-capacity prospect contact universe with federal contractors large enough to maintain active BD/capture functions.",
        provider: "Revenue",
        domain: "Revenue Operations",
        priority: "CRITICAL",
        priorityScore: 98,
        reason: sourceBootstrap.ok
          ? "External lead sources were located, but the Capture Capacity campaign still has no usable person-level contact supply to evaluate."
          : "The Capture Capacity campaign has no usable contact supply and no current external contact source could be bootstrapped from the existing source index.",
        capability: "revenue.capture_capacity_contact_supply",
        metadata: {
          artifact: result.artifact || null,
          sourceBootstrapStatus: sourceBootstrap.status,
          sourceBootstrapArtifact: sourceBootstrap.artifact || null,
          selectedContactSources: sourceBootstrap.selectedCount || 0,
          signalBridgeStatus: signalBridge.status,
          verifiedOrionSignals: signalBridge.verifiedSignalCount || 0,
          orionValidationQueue: signalBridge.validationQueueCount || 0
        },
        discoveredAt: new Date().toISOString()
      });
    } else if ((counts.signalRows || 0) === 0) {
      work.push({
        id: "P2GC-CAPTURE-CAPACITY-SIGNAL-REFRESH",
        objective: "Collect or validate fresh source-backed capture-capacity signals: capture/BD hiring, new IDIQ/GWAC or vehicle awards, agency expansion, recompetes, federal award growth, and acquisitions.",
        provider: "ORION",
        domain: "Revenue Intelligence",
        priority: "CRITICAL",
        priorityScore: 98,
        reason: (signalBridge.validationQueueCount || 0) > 0
          ? `${signalBridge.validationQueueCount} ORION signal candidates require public-source validation before they can be used for outbound personalization.`
          : "Prospects exist, but the campaign cannot enroll them without evidence-backed current triggers.",
        capability: "revenue.capture_capacity_signal_refresh",
        metadata: {
          contactRows: counts.contactRows || 0,
          artifact: result.artifact || null,
          sourceBootstrapStatus: sourceBootstrap.status,
          selectedContactSources: sourceBootstrap.selectedCount || 0,
          signalBridgeStatus: signalBridge.status,
          verifiedOrionSignals: signalBridge.verifiedSignalCount || 0,
          orionValidationQueue: signalBridge.validationQueueCount || 0,
          orionValidationFile: signalBridge.validationFile || null,
          signalBridgeArtifact: signalBridge.artifact || null
        },
        discoveredAt: new Date().toISOString()
      });
    } else {
      work.push({
        id: "P2GC-CAPTURE-CAPACITY-ENRICHMENT-GAPS",
        objective: "Resolve capture-capacity identity, evidence, or personalization gaps for prospects that did not pass the campaign gate.",
        provider: "Revenue",
        domain: "Revenue Operations",
        priority: "HIGH",
        priorityScore: 92,
        reason: "Contact and signal data exist, but no prospect currently satisfies all evidence and personalization requirements.",
        capability: "revenue.capture_capacity_enrichment",
        metadata: {
          contactRows: counts.contactRows || 0,
          signalRows: counts.signalRows || 0,
          enrichedRows: counts.enrichedRows || 0,
          blockedByCampaignGate: counts.blockedByCampaignGate || 0,
          artifact: result.artifact || null,
          sourceBootstrapStatus: sourceBootstrap.status,
          selectedContactSources: sourceBootstrap.selectedCount || 0,
          signalBridgeStatus: signalBridge.status,
          verifiedOrionSignals: signalBridge.verifiedSignalCount || 0,
          orionValidationQueue: signalBridge.validationQueueCount || 0
        },
        discoveredAt: new Date().toISOString()
      });
    }

    return {
      ok: true,
      source: "CaptureCapacityRevenueDiscovery",
      feed: {
        artifact: result.artifact || null,
        sourceCounts: counts,
        campaignGate: result.campaignGate,
        nextAction: result.nextAction,
        sourceBootstrap,
        signalBridge
      },
      work
    };
  }
}

module.exports = new CaptureCapacityRevenueDiscovery();
module.exports.CaptureCapacityRevenueDiscovery = CaptureCapacityRevenueDiscovery;
