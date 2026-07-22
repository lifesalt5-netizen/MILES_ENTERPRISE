$ErrorActionPreference = 'Stop'

$Root = 'D:\P2GC_Intelligence\MILES_ENTERPRISE'
$Services = Join-Path $Root 'SERVICES'
$LoopFile = Join-Path $Services 'AutonomousCOOLoopService.js'
$RevenueFile = Join-Path $Services 'RevenueCOOService.js'
$Stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$Backup = Join-Path $Root "_BACKUPS\BUILD042_$Stamp"

if (!(Test-Path $LoopFile)) { throw "Missing authoritative loop: $LoopFile" }
New-Item -ItemType Directory -Force -Path $Backup | Out-Null
Copy-Item $LoopFile (Join-Path $Backup 'AutonomousCOOLoopService.js') -Force
if (Test-Path $RevenueFile) { Copy-Item $RevenueFile (Join-Path $Backup 'RevenueCOOService.js') -Force }

$RevenueSource = @'
"use strict";

function now() {
  return new Date().toISOString();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function statusText(value) {
  return String(value || "").trim().toLowerCase();
}

class RevenueCOOService {
  constructor(options = {}) {
    this.bounceWarningRate = number(options.bounceWarningRate, 0.03);
    this.minimumActiveCampaigns = number(options.minimumActiveCampaigns, 2);
  }

  analyze(executiveState = {}, cycleId = null) {
    const business = executiveState.business || {};
    const marketing = executiveState.marketing || {};
    const campaigns = Array.isArray(business.campaigns) ? business.campaigns : [];
    const replies = Array.isArray(business.replies) ? business.replies : [];
    const deals = Array.isArray(business.deals) ? business.deals : [];
    const mailboxes = Array.isArray(business.mailboxes)
      ? business.mailboxes
      : Array.isArray(marketing.mailboxes)
        ? marketing.mailboxes
        : [];
    const segments = Array.isArray(business.segments)
      ? business.segments
      : Array.isArray(marketing.segments)
        ? marketing.segments
        : [];

    const activeCampaigns = campaigns.filter(c =>
      /active|running|enabled|launched/.test(statusText(c.status))
    );
    const pausedCampaigns = campaigns.filter(c =>
      /paused|stopped|disabled|error|failed/.test(statusText(c.status))
    );
    const positiveReplies = replies.filter(r =>
      /positive|interested|meeting|booked|qualified/.test(
        statusText(r.classification || r.category || r.status || r.intent)
      )
    );
    const unclassifiedReplies = replies.filter(r =>
      !String(r.classification || r.category || r.intent || "").trim()
    );
    const unhealthyMailboxes = mailboxes.filter(m =>
      /warning|critical|failed|disconnected|paused|unhealthy/.test(
        statusText(m.health || m.status)
      )
    );
    const depletedSegments = segments.filter(s => {
      const remaining = number(
        s.verifiedRemaining ?? s.remaining ?? s.availableLeads ?? s.leadsRemaining,
        -1
      );
      return remaining === 0 || /depleted|exhausted|complete/.test(statusText(s.status));
    });

    const totalSent = campaigns.reduce(
      (sum, c) => sum + number(c.sent ?? c.emailsSent ?? c.totalSent),
      0
    );
    const totalBounces = campaigns.reduce(
      (sum, c) => sum + number(c.bounces ?? c.bounced ?? c.totalBounces),
      0
    );
    const bounceRate = totalSent > 0 ? totalBounces / totalSent : 0;

    const missions = [];

    if (unclassifiedReplies.length > 0) {
      missions.push({
        priority: 1,
        area: "Revenue Operations",
        title: `Classify ${unclassifiedReplies.length} unclassified outbound repl${unclassifiedReplies.length === 1 ? "y" : "ies"}`,
        objective: "Classify Instantly replies and create the correct follow-up actions",
        reason: `${unclassifiedReplies.length} reply record(s) do not have a usable classification.`,
        recommendedAction: "Classify each reply as Positive, Neutral, Negative, or Technical; create follow-up work for positive and neutral replies.",
        expectedImpact: "Protects response speed and prevents qualified prospects from being lost.",
        requiresKevin: false,
        relatedProvider: "MarketingProvider"
      });
    }

    if (positiveReplies.length > 0) {
      missions.push({
        priority: 1,
        area: "Revenue Operations",
        title: `Advance ${positiveReplies.length} positive outbound repl${positiveReplies.length === 1 ? "y" : "ies"}`,
        objective: "Create immediate next actions for positive Instantly replies",
        reason: `${positiveReplies.length} positive or meeting-intent reply record(s) are present.`,
        recommendedAction: "Prepare personalized responses, scheduling actions, CRM updates, and CEO approval only for protected commitments.",
        expectedImpact: "Moves active prospects toward scheduled calls and revenue.",
        requiresKevin: false,
        relatedProvider: "MarketingProvider"
      });
    }

    if (bounceRate >= this.bounceWarningRate) {
      missions.push({
        priority: 1,
        area: "Revenue Operations",
        title: "Protect outbound deliverability",
        objective: "Audit Instantly bounce risk and stop unsafe sending conditions",
        reason: `Observed aggregate bounce rate is ${(bounceRate * 100).toFixed(2)}%.`,
        recommendedAction: "Audit campaign-level bounces, isolate the affected list or inboxes, and prepare a safe remediation action before additional sending.",
        expectedImpact: "Protects sending domains and inbox reputation.",
        requiresKevin: false,
        relatedProvider: "MarketingProvider"
      });
    }

    if (unhealthyMailboxes.length > 0) {
      missions.push({
        priority: 1,
        area: "Revenue Operations",
        title: `Repair ${unhealthyMailboxes.length} unhealthy outbound mailbox${unhealthyMailboxes.length === 1 ? "" : "es"}`,
        objective: "Restore safe Instantly mailbox capacity",
        reason: `${unhealthyMailboxes.length} mailbox record(s) show a warning or failed state.`,
        recommendedAction: "Audit authentication, connection, warmup, sending limits, and recent bounce behavior; auto-repair safe settings and escalate credential or purchasing needs.",
        expectedImpact: "Restores outbound capacity without risking infrastructure.",
        requiresKevin: false,
        relatedProvider: "MarketingProvider"
      });
    }

    if (campaigns.length > 0 && activeCampaigns.length < this.minimumActiveCampaigns) {
      missions.push({
        priority: 2,
        area: "Revenue Operations",
        title: "Restore minimum outbound campaign coverage",
        objective: "Audit paused Instantly campaigns and prepare the next safe campaign action",
        reason: `Only ${activeCampaigns.length} active campaign(s) were detected from ${campaigns.length} total campaign(s).`,
        recommendedAction: "Determine whether paused campaigns can safely resume and identify the next verified segment and available inbox capacity.",
        expectedImpact: "Maintains consistent lead generation and pipeline creation.",
        requiresKevin: false,
        relatedProvider: "MarketingProvider"
      });
    }

    if (depletedSegments.length > 0) {
      missions.push({
        priority: 2,
        area: "Revenue Operations",
        title: `Replace ${depletedSegments.length} depleted outbound segment${depletedSegments.length === 1 ? "" : "s"}`,
        objective: "Select and prepare the next verified outreach segment",
        reason: `${depletedSegments.length} segment record(s) appear depleted or exhausted.`,
        recommendedAction: "Select the next eligible verified segment, confirm deduplication and suppression rules, then prepare upload and campaign mapping.",
        expectedImpact: "Prevents campaign downtime and keeps outbound capacity productive.",
        requiresKevin: false,
        relatedProvider: "MarketingProvider"
      });
    }

    if (campaigns.length === 0) {
      missions.push({
        priority: 2,
        area: "Revenue Operations",
        title: "Establish live outbound campaign visibility",
        objective: "Refresh Instantly campaigns, inboxes, segments, and reply state",
        reason: "No campaign records are available in the current executive business state.",
        recommendedAction: "Use the Instantly connector to refresh live campaign, mailbox, reply, and capacity metrics before planning outbound actions.",
        expectedImpact: "Gives MILES the live state required to operate outbound autonomously.",
        requiresKevin: false,
        relatedProvider: "MarketingProvider"
      });
    }

    return {
      ok: true,
      type: "REVENUE_COO_ANALYSIS",
      generatedAt: now(),
      cycleId,
      metrics: {
        campaignsTotal: campaigns.length,
        campaignsActive: activeCampaigns.length,
        campaignsPausedOrFailed: pausedCampaigns.length,
        repliesTotal: replies.length,
        repliesPositive: positiveReplies.length,
        repliesUnclassified: unclassifiedReplies.length,
        dealsTotal: deals.length,
        mailboxesTotal: mailboxes.length,
        mailboxesUnhealthy: unhealthyMailboxes.length,
        segmentsTotal: segments.length,
        segmentsDepleted: depletedSegments.length,
        sentObserved: totalSent,
        bouncesObserved: totalBounces,
        bounceRate
      },
      missions,
      requiresKevin: false
    };
  }
}

module.exports = RevenueCOOService;
'@

Set-Content -Path $RevenueFile -Value $RevenueSource -Encoding UTF8

$Source = Get-Content $LoopFile -Raw

if ($Source -notmatch 'RevenueCOOService') {
  $Needle = 'const BusinessOperationsBridgeService = require("./BusinessOperationsBridgeService");'
  $Replacement = $Needle + "`r`nconst RevenueCOOService = require(\"./RevenueCOOService\");"
  if (!$Source.Contains($Needle)) { throw 'Could not locate require insertion point.' }
  $Source = $Source.Replace($Needle, $Replacement)
}

if ($Source -notmatch 'this\.revenueCOO') {
  $Needle = @'
    this.executionService = options.executionService || null;
'@
  $Replacement = @'
    this.executionService = options.executionService || null;
    this.revenueCOO = options.revenueCOO || new RevenueCOOService();
'@
  if (!$Source.Contains($Needle.TrimStart("`n"))) { throw 'Could not locate constructor insertion point.' }
  $Source = $Source.Replace($Needle.TrimStart("`n"), $Replacement.TrimStart("`n"))
}

if ($Source -notmatch 'const revenueOperations = this\.revenueCOO\.analyze') {
  $Needle = '    const executiveState = await this.intelligence.getExecutiveState();'
  $Replacement = $Needle + "`r`n    const revenueOperations = this.revenueCOO.analyze(executiveState, cycleId);"
  if (!$Source.Contains($Needle)) { throw 'Could not locate executive state insertion point.' }
  $Source = $Source.Replace($Needle, $Replacement)
}

$Source = $Source.Replace(
  'const mission = this.buildMissionPlan(executiveState, health, cycleId);',
  'const mission = this.buildMissionPlan(executiveState, health, cycleId, revenueOperations);'
)

if ($Source -notmatch 'revenueOperations,\s*\r?\n\s*executiveDispatch') {
  $Needle = '      businessOperationsBridge: bridgeResults,'
  $Replacement = $Needle + "`r`n      revenueOperations,"
  if (!$Source.Contains($Needle)) { throw 'Could not locate result insertion point.' }
  $Source = $Source.Replace($Needle, $Replacement)
}

$Source = $Source.Replace(
  'buildMissionPlan(executiveState = {}, health = {}, cycleId = null) {',
  'buildMissionPlan(executiveState = {}, health = {}, cycleId = null, revenueOperations = {}) {'
)

if ($Source -notmatch 'Revenue COO missions are generated') {
  $Needle = '    const orion = executiveState.orion || {'
  $Insert = @'
    // Revenue COO missions are generated by a domain service and executed through
    // the existing WorkQueue -> WorkflowService -> ExecutionService pipeline.
    for (const revenueMission of revenueOperations.missions || []) {
      priorities.push(
        this.missionItem({
          ...revenueMission,
          metadata: {
            ...(revenueMission.metadata || {}),
            revenueMetrics: revenueOperations.metrics || {},
            cycleId
          }
        })
      );
    }

'@
  $Index = $Source.IndexOf($Needle)
  if ($Index -lt 0) { throw 'Could not locate mission insertion point.' }
  $Source = $Source.Insert($Index, $Insert)
}

Set-Content -Path $LoopFile -Value $Source -Encoding UTF8

Write-Host '[BUILD042] Running syntax checks...'
& node --check $RevenueFile
if ($LASTEXITCODE -ne 0) { throw 'RevenueCOOService syntax validation failed.' }
& node --check $LoopFile
if ($LASTEXITCODE -ne 0) { throw 'AutonomousCOOLoopService syntax validation failed. Backup retained.' }

$TestFile = Join-Path $Root 'TESTS\Test_Build042_RevenueCOO.js'
$TestSource = @'
"use strict";

const assert = require("assert");
const RevenueCOOService = require("../SERVICES/RevenueCOOService");

const service = new RevenueCOOService();
const result = service.analyze({
  business: {
    campaigns: [
      { status: "paused", sent: 1000, bounces: 45 }
    ],
    replies: [
      { classification: "Positive" },
      { subject: "Interested" }
    ],
    mailboxes: [
      { email: "test@example.com", health: "warning" }
    ],
    segments: [
      { name: "GSA No Sales", verifiedRemaining: 0 }
    ]
  }
}, "TEST-CYCLE");

assert.strictEqual(result.ok, true);
assert(result.metrics.bounceRate >= 0.04);
assert(result.missions.length >= 5);
assert(result.missions.every(item => item.requiresKevin === false));

console.log("BUILD042 Revenue COO test PASSED");
console.log(JSON.stringify(result, null, 2));
'@
New-Item -ItemType Directory -Force -Path (Split-Path $TestFile -Parent) | Out-Null
Set-Content -Path $TestFile -Value $TestSource -Encoding UTF8
& node $TestFile
if ($LASTEXITCODE -ne 0) { throw 'BUILD042 Revenue COO test failed.' }

Write-Host ''
Write-Host 'BUILD042 INSTALLED AND VALIDATED' -ForegroundColor Green
Write-Host "Backup: $Backup"
Write-Host 'Next production validation commands:'
Write-Host '  taskkill /F /IM node.exe'
Write-Host '  node StartMilesProduction.js'
