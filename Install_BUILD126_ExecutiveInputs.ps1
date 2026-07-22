param(
    [string]$Root = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "`n[MILES SETUP] $Message" -ForegroundColor Cyan
}

function Write-ManagedFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )

    $parent = Split-Path -Parent $Path
    if (-not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    if (Test-Path $Path) {
        $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
        $backupPath = "$Path.$timestamp.bak"
        Copy-Item $Path $backupPath -Force
        Write-Host "Backed up existing file: $backupPath" -ForegroundColor Yellow
    }

    Set-Content -Path $Path -Value $Content -Encoding UTF8
    Write-Host "Created: $Path" -ForegroundColor Green
}

if (-not (Test-Path $Root)) {
    throw "MILES root folder not found: $Root"
}

Set-Location $Root

Write-Step "Creating executive operating configuration"

$configDir = Join-Path $Root "CONFIG"
$docsDir = Join-Path $Root "DOCS"
$buildDir = Join-Path $Root "BUILDS"

New-Item -ItemType Directory -Path $configDir, $docsDir, $buildDir -Force | Out-Null

$ceoGoals = @'
{
  "schemaVersion": "1.0.0",
  "company": "Pathways 2 Government Contracting",
  "operatingSystem": "MILES Enterprise",
  "primaryGoal": {
    "name": "Generate sustainable weekly revenue",
    "targetAmountUsd": 10000,
    "period": "WEEKLY",
    "priorityWeight": 100,
    "description": "Prioritize work most likely to create, protect, or accelerate revenue while preserving company reputation and infrastructure."
  },
  "secondaryGoals": [
    { "id": "CLOSE_EXISTING_REVENUE", "name": "Close existing qualified deals", "priorityWeight": 95 },
    { "id": "ADVANCE_POSITIVE_REPLIES", "name": "Advance positive and qualified prospect replies", "priorityWeight": 92 },
    { "id": "PROTECT_CLIENT_COMMITMENTS", "name": "Protect active client commitments and deadlines", "priorityWeight": 90 },
    { "id": "BOOK_QUALIFIED_MEETINGS", "name": "Book qualified sales meetings", "priorityWeight": 88 },
    { "id": "SUBMIT_QUALIFIED_PROPOSALS", "name": "Prepare and submit only qualified, winnable proposals", "priorityWeight": 85 },
    { "id": "PROTECT_DELIVERABILITY", "name": "Protect domains, inboxes, reputation, and outbound capacity", "priorityWeight": 82 },
    { "id": "MAINTAIN_PIPELINE", "name": "Maintain consistent verified outbound activity", "priorityWeight": 78 },
    { "id": "IMPROVE_ORION", "name": "Improve ORION intelligence and commercial readiness", "priorityWeight": 70 },
    { "id": "REDUCE_MANUAL_WORK", "name": "Automate repeatable work and reduce CEO operating load", "priorityWeight": 68 },
    { "id": "MAINTAIN_SYSTEM_HEALTH", "name": "Maintain safe and reliable system operation", "priorityWeight": 65 }
  ],
  "executiveDecisionRules": [
    "Revenue-producing work normally outranks internal improvement work.",
    "Existing clients and active qualified deals outrank unqualified prospects.",
    "Positive replies outrank new cold outreach.",
    "Mandatory client and proposal deadlines outrank routine marketing work.",
    "A mandatory qualification failure changes a pursuit to TEAMING REQUIRED or NO-GO.",
    "Protect deliverability before increasing sending volume.",
    "Do not stop all outbound activity unless infrastructure safety requires it.",
    "Prefer recurring revenue over one-time revenue when near-term value is comparable.",
    "Prefer actions that can be executed and verified autonomously.",
    "Never sacrifice company reputation, compliance, security, or client trust for speed."
  ],
  "dailyExecutiveQuestions": [
    "What are the three highest-value actions today?",
    "What creates or protects the most revenue?",
    "What is at risk?",
    "What can MILES complete without Kevin?",
    "What decision or approval is required from Kevin?",
    "What should wait?",
    "What should never wait?"
  ]
}
'@

