"use strict";

const path = require("path");
const WinBackLocalHistoryDiscoveryService = require("./SERVICES/revenue/WinBackLocalHistoryDiscoveryService");
const WinBackProspectReconstructionService = require("./SERVICES/revenue/WinBackProspectReconstructionService");
const WinBackMasterExportService = require("./SERVICES/revenue/WinBackMasterExportService");
const WinBackCampaignService = require("./SERVICES/revenue/WinBackCampaignCrossGenService");

function argValue(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find(item => item.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const rootDir = path.resolve(process.env.MILES_ROOT || __dirname);

  const localDiscovery = new WinBackLocalHistoryDiscoveryService({ rootDir });
  const localHistoryReport = localDiscovery.execute({ writeReport: true });

  const reconstruction = new WinBackProspectReconstructionService({
    rootDir,
    seedPaths: [
      path.join(rootDir, "DATA", "revenue", "winback", "calendly_seed_20260818.json"),
      path.join(rootDir, "DATA", "revenue", "winback", "calendar_recovered_seed_20260818.json"),
      localHistoryReport.seedPath
    ]
  });
  const campaign = new WinBackCampaignService({ rootDir });
  const exporter = new WinBackMasterExportService({ rootDir });

  const reconstructionReport = reconstruction.execute({ writeReport: true });
  const exportReport = exporter.execute({
    reconstruction: reconstructionReport,
    localHistory: localHistoryReport
  });
  const apply = hasFlag("apply");
  const activate = hasFlag("activate");

  const campaignReport = await campaign.execute({
    priorConversationCandidates: reconstructionReport.priorConversationCandidates,
    reactivationCandidates: reconstructionReport.reactivationCandidates,
    apply,
    activate,
    priorActivationApproval: argValue("prior-approval") || process.env.P2GC_WINBACK_PRIOR_ACTIVATION_APPROVAL,
    reactivationActivationApproval: argValue("reactivation-approval") || process.env.P2GC_WINBACK_REACTIVATION_ACTIVATION_APPROVAL,
    dailyLimit: Number(argValue("daily-limit") || process.env.P2GC_WINBACK_DAILY_LIMIT || 20),
    dailyMaxLeads: Number(argValue("daily-max-leads") || process.env.P2GC_WINBACK_DAILY_MAX_LEADS || 20),
    writeReport: true
  });

  const summary = {
    ok: campaignReport.ok,
    mode: apply ? "APPLY" : "PLAN_ONLY",
    localHistory: {
      status: localHistoryReport.status,
      roots: localHistoryReport.roots,
      obsidianVaults: localHistoryReport.obsidianVaults,
      filesDiscovered: localHistoryReport.filesDiscovered,
      exactTargetFilesFound: localHistoryReport.exactTargetFilesFound,
      recordsRecovered: localHistoryReport.recordsRecovered,
      confirmedPriorConversationCount: localHistoryReport.confirmedPriorConversationCount,
      reactivationCount: localHistoryReport.reactivationCount,
      reviewCount: localHistoryReport.reviewCount,
      seedPath: localHistoryReport.seedPath
    },
    reconstruction: {
      status: reconstructionReport.status,
      seedCount: reconstructionReport.seedCount,
      contactRecordsScanned: reconstructionReport.contactRecordsScanned,
      priorConversationCount: reconstructionReport.priorConversationCount,
      reactivationCount: reconstructionReport.reactivationCount,
      blockedCount: reconstructionReport.blockedCount,
      artifact: reconstructionReport.artifact
    },
    exports: {
      masterCount: exportReport.masterCount,
      priorReadyCount: exportReport.priorReadyCount,
      reactivationReadyCount: exportReport.reactivationReadyCount,
      reviewCount: exportReport.reviewCount,
      evidenceEnrichedCount: exportReport.evidenceEnrichedCount,
      files: exportReport.files
    },
    campaigns: {
      prior: {
        status: campaignReport.prior.status,
        eligibleCount: campaignReport.prior.audience.eligibleCount,
        campaignId: campaignReport.prior.campaignId || null,
        leadsUploaded: campaignReport.prior.leadsUploaded,
        activated: campaignReport.prior.campaignActivated
      },
      reactivation: {
        status: campaignReport.reactivation.status,
        eligibleCount: campaignReport.reactivation.audience.eligibleCount,
        campaignId: campaignReport.reactivation.campaignId || null,
        leadsUploaded: campaignReport.reactivation.leadsUploaded,
        activated: campaignReport.reactivation.campaignActivated
      }
    },
    messagingStandard: campaignReport.prior.definition?.messagingStandard?.version || null,
    campaignArtifact: campaignReport.artifact
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.ok && apply) process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
