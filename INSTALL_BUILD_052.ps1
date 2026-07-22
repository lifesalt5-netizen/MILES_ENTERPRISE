param(
    [string]$Root = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"
Set-Location $Root

$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupRoot = Join-Path $Root "BACKUPS\BUILD052_$Stamp"

function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $Dir = Split-Path -Parent $Path
    if ($Dir -and -not (Test-Path $Dir)) {
        New-Item -ItemType Directory -Force -Path $Dir | Out-Null
    }
    [System.IO.File]::WriteAllText(
        $Path,
        $Content,
        [System.Text.UTF8Encoding]::new($false)
    )
}

function Backup-File {
    param([string]$RelativePath)
    $Source = Join-Path $Root $RelativePath
    if (Test-Path $Source) {
        $Destination = Join-Path $BackupRoot $RelativePath
        $DestinationDir = Split-Path -Parent $Destination
        New-Item -ItemType Directory -Force -Path $DestinationDir | Out-Null
        Copy-Item $Source $Destination -Force
    }
}

function Patch-File {
    param(
        [string]$RelativePath,
        [string]$Anchor,
        [string]$Replacement,
        [string]$PatchName
    )

    $Path = Join-Path $Root $RelativePath
    if (-not (Test-Path $Path)) {
        throw "BUILD 052 missing required file: $RelativePath"
    }

    $Text = [System.IO.File]::ReadAllText($Path)

    if ($Text.Contains($Replacement)) {
        Write-Host "Already patched: $PatchName" -ForegroundColor DarkYellow
        return
    }

    if (-not $Text.Contains($Anchor)) {
        throw "BUILD 052 patch anchor not found for $PatchName in $RelativePath"
    }

    Backup-File $RelativePath
    $Text = $Text.Replace($Anchor, $Replacement)
    Write-Utf8NoBom -Path $Path -Content $Text
    Write-Host "Patched: $PatchName" -ForegroundColor Green
}

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "GOVERNANCE") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "SERVICES\governance") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "DATA\governance_audit") | Out-Null

Write-Host ""
Write-Host "Installing MILES Enterprise BUILD 052..." -ForegroundColor Cyan
Write-Host "Backup: $BackupRoot" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# GOVERNANCE DOCUMENTS
# ---------------------------------------------------------------------------

Write-Utf8NoBom (Join-Path $Root "GOVERNANCE\CONSTITUTION.md") @'
# MILES Enterprise Constitution v1.0

MILES operates under CEO authority and may not bypass enterprise governance.

Every executable action must be:
1. Classified against policy.
2. Checked for authority and risk.
3. Routed through an approval gate when required.
4. Enforced by the Constitutional Guardian.
5. Verified after execution.
6. Written to an explainable audit trail.

Protected principles:
- CEO authority
- Revenue first
- Client success
- Demo protection
- Data protection
- Brand protection
- Financial controls
- Explainable decisions
- One source of truth
- Continuous intelligence
- Continuous learning

No AI twin, connector, provider, workflow, browser operator, or direct runtime caller may bypass governance.
'@

Write-Utf8NoBom (Join-Path $Root "GOVERNANCE\FOUNDING_CHARTER.md") @'
# MILES Enterprise Founding Charter

MILES is the Digital COO of Pathways 2 Government Contracting.

MILES may autonomously analyze, verify, organize, recommend, monitor, and execute
low-risk reversible work within granted authority.

CEO approval is required for protected external communications, financial
commitments, destructive actions, production publishing, credential changes,
domain or DNS changes, client-facing submissions, and other protected actions.

The CEO remains the final authority.
'@

Write-Utf8NoBom (Join-Path $Root "GOVERNANCE\ENTERPRISE_DOCTRINE.md") @'
# MILES Enterprise Doctrine

ORION is the living intelligence platform.
MILES is the governed operating system and Digital COO.
Department Executive Twins are specialized decision and execution agents.

All enterprise actors share:
- one source of truth
- current and attributable evidence
- role and entitlement controls
- approval gates
- verification
- immutable governance auditing
'@

Write-Utf8NoBom (Join-Path $Root "GOVERNANCE\constitution.json") @'
{
  "version": "1.0.0",
  "enterprise": "MILES Enterprise",
  "effectiveDate": "2026-07-16",
  "defaultDecision": "ALLOW",
  "defaultRole": "MILES",
  "principles": {
    "constitutionRequired": true,
    "auditRequired": true,
    "authorityRequired": true,
    "approvalRequiredWhenProtected": true,
    "roleBasedAccess": true,
    "entitlementAwareAccess": true,
    "explainableDecisions": true,
    "demoProtection": true,
    "verificationRequired": true,
    "noBypass": true
  },
  "riskLevels": ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
  "decisions": ["ALLOW", "DENY", "REQUIRE_APPROVAL"]
}
'@

