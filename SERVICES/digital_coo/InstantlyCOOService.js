'use strict';

/*
  MILES Enterprise
  File: SERVICES/digital_coo/InstantlyCOOService.js
  Version: 1.0.0

  Purpose:
  - Read live Instantly campaigns and sending accounts through ConnectorRuntime.
  - Evaluate outbound infrastructure health.
  - Enforce awareness of protected P2GC domains and inboxes.
  - Generate recommendations without changing Instantly.
  - Persist JSON and Markdown executive reports.

  Safety:
  - This service is READ-ONLY.
  - It does not create, update, pause, resume, or delete anything.
*/

const fs = require('fs');
const path = require('path');

const ConnectorRuntime = require(
  '../connector_runtime/ConnectorRuntime'
);

class InstantlyCOOService {
  constructor(options = {}) {
    this.service = 'INSTANTLY_COO_SERVICE';
    this.version = '1.0.0';

    this.rootDir = path.resolve(
      options.rootDir ||
      process.env.MILES_ROOT ||
      process.cwd()
    );

    this.runtimeDir = path.resolve(
      options.runtimeDir ||
      path.join(
        this.rootDir,
        'runtime',
        'instantly_coo'
      )
    );

    this.reportDir = path.resolve(
      options.reportDir ||
      path.join(
        this.rootDir,
        'REPORTS',
        'INSTANTLY_COO'
      )
    );

    this.latestSnapshotPath = path.join(
      this.runtimeDir,
      'instantly_coo_latest.json'
    );

    this.latestMarkdownPath = path.join(
      this.runtimeDir,
      'instantly_coo_latest.md'
    );

    this.eventLogPath = path.join(
      this.runtimeDir,
      'instantly_coo_events.jsonl'
    );

    this.protectedDomains = new Set(
      this.parseList(
        process.env.MILES_PROTECTED_OUTBOUND_DOMAINS ||
        'pathways2gc.com'
      ).map(value => value.toLowerCase())
    );

    this.protectedInboxes = new Set(
      this.parseList(
        process.env.MILES_PROTECTED_OUTBOUND_INBOXES ||
        'info@pathways2gc.com'
      ).map(value => value.toLowerCase())
    );

    this.warmupWarningScore = this.numberFromEnvironment(
      'MILES_INSTANTLY_WARMUP_WARNING_SCORE',
      90
    );

    this.warmupCriticalScore = this.numberFromEnvironment(
      'MILES_INSTANTLY_WARMUP_CRITICAL_SCORE',
      75
    );

    this.defaultAccountLimit = this.numberFromEnvironment(
      'MILES_INSTANTLY_ACCOUNT_PAGE_LIMIT',
      100
    );

    this.defaultCampaignLimit = this.numberFromEnvironment(
      'MILES_INSTANTLY_CAMPAIGN_PAGE_LIMIT',
      100
    );

    this.runtime =
      options.runtime ||
      new ConnectorRuntime({
        rootDir: this.rootDir
      });

    this.ensureStorage();
  }

  now() {
    return new Date().toISOString();
  }

