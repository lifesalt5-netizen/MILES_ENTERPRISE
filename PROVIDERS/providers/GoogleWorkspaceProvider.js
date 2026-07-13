"use strict";

const fs = require("fs");
const path = require("path");
const IDataProvider = require("../contracts/IDataProvider");

const defaultWorkspace =
  require("../../CONNECTORS/GOOGLE/workspace");

const defaultAccountManager =
  require("../../CONNECTORS/GOOGLE/account_manager");

const ROOT =
  process.env.MILES_ROOT ||
  process.cwd();

const OUT_DIR =
  path.join(
    ROOT,
    "DATA",
    "google_workspace_coo"
  );

function ensureDir() {
  fs.mkdirSync(
    OUT_DIR,
    { recursive: true }
  );
}

function persistEvidence(result) {
  ensureDir();

  const stamp = Date.now();

  const historical =
    path.join(
      OUT_DIR,
      `google_workspace_operation_${stamp}.json`
    );

  const latest =
    path.join(
      OUT_DIR,
      "latest_google_workspace_operation.json"
    );

  const text =
    JSON.stringify(
      result,
      null,
      2
    );

  fs.writeFileSync(
    historical,
    text,
    "utf8"
  );

  fs.writeFileSync(
    latest,
    text,
    "utf8"
  );

  return historical;
}

function validAccounts(
  accountManager
) {
  try {
    return (
      accountManager
        .listAccounts()
        .filter(
          account =>
            account.valid
        )
    );
  } catch {
    return [];
  }
}

function snapshotError(
  account,
  error
) {
  return {
    account:
      account.email ||
      account.accountKey ||
      "Unknown",
    accountKey:
      account.accountKey ||
      null,
    ok: false,
    error:
      error.message
  };
}