Write-Utf8NoBom (Join-Path $Root "GOVERNANCE\approval_matrix.json") @'
{
  "version": "1.0.0",
  "defaultApprover": "CEO",
  "autonomousPatterns": [
    "READ", "LIST", "GET", "STATUS", "HEALTH", "VERIFY", "ANALYZE",
    "AUDIT", "REPORT", "DISCOVER", "SCORE", "REFRESH", "SYNC",
    "RECOMMEND", "PLAN", "TEST"
  ],
  "approvalPatterns": [
    "SEND", "PUBLISH", "POST", "SUBMIT", "DELETE", "REMOVE", "PURCHASE",
    "BUY", "SPEND", "PAY", "CANCEL", "DNS", "DOMAIN", "CREDENTIAL",
    "PASSWORD", "DEPLOY", "PRODUCTION", "LAUNCH", "RESUME", "PAUSE",
    "UPLOAD", "WRITE", "MODIFY", "UPDATE", "CREATE", "FORWARD", "REPLY",
    "CONTROLLED_WRITE", "FINANCIAL_COMMITMENT", "CLIENT_SUBMISSION"
  ],
  "neverAllowedPatterns": [
    "BYPASS_GOVERNANCE",
    "DISABLE_GOVERNANCE",
    "DELETE_AUDIT_LOG",
    "EXPOSE_OTHER_CLIENT_DATA",
    "EXPOSE_INTERNAL_ALGORITHM"
  ],
  "protectedAssets": {
    "pathways2gc.com": {
      "outboundUse": "DENY",
      "reason": "Primary company/admin domain is protected from outbound campaign use."
    }
  }
}
'@

Write-Utf8NoBom (Join-Path $Root "GOVERNANCE\data_access_policy.json") @'
{
  "version": "1.0.0",
  "defaultClassification": "INTERNAL",
  "roles": {
    "CEO": ["PUBLIC", "DEMO", "CLIENT_LICENSED", "CLIENT_PRIVATE", "INTERNAL", "CONFIDENTIAL", "ENTERPRISE_INTELLIGENCE"],
    "MILES": ["PUBLIC", "CLIENT_LICENSED", "CLIENT_PRIVATE", "INTERNAL", "CONFIDENTIAL", "ENTERPRISE_INTELLIGENCE"],
    "EXECUTIVE_TWIN": ["PUBLIC", "CLIENT_LICENSED", "CLIENT_PRIVATE", "INTERNAL", "ENTERPRISE_INTELLIGENCE"],
    "CLIENT": ["PUBLIC", "CLIENT_LICENSED", "CLIENT_PRIVATE"],
    "DEMO": ["PUBLIC", "DEMO"]
  },
  "providers": {
    "ORION": "ENTERPRISE_INTELLIGENCE",
    "ORIONPROVIDER": "ENTERPRISE_INTELLIGENCE",
    "SALESPROVIDER": "CLIENT_PRIVATE",
    "MARKETINGPROVIDER": "CONFIDENTIAL",
    "GOOGLEWORKSPACEPROVIDER": "CONFIDENTIAL",
    "WEBSITEPROVIDER": "INTERNAL",
    "MILES": "INTERNAL"
  },
  "clientIsolationRequired": true,
  "entitlementRequiredForPremiumIntelligence": true
}
'@

Write-Utf8NoBom (Join-Path $Root "GOVERNANCE\demo_access_policy.json") @'
{
  "version": "1.0.0",
  "demoModeEnvironmentVariable": "MILES_DEMO_MODE",
  "denyImplementationDetails": true,
  "denyInternalArchitecture": true,
  "denyAdminTools": true,
  "denyDebugPanels": true,
  "denyRawEnterpriseData": true,
  "denyOtherClientData": true,
  "denyUnlicensedPremiumIntelligence": true,
  "blockedPatterns": [
    "DEBUG", "STACK_TRACE", "RAW_SQL", "SCHEMA_DUMP", "ADMIN",
    "INTERNAL_ARCHITECTURE", "ALGORITHM", "SOURCE_CODE", "CREDENTIAL"
  ]
}
'@

# ---------------------------------------------------------------------------
# GOVERNANCE SERVICES
# ---------------------------------------------------------------------------

Write-Utf8NoBom (Join-Path $Root "SERVICES\governance\GovernanceAuditService.js") @'
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..", "..");

const AUDIT_DIR = path.join(
  ROOT,
  "DATA",
  "governance_audit"
);

function ensureDir() {
  fs.mkdirSync(AUDIT_DIR, {
    recursive: true
  });
}