  parseList(value) {
    return String(value || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }

  numberFromEnvironment(name, fallback) {
    const parsed = Number(
      process.env[name]
    );

    return Number.isFinite(parsed)
      ? parsed
      : fallback;
  }

  ensureStorage() {
    fs.mkdirSync(
      this.runtimeDir,
      {
        recursive: true
      }
    );

    fs.mkdirSync(
      this.reportDir,
      {
        recursive: true
      }
    );

    if (!fs.existsSync(this.eventLogPath)) {
      fs.writeFileSync(
        this.eventLogPath,
        '',
        'utf8'
      );
    }
  }

  appendEvent(eventType, payload = {}) {
    fs.appendFileSync(
      this.eventLogPath,
      `${JSON.stringify({
        eventType,
        payload,
        generatedAt: this.now()
      })}\n`,
      'utf8'
    );
  }

  atomicWrite(filePath, value) {
    fs.mkdirSync(
      path.dirname(filePath),
      {
        recursive: true
      }
    );

    const temporaryPath =
      `${filePath}.${process.pid}.${Date.now()}.tmp`;

    const text =
      typeof value === 'string'
        ? value
        : JSON.stringify(
            value,
            null,
            2
          );

    try {
      fs.writeFileSync(
        temporaryPath,
        text,
        'utf8'
      );

      fs.renameSync(
        temporaryPath,
        filePath
      );
    } catch {
      try {
        fs.writeFileSync(
          filePath,
          text,
          'utf8'
        );
      } finally {
        try {
          if (fs.existsSync(temporaryPath)) {
            fs.unlinkSync(temporaryPath);
          }
        } catch {}
      }
    }
  }

  resolveItems(value) {
    if (Array.isArray(value)) {
      return value;
    }

    if (
      value &&
      Array.isArray(value.items)
    ) {
      return value.items;
    }

    if (
      value &&
      Array.isArray(value.data)
    ) {
      return value.data;
    }

    return [];
  }

  getEmailDomain(email) {
    const normalized =
      String(email || '')
        .trim()
        .toLowerCase();

    const separator =
      normalized.lastIndexOf('@');

    return separator >= 0
      ? normalized.slice(separator + 1)
      : '';
  }

  isProtectedAccount(email) {
    const normalized =
      String(email || '')
        .trim()
        .toLowerCase();

    const domain =
      this.getEmailDomain(normalized);

    return (
      this.protectedInboxes.has(normalized) ||
      this.protectedDomains.has(domain)
    );
  }

  async executeInstantly(
    connectorAction,
    payload = {}
  ) {
    const timeoutMs =
      Number(
        process.env.MILES_INSTANTLY_ACTION_TIMEOUT_MS ||
        10000
      );

    const startedAt =
      Date.now();

    let timeoutHandle = null;

    const timeoutPromise =
      new Promise((resolve, reject) => {
        timeoutHandle =
          setTimeout(() => {
            reject(
              new Error(
                `Instantly action ${connectorAction} timed out after ${timeoutMs} ms`
              )
            );
          }, timeoutMs);

        if (
          timeoutHandle &&
          typeof timeoutHandle.unref === 'function'
        ) {
          timeoutHandle.unref();
        }
      });

    console.log(
      `[INSTANTLY_COO] ${connectorAction} START timeout=${timeoutMs}ms`
    );

    let result;

    try {
      result =
        await Promise.race([
          this.runtime.execute({
            connectorId: 'INSTANTLY',
            connectorAction,
            payload
          }),
          timeoutPromise
        ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      console.log(
        `[INSTANTLY_COO] ${connectorAction} EXIT elapsed=${Date.now() - startedAt}ms`
      );
    }

    if (!result || !result.ok) {
      throw new Error(
        result?.error ||
        result?.result?.error ||
        `Instantly action failed: ${connectorAction}`
      );
    }

    if (
      result.result &&
      result.result.ok === false
    ) {
      throw new Error(
        result.result.error ||
        `Instantly returned an unsuccessful result: ${connectorAction}`
      );
    }

    return result.result;
  }

  analyzeAccount(account = {}) {
    const email =
      String(account.email || '')
        .trim()
        .toLowerCase();

    const domain =
      this.getEmailDomain(email);

    const protectedAccount =
      this.isProtectedAccount(email);

    const warmupScore =
      Number.isFinite(
        Number(account.stat_warmup_score)
      )
        ? Number(account.stat_warmup_score)
        : null;

    const warmupEnabled =
      Number(account.warmup_status) === 1;

    const accountEnabled =
      Number(account.status) === 1;

    const setupPending =
      account.setup_pending === true;

    const dailyLimit =
      Number.isFinite(
        Number(account.daily_limit)
      )
        ? Number(account.daily_limit)
        : null;

    const issues = [];
    const recommendations = [];

    let severity = 'HEALTHY';

    if (protectedAccount) {
      severity = 'PROTECTED';

      if (warmupEnabled) {
        issues.push(
          'Protected account has warmup enabled.'
        );

        recommendations.push(
          `Disable warmup for protected inbox ${email}.`
        );
      }

      if (dailyLimit && dailyLimit > 0) {
        issues.push(
          'Protected account has an outbound daily limit configured.'
        );

        recommendations.push(
          `Keep protected inbox ${email} excluded from all outbound campaigns.`
        );
      }
    } else {
      if (!accountEnabled) {
        severity = 'CRITICAL';

        issues.push(
          'Sending account is disabled.'
        );

        recommendations.push(
          `Review and restore account ${email} before assigning it to campaigns.`
        );
      }

      if (setupPending) {
        severity = 'CRITICAL';

        issues.push(
          'Sending account setup is still pending.'
        );

        recommendations.push(
          `Complete setup for ${email}.`
        );
      }

      if (!warmupEnabled) {
        if (severity !== 'CRITICAL') {
          severity = 'WARNING';
        }

        issues.push(
          'Warmup is not enabled.'
        );

        recommendations.push(
          `Review warmup status for ${email}.`
        );
      }

      if (
        warmupScore !== null &&
        warmupScore < this.warmupCriticalScore
      ) {
        severity = 'CRITICAL';

        issues.push(
          `Warmup score is critically low at ${warmupScore}.`
        );

        recommendations.push(
          `Remove ${email} from active sending until its warmup score recovers.`
        );
      } else if (
        warmupScore !== null &&
        warmupScore < this.warmupWarningScore
      ) {
        if (severity !== 'CRITICAL') {
          severity = 'WARNING';
        }

        issues.push(
          `Warmup score is below the warning threshold at ${warmupScore}.`
        );

        recommendations.push(
          `Reduce sending volume for ${email} and monitor recovery.`
        );
      }

      if (
        dailyLimit === null ||
        dailyLimit <= 0
      ) {
        if (severity === 'HEALTHY') {
          severity = 'WARNING';
        }

        issues.push(
          'No usable daily sending limit was found.'
        );

        recommendations.push(
          `Review the daily sending limit for ${email}.`
        );
      }
    }

    return {
      email,
      domain,
      protected: protectedAccount,
      severity,
      accountEnabled,
      setupPending,
      warmupEnabled,
      warmupScore,
      dailyLimit,
      sendingGap:
        account.sending_gap ?? null,
      slowRamp:
        account.enable_slow_ramp ?? null,
      providerCode:
        account.provider_code ?? null,
      issues,
      recommendations,
      rawStatus:
        account.status ?? null,
      rawWarmupStatus:
        account.warmup_status ?? null
    };
  }

  analyzeCampaign(campaign = {}) {
    const emailList =
      Array.isArray(campaign.email_list)
        ? campaign.email_list
        : [];

    const protectedAssignments =
      emailList.filter(email =>
        this.isProtectedAccount(email)
      );

    const issues = [];
    const recommendations = [];

    let severity = 'HEALTHY';

    if (protectedAssignments.length > 0) {
      severity = 'CRITICAL';

      issues.push(
        `Protected sending accounts are assigned: ${protectedAssignments.join(', ')}`
      );

      recommendations.push(
        `Remove protected accounts from campaign "${campaign.name || campaign.id}".`
      );
    }

    if (
      campaign.disable_bounce_protect === true
    ) {
      severity =
        severity === 'CRITICAL'
          ? 'CRITICAL'
          : 'WARNING';

      issues.push(
        'Bounce protection is disabled.'
      );

      recommendations.push(
        `Enable bounce protection for campaign "${campaign.name || campaign.id}".`
      );
    }

    if (
      campaign.allow_risky_contacts === true
    ) {
      severity =
        severity === 'CRITICAL'
          ? 'CRITICAL'
          : 'WARNING';

      issues.push(
        'Risky contacts are allowed.'
      );

      recommendations.push(
        `Disable risky contacts for campaign "${campaign.name || campaign.id}".`
      );
    }

    return {
      id:
        campaign.id || null,
      name:
        campaign.name || null,
      severity,
      rawStatus:
        campaign.status ?? null,
      sendingAccounts:
        emailList,
      protectedAssignments,
      dailyLimit:
        campaign.daily_limit ?? null,
      stopOnReply:
        campaign.stop_on_reply ?? null,
      stopOnAutoReply:
        campaign.stop_on_auto_reply ?? null,
      stopForCompany:
        campaign.stop_for_company ?? null,
      openTracking:
        campaign.open_tracking ?? null,
      linkTracking:
        campaign.link_tracking ?? null,
      textOnly:
        campaign.text_only ?? null,
      allowRiskyContacts:
        campaign.allow_risky_contacts ?? null,
      bounceProtectionEnabled:
        campaign.disable_bounce_protect === false,
      issues,
      recommendations
    };
  }

  buildStatusCounts(items, key = 'rawStatus') {
    const counts = {};

    for (const item of items) {
      const value =
        item[key] === null ||
        item[key] === undefined
          ? 'UNKNOWN'
          : String(item[key]);

      counts[value] =
        (counts[value] || 0) + 1;
    }

    return counts;
  }

  buildRecommendations(
    accounts,
    campaigns
  ) {
    const recommendations =
      new Set();

    for (const account of accounts) {
      for (
        const recommendation
        of account.recommendations
      ) {
        recommendations.add(
          recommendation
        );
      }
    }

    for (const campaign of campaigns) {
      for (
        const recommendation
        of campaign.recommendations
      ) {
        recommendations.add(
          recommendation
        );
      }
    }

    const usableAccounts =
      accounts.filter(account =>
        !account.protected &&
        account.accountEnabled &&
        !account.setupPending &&
        account.warmupEnabled &&
        (
          account.warmupScore === null ||
          account.warmupScore >=
            this.warmupWarningScore
        )
      );

    if (usableAccounts.length === 0) {
      recommendations.add(
        'No campaign-safe sending accounts were found. Do not launch new outbound work.'
      );
    }

    const totalDailyCapacity =
      usableAccounts.reduce(
        (total, account) =>
          total +
          Number(account.dailyLimit || 0),
        0
      );

    if (totalDailyCapacity > 0) {
      recommendations.add(
        `Current campaign-safe sending capacity is approximately ${totalDailyCapacity} emails per day before campaign-level restrictions.`
      );
    }

    return [
      ...recommendations
    ];
  }

  calculateOverallStatus(
    accounts,
    campaigns,
    errors
  ) {
    if (errors.length > 0) {
      return 'DEGRADED';
    }

    const criticalCount =
      [
        ...accounts,
        ...campaigns
      ].filter(item =>
        item.severity === 'CRITICAL'
      ).length;

    if (criticalCount > 0) {
      return 'CRITICAL';
    }

    const warningCount =
      [
        ...accounts,
        ...campaigns
      ].filter(item =>
        item.severity === 'WARNING'
      ).length;

    if (warningCount > 0) {
      return 'WARNING';
    }

    return 'HEALTHY';
  }

  async generateSnapshot() {
    const startedAt =
      this.now();

    this.appendEvent(
      'INSTANTLY_COO_SNAPSHOT_STARTED',
      {
        startedAt
      }
    );

    const connectorLoad =
      this.runtime.loadAllConnectors();

    if (
      !connectorLoad.loadedConnectors ||
      !connectorLoad.loadedConnectors.includes(
        'INSTANTLY'
      )
    ) {
      throw new Error(
        'INSTANTLY connector was not loaded by ConnectorRuntime.'
      );
    }

    const errors = [];

    let accountResponse = null;
    let campaignResponse = null;
    let analyticsResponse = null;

    try {
      accountResponse =
        await this.executeInstantly(
          'listAccounts',
          {
            limit:
              this.defaultAccountLimit
          }
        );
    } catch (error) {
      errors.push({
        area: 'ACCOUNTS',
        error: error.message
      });
    }

    try {
      campaignResponse =
        await this.executeInstantly(
          'listCampaigns',
          {
            limit:
              this.defaultCampaignLimit
          }
        );
    } catch (error) {
      errors.push({
        area: 'CAMPAIGNS',
        error: error.message
      });
    }

    try {
      analyticsResponse =
        await this.executeInstantly(
          'getCampaignAnalytics',
          {}
        );
    } catch (error) {
      errors.push({
        area: 'CAMPAIGN_ANALYTICS',
        error: error.message
      });
    }

    const rawAccounts =
      this.resolveItems(
        accountResponse?.accounts
      );

    const rawCampaigns =
      this.resolveItems(
        campaignResponse?.campaigns
      );

    const analyzedAccounts =
      rawAccounts.map(account =>
        this.analyzeAccount(account)
      );

    const analyzedCampaigns =
      rawCampaigns.map(campaign =>
        this.analyzeCampaign(campaign)
      );

    const campaignSafeAccounts =
      analyzedAccounts.filter(account =>
        !account.protected &&
        account.accountEnabled &&
        !account.setupPending &&
        account.warmupEnabled &&
        (
          account.warmupScore === null ||
          account.warmupScore >=
            this.warmupWarningScore
        )
      );

    const totalDailyCapacity =
      campaignSafeAccounts.reduce(
        (total, account) =>
          total +
          Number(account.dailyLimit || 0),
        0
      );

    const warmupScores =
      analyzedAccounts
        .filter(account =>
          !account.protected &&
          account.warmupScore !== null
        )
        .map(account =>
          account.warmupScore
        );

    const averageWarmupScore =
      warmupScores.length > 0
        ? Number(
            (
              warmupScores.reduce(
                (total, score) =>
                  total + score,
                0
              ) /
              warmupScores.length
            ).toFixed(2)
          )
        : null;

    const recommendations =
      this.buildRecommendations(
        analyzedAccounts,
        analyzedCampaigns
      );

    const overallStatus =
      this.calculateOverallStatus(
        analyzedAccounts,
        analyzedCampaigns,
        errors
      );

    const snapshot = {
      ok:
        errors.length === 0,
      service:
        this.service,
      version:
        this.version,
      status:
        overallStatus,
      readOnly:
        true,
      startedAt,
      completedAt:
        this.now(),

      protectionPolicy: {
        protectedDomains: [
          ...this.protectedDomains
        ],
        protectedInboxes: [
          ...this.protectedInboxes
        ]
      },

      summary: {
        totalAccounts:
          analyzedAccounts.length,

        campaignSafeAccounts:
          campaignSafeAccounts.length,

        protectedAccounts:
          analyzedAccounts.filter(
            account =>
              account.protected
          ).length,

        healthyAccounts:
          analyzedAccounts.filter(
            account =>
              account.severity ===
              'HEALTHY'
          ).length,

        warningAccounts:
          analyzedAccounts.filter(
            account =>
              account.severity ===
              'WARNING'
          ).length,

        criticalAccounts:
          analyzedAccounts.filter(
            account =>
              account.severity ===
              'CRITICAL'
          ).length,

        totalCampaigns:
          analyzedCampaigns.length,

        healthyCampaigns:
          analyzedCampaigns.filter(
            campaign =>
              campaign.severity ===
              'HEALTHY'
          ).length,

        warningCampaigns:
          analyzedCampaigns.filter(
            campaign =>
              campaign.severity ===
              'WARNING'
          ).length,

        criticalCampaigns:
          analyzedCampaigns.filter(
            campaign =>
              campaign.severity ===
              'CRITICAL'
          ).length,

        totalDailyCapacity,
        averageWarmupScore,

        lowestWarmupScore:
          warmupScores.length > 0
            ? Math.min(
                ...warmupScores
              )
            : null,

        accountStatusCounts:
          this.buildStatusCounts(
            analyzedAccounts
          ),

        campaignStatusCounts:
          this.buildStatusCounts(
            analyzedCampaigns
          )
      },

      accounts:
        analyzedAccounts,

      campaigns:
        analyzedCampaigns,

      campaignAnalytics:
        analyticsResponse?.analytics ??
        analyticsResponse ??
        null,

      recommendations,
      errors
    };

    const timestamp =
      new Date()
        .toISOString()
        .replace(
          /[:.]/g,
          '-'
        );

    const historicalJsonPath =
      path.join(
        this.reportDir,
        `Instantly_COO_${timestamp}.json`
      );

    const historicalMarkdownPath =
      path.join(
        this.reportDir,
        `Instantly_COO_${timestamp}.md`
      );

    const markdown =
      this.buildMarkdown(snapshot);

    this.atomicWrite(
      this.latestSnapshotPath,
      snapshot
    );

    this.atomicWrite(
      this.latestMarkdownPath,
      markdown
    );

    this.atomicWrite(
      historicalJsonPath,
      snapshot
    );

    this.atomicWrite(
      historicalMarkdownPath,
      markdown
    );

    this.appendEvent(
      'INSTANTLY_COO_SNAPSHOT_COMPLETED',
      {
        status:
          snapshot.status,
        totalAccounts:
          snapshot.summary.totalAccounts,
        totalCampaigns:
          snapshot.summary.totalCampaigns,
        errors:
          snapshot.errors.length
      }
    );

    return snapshot;
  }

  buildMarkdown(snapshot) {
    const accountRows =
      snapshot.accounts.length > 0
        ? snapshot.accounts
            .map(account =>
              `| ${account.email} | ${account.severity} | ${account.protected ? 'YES' : 'NO'} | ${account.warmupScore ?? 'N/A'} | ${account.dailyLimit ?? 'N/A'} |`
            )
            .join('\n')
        : '| None | N/A | N/A | N/A | N/A |';

    const campaignRows =
      snapshot.campaigns.length > 0
        ? snapshot.campaigns
            .map(campaign =>
              `| ${campaign.name || campaign.id || 'Unnamed'} | ${campaign.severity} | ${campaign.rawStatus ?? 'UNKNOWN'} | ${campaign.sendingAccounts.length} | ${campaign.protectedAssignments.length} |`
            )
            .join('\n')
        : '| None | N/A | N/A | N/A | N/A |';

    const recommendationLines =
      snapshot.recommendations.length > 0
        ? snapshot.recommendations
            .map(item =>
              `- ${item}`
            )
            .join('\n')
        : '- No recommendations generated.';

    const errorLines =
      snapshot.errors.length > 0
        ? snapshot.errors
            .map(item =>
              `- ${item.area}: ${item.error}`
            )
            .join('\n')
        : '- None';

    return `# MILES Instantly COO Report

Generated: ${snapshot.completedAt}

## Executive Status

**Overall Status:** ${snapshot.status}

**Read-Only Mode:** YES

| Metric | Value |
|---|---:|
| Total Accounts | ${snapshot.summary.totalAccounts} |
| Campaign-Safe Accounts | ${snapshot.summary.campaignSafeAccounts} |
| Protected Accounts | ${snapshot.summary.protectedAccounts} |
| Healthy Accounts | ${snapshot.summary.healthyAccounts} |
| Warning Accounts | ${snapshot.summary.warningAccounts} |
| Critical Accounts | ${snapshot.summary.criticalAccounts} |
| Total Campaigns | ${snapshot.summary.totalCampaigns} |
| Healthy Campaigns | ${snapshot.summary.healthyCampaigns} |
| Warning Campaigns | ${snapshot.summary.warningCampaigns} |
| Critical Campaigns | ${snapshot.summary.criticalCampaigns} |
| Estimated Daily Capacity | ${snapshot.summary.totalDailyCapacity} |
| Average Warmup Score | ${snapshot.summary.averageWarmupScore ?? 'N/A'} |
| Lowest Warmup Score | ${snapshot.summary.lowestWarmupScore ?? 'N/A'} |

## Protected Assets

Protected domains:

${snapshot.protectionPolicy.protectedDomains
  .map(domain => `- ${domain}`)
  .join('\n')}

Protected inboxes:

${snapshot.protectionPolicy.protectedInboxes
  .map(inbox => `- ${inbox}`)
  .join('\n')}

## Sending Accounts

| Account | Status | Protected | Warmup Score | Daily Limit |
|---|---|---:|---:|---:|
${accountRows}

## Campaigns

| Campaign | Health | Raw Status | Assigned Accounts | Protected Assignments |
|---|---|---:|---:|---:|
${campaignRows}

## Recommendations

${recommendationLines}

## Errors

${errorLines}
`;
  }

  async healthCheck() {
    try {
      const connectorLoad =
        this.runtime.loadAllConnectors();

      const instantlyLoaded =
        Array.isArray(
          connectorLoad.loadedConnectors
        ) &&
        connectorLoad.loadedConnectors.includes(
          'INSTANTLY'
        );

      return {
        ok:
          instantlyLoaded,
        service:
          this.service,
        version:
          this.version,
        status:
          instantlyLoaded
            ? 'HEALTHY'
            : 'DEGRADED',
        instantlyConnectorLoaded:
          instantlyLoaded,
        readOnly:
          true,
        protectedDomains: [
          ...this.protectedDomains
        ],
        protectedInboxes: [
          ...this.protectedInboxes
        ],
        generatedAt:
          this.now()
      };
    } catch (error) {
      return {
        ok: false,
        service:
          this.service,
        version:
          this.version,
        status:
          'DEGRADED',
        error:
          error.message,
        generatedAt:
          this.now()
      };
    }
  }
}

module.exports =
  InstantlyCOOService;

module.exports.InstantlyCOOService =
  InstantlyCOOService;

module.exports.default =
  InstantlyCOOService;