class GoogleWorkspaceProvider
  extends IDataProvider {
  constructor(options = {}) {
    super("Google Workspace");

    this.workspace =
      options.workspace ||
      defaultWorkspace;

    this.accountManager =
      options.accountManager ||
      defaultAccountManager;

    this.dependencies = [
      "Google OAuth",
      "Gmail",
      "Google Calendar",
      "Google Drive"
    ];

    this.sourceSystems = [
      "CONNECTORS/GOOGLE/workspace.js",
      "CONNECTORS/GOOGLE/account_manager.js"
    ];

    this.accounts = [];
    this.snapshots = [];
  }

  async initialize() {
    return this.auditWorkspace();
  }

  async refresh() {
    return this.auditWorkspace();
  }

  async collectSnapshots() {
    const accounts =
      validAccounts(
        this.accountManager
      );

    const snapshots = [];

    for (const account of accounts) {
      try {
        const snapshot =
          await this.workspace
            .getWorkspaceSnapshot(
              account.accountKey
            );

        snapshots.push({
          ...snapshot,
          accountKey:
            account.accountKey,
          ok: true
        });
      } catch (error) {
        snapshots.push(
          snapshotError(
            account,
            error
          )
        );
      }
    }

    return {
      accounts,
      snapshots
    };
  }

  async auditWorkspace() {
    this.lastRefresh =
      new Date().toISOString();

    this.dataFreshness =
      "Live";

    const collected =
      await this.collectSnapshots();

    this.accounts =
      collected.accounts;

    this.snapshots =
      collected.snapshots;

    const successful =
      this.snapshots.filter(
        snapshot =>
          snapshot.ok !== false
      );

    const failed =
      this.snapshots.filter(
        snapshot =>
          snapshot.ok === false
      );

    const totals = successful.reduce(
      (summary, snapshot) => {
        summary.inboxEstimate +=
          Number(
            snapshot.inboxEstimate ||
            0
          );

        summary.recentInboxCount +=
          Number(
            snapshot.recentInboxCount ||
            0
          );

        summary.upcomingEventsCount +=
          Number(
            snapshot.upcomingEventsCount ||
            0
          );

        summary.recentDriveFilesCount +=
          Number(
            snapshot.recentDriveFilesCount ||
            0
          );

        return summary;
      },
      {
        inboxEstimate: 0,
        recentInboxCount: 0,
        upcomingEventsCount: 0,
        recentDriveFilesCount: 0
      }
    );

    const noAccounts =
      this.accounts.length === 0;

    this.status =
      failed.length > 0
        ? "Watch"
        : noAccounts
          ? "Watch"
          : "Healthy";

    this.metrics = {
      registeredAccounts:
        this.accounts.length,
      healthyAccounts:
        successful.length,
      failedAccounts:
        failed.length,
      inboxEstimate:
        totals.inboxEstimate,
      recentInboxCount:
        totals.recentInboxCount,
      upcomingEventsCount:
        totals.upcomingEventsCount,
      recentDriveFilesCount:
        totals.recentDriveFilesCount
    };

    this.exceptions = [
      ...failed.map(
        snapshot => ({
          type:
            "GoogleAccountHealth",
          severity:
            "Warning",
          message:
            `${snapshot.account}: ${snapshot.error}`
        })
      )
    ];

    if (noAccounts) {
      this.exceptions.push({
        type:
          "GoogleAccountRegistry",
        severity:
          "Info",
        message:
          "No valid Google Workspace accounts are registered."
      });
    }

    this.recommendations = [];

    if (noAccounts) {
      this.recommendations.push(
        "Register approved Google Workspace accounts through the existing account manager."
      );
    }

    if (failed.length > 0) {
      this.recommendations.push(
        "Reauthorize failed Google accounts before enabling operational workflows."
      );
    }

    if (
      totals.recentInboxCount > 0
    ) {
      this.recommendations.push(
        `Review ${totals.recentInboxCount} recent inbox message(s) for sales, client, proposal, and operational follow-up.`
      );
    }

    if (
      totals.upcomingEventsCount > 0
    ) {
      this.recommendations.push(
        `Prepare briefs for ${totals.upcomingEventsCount} upcoming calendar event(s).`
      );
    }

    const result = {
      ok:
        failed.length === 0,
      provider:
        "GoogleWorkspaceProvider",
      action:
        "auditWorkspace",
      status:
        this.status,
      generatedAt:
        this.lastRefresh,
      readOnly: true,
      metrics:
        this.metrics,
      exceptions:
        this.exceptions,
      recommendations:
        this.recommendations,
      accounts:
        this.accounts,
      snapshots:
        this.snapshots,
      safety: {
        workspaceMode:
          "READ_ONLY",
        emailSendingEnabled:
          false,
        emailModificationEnabled:
          false,
        calendarWritesEnabled:
          false,
        driveWritesEnabled:
          false,
        userProvisioningEnabled:
          false,
        aliasChangesEnabled:
          false
      }
    };

    result.evidenceFile =
      persistEvidence(result);

    return result;
  }

  async reviewInbox() {
    const result =
      await this.auditWorkspace();

    return {
      ...result,
      action:
        "reviewInbox",
      focus: {
        recentInboxCount:
          result.metrics
            .recentInboxCount,
        inboxEstimate:
          result.metrics
            .inboxEstimate
      }
    };
  }

  async reviewCalendar() {
    const result =
      await this.auditWorkspace();

    return {
      ...result,
      action:
        "reviewCalendar",
      focus: {
        upcomingEventsCount:
          result.metrics
            .upcomingEventsCount
      }
    };
  }

  async reviewDrive() {
    const result =
      await this.auditWorkspace();

    return {
      ...result,
      action:
        "reviewDrive",
      focus: {
        recentDriveFilesCount:
          result.metrics
            .recentDriveFilesCount
      }
    };
  }

  async executeTask(task = {}) {
    const action =
      task.payload?.action ||
      task.action ||
      "auditWorkspace";

    if (
      typeof this[action] !==
      "function"
    ) {
      throw new Error(
        `Unsupported GoogleWorkspaceProvider action: ${action}`
      );
    }

    return this[action](task);
  }

  async shutdown() {
    return true;
  }
}

module.exports =
  GoogleWorkspaceProvider;