function safe(value) {
  try {
    return JSON.parse(
      JSON.stringify(value)
    );
  } catch {
    return {
      unserializable: true,
      value: String(value)
    };
  }
}

class GovernanceAuditService {
  record(eventType, details = {}) {
    ensureDir();

    const timestamp =
      new Date().toISOString();

    const record = {
      auditId:
        crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}_${Math.random()
              .toString(16)
              .slice(2)}`,
      eventType,
      timestamp,
      constitutionVersion:
        details.constitutionVersion ||
        details.policy?.constitutionVersion ||
        "1.0.0",
      policyVersion:
        details.policyVersion ||
        details.policy?.policyVersion ||
        "1.0.0",
      taskId:
        details.taskId ||
        details.task?.id ||
        null,
      actor:
        details.actor ||
        details.context?.actor ||
        "MILES",
      role:
        details.role ||
        details.context?.role ||
        "MILES",
      decision:
        details.decision ||
        details.policy?.decision ||
        null,
      reason:
        details.reason ||
        details.policy?.reason ||
        null,
      details:
        safe(details)
    };

    const day =
      timestamp.slice(0, 10);

    const file =
      path.join(
        AUDIT_DIR,
        `governance_${day}.jsonl`
      );

    fs.appendFileSync(
      file,
      `${JSON.stringify(record)}\n`,
      "utf8"
    );

    return record;
  }

  policyDecision(task, policy) {
    return this.record(
      "POLICY_DECISION",
      {
        task,
        policy,
        decision: policy.decision,
        reason: policy.reason
      }
    );
  }

  guardianDecision(task, guardian) {
    return this.record(
      "GUARDIAN_DECISION",
      {
        task,
        guardian,
        decision:
          guardian.allowed
            ? "ALLOW"
            : "DENY",
        reason: guardian.reason
      }
    );
  }

  executionResult(task, result) {
    return this.record(
      "EXECUTION_RESULT",
      {
        taskId: task?.id || null,
        task,
        result,
        decision:
          result?.ok
            ? "EXECUTED"
            : "FAILED",
        reason:
          result?.status ||
          result?.error ||
          null
      }
    );
  }
}

module.exports =
  new GovernanceAuditService();
'@

Write-Utf8NoBom (Join-Path $Root "SERVICES\governance\DataAccessPolicyService.js") @'
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..", "..");

const POLICY_FILE =
  path.join(
    ROOT,
    "GOVERNANCE",
    "data_access_policy.json"
  );

function load() {
  return JSON.parse(
    fs.readFileSync(
      POLICY_FILE,
      "utf8"
    )
  );
}

class DataAccessPolicyService {
  evaluate(input = {}) {
    const policy = load();

    const task =
      input.task ||
      input;

    const payload =
      task.payload ||
      {};

    const role =
      String(
        input.role ||
        payload.role ||
        task.role ||
        process.env.MILES_ACTOR_ROLE ||
        "MILES"
      ).toUpperCase();

    const provider =
      String(
        input.provider ||
        payload.provider ||
        task.provider ||
        "MILES"
      ).toUpperCase();

    const classification =
      String(
        input.classification ||
        payload.dataClassification ||
        task.dataClassification ||
        policy.providers[provider] ||
        policy.defaultClassification
      ).toUpperCase();

    const grants =
      policy.roles[role] || [];

    const roleAllowed =
      grants.includes(classification);

    const entitlementRequired =
      classification ===
        "CLIENT_LICENSED" ||
      (
        classification ===
          "ENTERPRISE_INTELLIGENCE" &&
        role === "CLIENT"
      );

    const entitled =
      !entitlementRequired ||
      Boolean(
        input.entitled ||
        payload.entitled ||
        task.entitled
      );

    const clientId =
      input.clientId ||
      payload.clientId ||
      task.clientId ||
      null;

    const requestedClientId =
      input.requestedClientId ||
      payload.requestedClientId ||
      task.requestedClientId ||
      clientId;

    const clientIsolated =
      role !== "CLIENT" ||
      !clientId ||
      clientId === requestedClientId;

    const allowed =
      roleAllowed &&
      entitled &&
      clientIsolated;

    return {
      allowed,
      role,
      provider,
      classification,
      roleAllowed,
      entitlementRequired,
      entitled,
      clientIsolated,
      reason:
        !roleAllowed
          ? `Role ${role} may not access ${classification}.`
          : !entitled
            ? "Required data entitlement is missing."
            : !clientIsolated
              ? "Client isolation policy blocked cross-client access."
              : "Data access policy satisfied.",
      policyVersion:
        policy.version
    };
  }
}

module.exports =
  new DataAccessPolicyService();
'@

Write-Utf8NoBom (Join-Path $Root "SERVICES\governance\DemoProtectionService.js") @'
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..", "..");

const POLICY_FILE =
  path.join(
    ROOT,
    "GOVERNANCE",
    "demo_access_policy.json"
  );

function load() {
  return JSON.parse(
    fs.readFileSync(
      POLICY_FILE,
      "utf8"
    )
  );
}

function textOf(input = {}) {
  const task =
    input.task ||
    input;

  const payload =
    task.payload ||
    {};

  return [
    task.type,
    task.action,
    task.intent,
    task.workflow,
    payload.action,
    payload.capability,
    payload.objective,
    payload.command,
    payload.requestedView
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
}

class DemoProtectionService {
  isDemo(input = {}) {
    const task =
      input.task ||
      input;

    const payload =
      task.payload ||
      {};

    return (
      input.demoMode === true ||
      task.demoMode === true ||
      payload.demoMode === true ||
      String(
        process.env.MILES_DEMO_MODE ||
        ""
      ).toLowerCase() === "true"
    );
  }

  evaluate(input = {}) {
    const policy = load();
    const demoMode =
      this.isDemo(input);

    if (!demoMode) {
      return {
        allowed: true,
        demoMode: false,
        reason:
          "Demo protection not active.",
        policyVersion:
          policy.version
      };
    }

    const text =
      textOf(input);

    const blockedPattern =
      policy.blockedPatterns
        .find(pattern =>
          text.includes(
            String(pattern)
              .toUpperCase()
          )
        ) || null;

    return {
      allowed:
        !blockedPattern,
      demoMode: true,
      blockedPattern,
      redactImplementationDetails: true,
      redactRawEnterpriseData: true,
      reason:
        blockedPattern
          ? `Demo policy blocked protected detail: ${blockedPattern}.`
          : "Demo-safe request.",
      policyVersion:
        policy.version
    };
  }
}

module.exports =
  new DemoProtectionService();
'@

Write-Utf8NoBom (Join-Path $Root "SERVICES\governance\PolicyEngineService.js") @'
"use strict";

const fs = require("fs");
const path = require("path");

const dataAccess =
  require("./DataAccessPolicyService");
const demoProtection =
  require("./DemoProtectionService");
const audit =
  require("./GovernanceAuditService");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..", "..");

function readJson(name) {
  return JSON.parse(
    fs.readFileSync(
      path.join(
        ROOT,
        "GOVERNANCE",
        name
      ),
      "utf8"
    )
  );
}

function textOf(task = {}) {
  const payload =
    task.payload ||
    {};

  const plan =
    payload.plan ||
    task.plan ||
    {};

  return [
    task.type,
    task.action,
    task.intent,
    task.workflow,
    task.provider,
    task.connector,
    payload.action,
    payload.capability,
    payload.objective,
    payload.command,
    payload.provider,
    payload.connector,
    plan.intent,
    plan.workflow,
    plan.action,
    plan.objective,
    plan.originalCommand
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
}

function matchPattern(text, patterns = []) {
  return patterns.find(pattern =>
    text.includes(
      String(pattern)
        .toUpperCase()
    )
  ) || null;
}

class PolicyEngineService {
  evaluate(task = {}, context = {}) {
    const constitution =
      readJson("constitution.json");

    const approvals =
      readJson("approval_matrix.json");

    const text =
      textOf(task);

    const neverAllowedPattern =
      matchPattern(
        text,
        approvals.neverAllowedPatterns
      );

    const protectedDomain =
      Object.keys(
        approvals.protectedAssets || {}
      ).find(asset =>
        text.includes(
          asset.toUpperCase()
        )
      ) || null;

    const outboundContext =
      /OUTBOUND|INSTANTLY|CAMPAIGN|SEND/
        .test(text);

    const approvalPattern =
      matchPattern(
        text,
        approvals.approvalPatterns
      );

    const autonomousPattern =
      matchPattern(
        text,
        approvals.autonomousPatterns
      );

    const data =
      dataAccess.evaluate({
        task,
        ...context
      });

    const demo =
      demoProtection.evaluate({
        task,
        ...context
      });

    let decision =
      "ALLOW";

    let approvalRequired =
      false;

    let risk =
      "LOW";

    let reason =
      "Read-only or low-risk action is authorized.";

    if (neverAllowedPattern) {
      decision = "DENY";
      risk = "CRITICAL";
      reason =
        `Constitutional prohibition matched: ${neverAllowedPattern}.`;
    } else if (
      protectedDomain &&
      outboundContext
    ) {
      decision = "DENY";
      risk = "CRITICAL";
      reason =
        approvals.protectedAssets[
          protectedDomain
        ].reason;
    } else if (!data.allowed) {
      decision = "DENY";
      risk = "HIGH";
      reason = data.reason;
    } else if (!demo.allowed) {
      decision = "DENY";
      risk = "HIGH";
      reason = demo.reason;
    } else if (approvalPattern) {
      decision =
        "REQUIRE_APPROVAL";
      approvalRequired = true;
      risk =
        /DELETE|SPEND|PAY|PURCHASE|BUY|DNS|DOMAIN|CREDENTIAL|DEPLOY|PRODUCTION/
          .test(approvalPattern)
          ? "CRITICAL"
          : "HIGH";
      reason =
        `CEO approval required for protected action: ${approvalPattern}.`;
    } else if (!autonomousPattern) {
      risk = "MEDIUM";
      reason =
        "Action is allowed but did not match an explicit autonomous pattern; enhanced auditing is required.";
    }

    const policy = {
      ok: true,
      evaluated: true,
      decision,
      allowed:
        decision !== "DENY",
      canExecute:
        decision === "ALLOW",
      approvalRequired,
      approver:
        approvalRequired
          ? approvals.defaultApprover
          : null,
      risk,
      reason,
      matches: {
        neverAllowedPattern,
        approvalPattern,
        autonomousPattern,
        protectedDomain
      },
      dataAccess: data,
      demoProtection: demo,
      constitutionVersion:
        constitution.version,
      policyVersion:
        approvals.version,
      evaluatedAt:
        new Date().toISOString()
    };

    audit.policyDecision(
      task,
      policy
    );

    return policy;
  }
}

module.exports =
  new PolicyEngineService();
'@

Write-Utf8NoBom (Join-Path $Root "SERVICES\governance\ApprovalGateService.js") @'
"use strict";

class ApprovalGateService {
  evaluate(task = {}, policy = {}) {
    const payload =
      task.payload ||
      {};

    const approval =
      task.approval ||
      payload.approval ||
      task.governance?.approval ||
      payload.governance?.approval ||
      {};

    if (
      policy.decision === "DENY"
    ) {
      return {
        allowed: false,
        status: "DENIED",
        approvalRequired: false,
        reason: policy.reason
      };
    }

    if (
      !policy.approvalRequired
    ) {
      return {
        allowed: true,
        status: "NOT_REQUIRED",
        approvalRequired: false,
        reason:
          "No approval required."
      };
    }

    const approved =
      approval.approved === true &&
      String(
        approval.approver ||
        ""
      ).toUpperCase() ===
        String(
          policy.approver ||
          "CEO"
        ).toUpperCase();

    return {
      allowed: approved,
      status:
        approved
          ? "APPROVED"
          : "AWAITING_APPROVAL",
      approvalRequired: true,
      approver:
        policy.approver ||
        "CEO",
      approvedBy:
        approved
          ? approval.approver
          : null,
      approvedAt:
        approved
          ? approval.approvedAt ||
            new Date().toISOString()
          : null,
      reason:
        approved
          ? "Required CEO approval verified."
          : policy.reason
    };
  }
}

module.exports =
  new ApprovalGateService();
'@

Write-Utf8NoBom (Join-Path $Root "SERVICES\governance\ConstitutionalGuardianService.js") @'
"use strict";

const policyEngine =
  require("./PolicyEngineService");
const approvalGate =
  require("./ApprovalGateService");
const audit =
  require("./GovernanceAuditService");

class ConstitutionalGuardianService {
  guard(task = {}, context = {}) {
    const existing =
      task.governance ||
      task.payload?.governance ||
      {};

    const policy =
      existing.policy?.evaluated
        ? existing.policy
        : policyEngine.evaluate(
            task,
            context
          );

    const approval =
      approvalGate.evaluate(
        task,
        policy
      );

    const allowed =
      policy.decision !== "DENY" &&
      approval.allowed === true;

    const guardian = {
      checked: true,
      allowed,
      status:
        allowed
          ? "AUTHORIZED"
          : approval.status ===
              "AWAITING_APPROVAL"
            ? "AWAITING_APPROVAL"
            : "BLOCKED",
      reason:
        allowed
          ? "Constitutional policy, data access, demo protection, and approval checks passed."
          : approval.reason ||
            policy.reason,
      policy,
      approval,
      checkedAt:
        new Date().toISOString()
    };

    audit.guardianDecision(
      task,
      guardian
    );

    return guardian;
  }

  assert(task = {}, context = {}) {
    const guardian =
      this.guard(
        task,
        context
      );

    if (!guardian.allowed) {
      const error =
        new Error(
          `GOVERNANCE_BLOCK: ${guardian.reason}`
        );

      error.code =
        guardian.status ===
          "AWAITING_APPROVAL"
          ? "GOVERNANCE_APPROVAL_REQUIRED"
          : "GOVERNANCE_DENIED";

      error.governance =
        guardian;

      throw error;
    }

    return guardian;
  }
}

module.exports =
  new ConstitutionalGuardianService();
'@

# ---------------------------------------------------------------------------
# PATCH COMMAND INTENT PLANNER
# ---------------------------------------------------------------------------

$PlannerAnchor = @'
      plannedAt:
        new Date().toISOString()
    };
'@

$PlannerReplacement = @'
      plannedAt:
        new Date().toISOString(),
      governance: {
        policyStatus: "UNASSESSED",
        risk: "UNKNOWN",
        approval: {
          status: "NOT_EVALUATED"
        },
        guardianChecked: false,
        auditRequired: true,
        constitutionVersion: "1.0.0"
      }
    };
'@

Patch-File `
  -RelativePath "SERVICES\CommandIntentPlannerService.js" `
  -Anchor $PlannerAnchor `
  -Replacement $PlannerReplacement `
  -PatchName "CommandIntentPlanner governance context"

# ---------------------------------------------------------------------------
# PATCH EXECUTION SERVICE PRIMARY GATE
# ---------------------------------------------------------------------------

$ExecutionRequireAnchor = @'
const workforceExecutionService = require("./WorkforceExecutionService");
'@

$ExecutionRequireReplacement = @'
const workforceExecutionService = require("./WorkforceExecutionService");
const constitutionalGuardian = require("./governance/ConstitutionalGuardianService");
const governanceAudit = require("./governance/GovernanceAuditService");
'@

Patch-File `
  -RelativePath "SERVICES\ExecutionService.js" `
  -Anchor $ExecutionRequireAnchor `
  -Replacement $ExecutionRequireReplacement `
  -PatchName "ExecutionService governance imports"

$ExecutionGateAnchor = @'
    const enrichedTask = normalizeTask(task);
'@

$ExecutionGateReplacement = @'
    const enrichedTask = normalizeTask(task);

    const guardian =
      constitutionalGuardian.guard(
        enrichedTask,
        {
          actor:
            enrichedTask.actor ||
            enrichedTask.payload?.actor ||
            "MILES",
          role:
            enrichedTask.role ||
            enrichedTask.payload?.role ||
            process.env.MILES_ACTOR_ROLE ||
            "MILES"
        }
      );

    enrichedTask.governance = {
      ...(enrichedTask.governance || {}),
      policy: guardian.policy,
      approval: guardian.approval,
      guardian
    };

    enrichedTask.payload = {
      ...(enrichedTask.payload || {}),
      governance:
        enrichedTask.governance
    };

    if (!guardian.allowed) {
      const blockedStatus =
        guardian.status ===
          "AWAITING_APPROVAL"
          ? "AWAITING_APPROVAL"
          : "BLOCKED";

      taskQueue.update(
        enrichedTask.id,
        {
          status: blockedStatus,
          governance:
            enrichedTask.governance,
          error:
            guardian.reason
        }
      );

      safePublish(
        blockedStatus ===
          "AWAITING_APPROVAL"
          ? "TASK_AWAITING_APPROVAL"
          : "TASK_GOVERNANCE_BLOCKED",
        {
          task: enrichedTask,
          governance:
            enrichedTask.governance
        }
      );

      const blockedResult = {
        ok: false,
        status: blockedStatus,
        governance:
          enrichedTask.governance,
        reason:
          guardian.reason
      };

      governanceAudit.executionResult(
        enrichedTask,
        blockedResult
      );

      return blockedResult;
    }
'@

Patch-File `
  -RelativePath "SERVICES\ExecutionService.js" `
  -Anchor $ExecutionGateAnchor `
  -Replacement $ExecutionGateReplacement `
  -PatchName "ExecutionService primary constitutional gate"

# ---------------------------------------------------------------------------
# PATCH WORKFORCE EXECUTION FINAL NON-BYPASSABLE GATE
# ---------------------------------------------------------------------------

$WorkforceRequireAnchor = @'
const { log } = require("../CORE/logger");
'@

$WorkforceRequireReplacement = @'
const { log } = require("../CORE/logger");
const constitutionalGuardian = require("./governance/ConstitutionalGuardianService");
const governanceAudit = require("./governance/GovernanceAuditService");
'@

Patch-File `
  -RelativePath "SERVICES\WorkforceExecutionService.js" `
  -Anchor $WorkforceRequireAnchor `
  -Replacement $WorkforceRequireReplacement `
  -PatchName "WorkforceExecutionService governance imports"

$WorkforceGateAnchor = @'
  async executeAndVerify(task = {}) {
    try {
      const result = await this.executeStep(task);
'@

$WorkforceGateReplacement = @'
  async executeAndVerify(task = {}) {
    try {
      const guardian =
        constitutionalGuardian.guard(
          task,
          {
            actor:
              task.actor ||
              task.payload?.actor ||
              "MILES",
            role:
              task.role ||
              task.payload?.role ||
              process.env.MILES_ACTOR_ROLE ||
              "MILES"
          }
        );

      task.governance = {
        ...(task.governance || {}),
        policy: guardian.policy,
        approval: guardian.approval,
        guardian
      };

      task.payload = {
        ...(task.payload || {}),
        governance:
          task.governance
      };

      if (!guardian.allowed) {
        const blocked = {
          ok: false,
          result: null,
          verification: {
            verified: false,
            status:
              guardian.status ===
                "AWAITING_APPROVAL"
                ? "AWAITING_CEO_APPROVAL"
                : "GOVERNANCE_BLOCKED",
            governance:
              task.governance
          },
          status:
            guardian.status ===
              "AWAITING_APPROVAL"
              ? "AWAITING_CEO_APPROVAL"
              : "GOVERNANCE_BLOCKED",
          governance:
            task.governance
        };

        governanceAudit.executionResult(
          task,
          blocked
        );

        return blocked;
      }

      const result = await this.executeStep(task);
'@

Patch-File `
  -RelativePath "SERVICES\WorkforceExecutionService.js" `
  -Anchor $WorkforceGateAnchor `
  -Replacement $WorkforceGateReplacement `
  -PatchName "WorkforceExecutionService final guardian gate"

$WorkforceAuditAnchor = @'
      return {
        ok: verification.verified,
        result,
        verification,
        status: verification.status
      };
'@

$WorkforceAuditReplacement = @'
      const completed = {
        ok: verification.verified,
        result,
        verification,
        status: verification.status,
        governance:
          task.governance ||
          task.payload?.governance ||
          null
      };

      governanceAudit.executionResult(
        task,
        completed
      );

      return completed;
'@

Patch-File `
  -RelativePath "SERVICES\WorkforceExecutionService.js" `
  -Anchor $WorkforceAuditAnchor `
  -Replacement $WorkforceAuditReplacement `
  -PatchName "WorkforceExecutionService governance audit"

# ---------------------------------------------------------------------------
# PATCH PROVIDER ROUTER DEFENSE-IN-DEPTH
# ---------------------------------------------------------------------------

$ProviderRequireAnchor = @'
const providerBindings =
  require("./ProviderCapabilityBindingService");
'@

$ProviderRequireReplacement = @'
const providerBindings =
  require("./ProviderCapabilityBindingService");
const constitutionalGuardian =
  require("./governance/ConstitutionalGuardianService");
'@

Patch-File `
  -RelativePath "SERVICES\ProviderRouterService.js" `
  -Anchor $ProviderRequireAnchor `
  -Replacement $ProviderRequireReplacement `
  -PatchName "ProviderRouter governance import"

$ProviderInvokeAnchor = @'
  async invokeProvider(
    provider,
    action,
    task
  ) {
    const normalizedAction =
'@

$ProviderInvokeReplacement = @'
  async invokeProvider(
    provider,
    action,
    task
  ) {
    const guardian =
      constitutionalGuardian.guard(
        task || {},
        {
          provider:
            task?.payload?.provider ||
            task?.provider ||
            provider?.constructor?.name ||
            "UNKNOWN",
          actor:
            task?.actor ||
            task?.payload?.actor ||
            "MILES",
          role:
            task?.role ||
            task?.payload?.role ||
            process.env.MILES_ACTOR_ROLE ||
            "MILES"
        }
      );

    if (!guardian.allowed) {
      return {
        ok: false,
        status:
          guardian.status ===
            "AWAITING_APPROVAL"
            ? "AWAITING_CEO_APPROVAL"
            : "GOVERNANCE_BLOCKED",
        governance: guardian,
        error:
          guardian.reason
      };
    }

    const normalizedAction =
'@

Patch-File `
  -RelativePath "SERVICES\ProviderRouterService.js" `
  -Anchor $ProviderInvokeAnchor `
  -Replacement $ProviderInvokeReplacement `
  -PatchName "ProviderRouter final provider invocation gate"

# ---------------------------------------------------------------------------
# BUILD 052 VALIDATION TEST
# ---------------------------------------------------------------------------

Write-Utf8NoBom (Join-Path $Root "TESTS\Build052GovernanceTest.js") @'
"use strict";

const assert = require("assert");

const policy =
  require("../SERVICES/governance/PolicyEngineService");

const guardian =
  require("../SERVICES/governance/ConstitutionalGuardianService");

function task(action, extra = {}) {
  return {
    id:
      `BUILD052_${action}_${Date.now()}`,
    type: "WORKFORCE_STEP",
    action,
    provider:
      extra.provider ||
      "MarketingProvider",
    role:
      extra.role ||
      "MILES",
    payload: {
      provider:
        extra.provider ||
        "MarketingProvider",
      action,
      capability:
        extra.capability ||
        action,
      objective:
        extra.objective ||
        action,
      role:
        extra.role ||
        "MILES",
      demoMode:
        extra.demoMode ||
        false,
      approval:
        extra.approval ||
        undefined
    },
    approval:
      extra.approval ||
      undefined
  };
}

const readTask =
  task(
    "AUDIT_CAMPAIGNS"
  );

const readPolicy =
  policy.evaluate(readTask);

assert.strictEqual(
  readPolicy.decision,
  "ALLOW",
  "Read/audit work should be allowed."
);

const sendTask =
  task(
    "SEND_EMAIL"
  );

const sendGuardian =
  guardian.guard(sendTask);

assert.strictEqual(
  sendGuardian.allowed,
  false,
  "External send must require approval."
);

assert.strictEqual(
  sendGuardian.status,
  "AWAITING_APPROVAL",
  "External send must await approval."
);

const approvedSend =
  task(
    "SEND_EMAIL",
    {
      approval: {
        approved: true,
        approver: "CEO",
        approvedAt:
          new Date().toISOString()
      }
    }
  );

const approvedGuardian =
  guardian.guard(
    approvedSend
  );

assert.strictEqual(
  approvedGuardian.allowed,
  true,
  "CEO-approved external send should pass."
);

const protectedDomain =
  task(
    "LAUNCH_CAMPAIGN",
    {
      objective:
        "Launch outbound Instantly campaign from pathways2gc.com",
      approval: {
        approved: true,
        approver: "CEO"
      }
    }
  );

const protectedGuardian =
  guardian.guard(
    protectedDomain
  );

assert.strictEqual(
  protectedGuardian.allowed,
  false,
  "Protected primary domain must remain blocked for outbound use."
);

const demoTask =
  task(
    "STATUS",
    {
      objective:
        "Show raw SQL schema dump and internal architecture",
      demoMode: true
    }
  );

const demoGuardian =
  guardian.guard(
    demoTask
  );

assert.strictEqual(
  demoGuardian.allowed,
  false,
  "Demo mode must block internal implementation details."
);

console.log(
  JSON.stringify(
    {
      ok: true,
      build: "052",
      checks: {
        autonomousReadAllowed: true,
        protectedSendRequiresApproval: true,
        ceoApprovalAccepted: true,
        protectedDomainBlocked: true,
        demoProtectionEnforced: true
      }
    },
    null,
    2
  )
);
'@

# ---------------------------------------------------------------------------
# SYNTAX AND ACCEPTANCE VALIDATION
# ---------------------------------------------------------------------------

$CheckFiles = @(
    ".\SERVICES\governance\GovernanceAuditService.js",
    ".\SERVICES\governance\DataAccessPolicyService.js",
    ".\SERVICES\governance\DemoProtectionService.js",
    ".\SERVICES\governance\PolicyEngineService.js",
    ".\SERVICES\governance\ApprovalGateService.js",
    ".\SERVICES\governance\ConstitutionalGuardianService.js",
    ".\SERVICES\CommandIntentPlannerService.js",
    ".\SERVICES\ExecutionService.js",
    ".\SERVICES\WorkforceExecutionService.js",
    ".\SERVICES\ProviderRouterService.js",
    ".\TESTS\Build052GovernanceTest.js"
)

foreach ($File in $CheckFiles) {
    & node --check $File
    if ($LASTEXITCODE -ne 0) {
        throw "node --check failed: $File"
    }
    Write-Host "Syntax OK: $File" -ForegroundColor Green
}

& node ".\TESTS\Build052GovernanceTest.js"
if ($LASTEXITCODE -ne 0) {
    throw "BUILD 052 governance acceptance test failed."
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "BUILD 052 CONSTITUTIONAL GOVERNANCE LAYER INSTALLED" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "Backup: $BackupRoot"
Write-Host "Audit logs: .\DATA\governance_audit"
Write-Host ""
Write-Host "Next runtime validation:" -ForegroundColor Cyan
Write-Host '  taskkill /F /IM node.exe'
Write-Host '  node StartMilesProduction.js'
Write-Host ""
Write-Host "Do not continue to BUILD 053 until startup is clean and the governance test passes." -ForegroundColor Yellow