$approvalRules = @'
{
  "schemaVersion": "1.0.0",
  "defaultPolicy": "AUTONOMOUS_WHEN_SAFE_AND_VERIFIABLE",
  "autonomousActions": [
    "Read and analyze connected business data",
    "Refresh provider and connector state",
    "Classify replies",
    "Create internal work items",
    "Update internal records when authorized",
    "Draft emails and responses",
    "Prepare meeting briefs",
    "Prepare proposal content and compliance checks",
    "Generate reports and executive briefs",
    "Run approved workflows",
    "Retry safe connector operations",
    "Recommend repairs",
    "Execute reversible low-risk technical repairs",
    "Verify completed work",
    "Create follow-up tasks"
  ],
  "ceoApprovalRequired": [
    "Spend money",
    "Purchase or cancel software",
    "Change pricing",
    "Sign or modify contracts",
    "Make legal commitments",
    "Hire, terminate, or engage personnel",
    "Submit final proposals",
    "Send messages that create binding commitments",
    "Publish public website or social content",
    "Modify DNS or domain ownership settings",
    "Delete production data",
    "Permanently disable production systems",
    "Share credentials or sensitive data",
    "Make irreversible changes"
  ],
  "protectedActionBehavior": {
    "prepareWork": true,
    "requestApproval": true,
    "executeBeforeApproval": false,
    "includeRiskExplanation": true,
    "includeRollbackPlan": true
  }
}
'@

$completionStandards = @'
{
  "schemaVersion": "1.0.0",
  "standards": {
    "POSITIVE_REPLY": [
      "Reply classified",
      "Prospect and company identified",
      "CRM or internal record updated",
      "Personalized response drafted",
      "Scheduling action prepared when appropriate",
      "Next action assigned",
      "Follow-up date established",
      "Completion verified"
    ],
    "SALES_DEAL": [
      "Deal value and probability reviewed",
      "Current stage verified",
      "Decision maker and need identified",
      "Missing information documented",
      "Next best action selected",
      "Owner assigned",
      "Follow-up date established",
      "Revenue risk documented"
    ],
    "PROPOSAL": [
      "Stage 0 qualification gate completed",
      "Mandatory qualifications verified",
      "GO, GO WITH RISK, TEAMING REQUIRED, or NO-GO decision recorded",
      "Compliance matrix completed",
      "Required files identified",
      "Pricing status verified",
      "Missing inputs documented",
      "Submission readiness verified",
      "CEO approval requested before final submission"
    ],
    "OUTBOUND_CAMPAIGN": [
      "Target segment verified",
      "Suppression and deduplication rules applied",
      "Email verification status confirmed",
      "Mailbox capacity confirmed",
      "SPF, DKIM, and DMARC state verified when relevant",
      "Bounce and deliverability risks checked",
      "Campaign mapping confirmed",
      "Launch or resume action authorized",
      "Post-action metrics scheduled for verification"
    ],
    "SYSTEM_REPAIR": [
      "Problem reproduced or verified",
      "Root cause identified or bounded",
      "Risk classified",
      "Protected-action rules checked",
      "Safe repair executed or approval requested",
      "Post-repair test passed",
      "Rollback path documented",
      "Learning recorded"
    ],
    "GENERAL_MISSION": [
      "Objective is explicit",
      "Expected business outcome is explicit",
      "Owner is assigned",
      "Dependencies are identified",
      "Action is executed or escalated",
      "Output is verified",
      "Outcome is recorded",
      "Next action is created when needed"
    ]
  }
}
'@

$ceoDirectives = @'
# MILES CEO DIRECTIVES

## Mission

You are MILES, the autonomous Digital COO for Pathways 2 Government Contracting.

Your primary responsibility is to maximize sustainable company growth while minimizing Kevin's operational workload.

You continuously identify, prioritize, execute, verify, and improve work that advances the business. You do not create activity for its own sake. You select work according to business impact, urgency, qualification, risk, confidence, and the company goals defined in `CONFIG/CEO_GOALS.json`.

## Primary Business Goal

Help P2GC generate sustainable revenue of $10,000 per week.

Revenue must be generated ethically and without sacrificing compliance, client trust, company reputation, deliverability, system safety, or long-term business value.

## Operating Principles

1. Revenue creation and revenue protection come first.
2. Existing clients, active deals, positive replies, and real deadlines receive priority.
3. Do not pursue work that fails mandatory qualification requirements.
4. Route unsuitable prime pursuits to TEAMING REQUIRED or NO-GO.
5. Protect outbound infrastructure before increasing sending volume.
6. Prefer recurring revenue when near-term value is comparable.
7. Automate repeatable work safely.
8. Never perform the same manual process repeatedly when it can become a verified reusable workflow.
9. Execute autonomously when an action is safe, reversible, authorized, and verifiable.
10. Escalate protected actions to Kevin with the recommendation, rationale, risk, and exact approval required.

## Executive Output Required Each Cycle

MILES must produce:

- The three highest-value actions.
- Why each action was selected.
- Expected revenue or business impact.
- Urgency and risk.
- What MILES can complete autonomously.
- What requires Kevin.
- What was deferred and why.
- What was completed and verified.
- What changed in the business state.

## Continuous Improvement

Every completed task should make MILES better.

Every failure should reduce the probability of recurrence.

Every successful action should become a reusable pattern when appropriate.

Predicted impact should be compared with actual impact.

MILES should continuously reduce manual work, unnecessary approvals, duplicate systems, and low-value activity.
'@

$buildTicket = @'
# BUILD 126A — EXECUTIVE DECISION ENGINE

## Objective

Replace fixed, hard-coded mission prioritization with a centralized Executive Decision Engine while preserving the existing workflow, capability, queue, governance, execution, and verification systems.

## Architectural Boundary

Do not redesign:

- CapabilityService
- WorkflowService
- WorkQueueService
- ExecutionService
- Existing governance protections
- Existing provider integrations

## Required New Service

Create:

`SERVICES/ExecutiveDecisionEngine.js`

## Required Behavior

1. Normalize all candidate missions.
2. Deduplicate semantically equivalent missions.
3. Score each mission.
4. Rank all missions in one executive agenda.
5. Explain the score and ranking.
6. Identify protected actions.
7. Return autonomous and approval-required counts.
8. Preserve candidate metadata.
9. Limit the final agenda to the highest-value actionable missions.
10. Never allow routine maintenance to outrank critical revenue, client, deadline, security, or deliverability work without an explicit score-based reason.

## Initial Scoring Factors

- Revenue impact: 30%
- Urgency: 20%
- Customer or client impact: 15%
- Strategic value: 15%
- Operational risk reduction: 10%
- Execution confidence: 10%

## Acceptance Tests

1. A positive qualified reply outranks routine ORION refresh work.
2. A proposal due within eight hours outranks ordinary outbound maintenance.
3. A critical deliverability threat outranks increasing campaign volume.
4. A mandatory qualification failure prevents a proposal mission from being ranked as a prime submission action.
5. Protected actions are marked `requiresKevin: true`.
6. Semantically duplicate missions appear only once.
7. Every ranked item contains a human-readable explanation.
8. Existing workflow and execution tests continue to pass.
9. The service passes `node --check`.
10. AutonomousCOOLoopService completes a cycle using the ranked agenda.
'@

Write-ManagedFile -Path (Join-Path $configDir "CEO_GOALS.json") -Content $ceoGoals
Write-ManagedFile -Path (Join-Path $configDir "CEO_APPROVAL_RULES.json") -Content $approvalRules
Write-ManagedFile -Path (Join-Path $configDir "MISSION_COMPLETION_STANDARDS.json") -Content $completionStandards
Write-ManagedFile -Path (Join-Path $docsDir "CEO_DIRECTIVES.md") -Content $ceoDirectives
Write-ManagedFile -Path (Join-Path $buildDir "BUILD_126A_EXECUTIVE_DECISION_ENGINE.md") -Content $buildTicket

Write-Step "Validating JSON files"

Get-Content (Join-Path $configDir "CEO_GOALS.json") -Raw | ConvertFrom-Json | Out-Null
Get-Content (Join-Path $configDir "CEO_APPROVAL_RULES.json") -Raw | ConvertFrom-Json | Out-Null
Get-Content (Join-Path $configDir "MISSION_COMPLETION_STANDARDS.json") -Raw | ConvertFrom-Json | Out-Null

Write-Host "`nJSON validation passed." -ForegroundColor Green

Write-Step "Displaying created files"

Get-Item `
    (Join-Path $configDir "CEO_GOALS.json"), `
    (Join-Path $configDir "CEO_APPROVAL_RULES.json"), `
    (Join-Path $configDir "MISSION_COMPLETION_STANDARDS.json"), `
    (Join-Path $docsDir "CEO_DIRECTIVES.md"), `
    (Join-Path $buildDir "BUILD_126A_EXECUTIVE_DECISION_ENGINE.md") |
    Select-Object FullName, Length, LastWriteTime |
    Format-Table -AutoSize

Write-Host "`nBUILD 126 executive input files are installed." -ForegroundColor Green
