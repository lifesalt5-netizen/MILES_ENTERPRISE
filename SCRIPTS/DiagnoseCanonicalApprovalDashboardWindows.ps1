param(
  [string]$Root = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'

function Get-Sha256([string]$Text) {
  return ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)) | ForEach-Object ToString x2) -join ''
}

$result = [ordered]@{
  ok = $false
  service = 'MILES_CANONICAL_APPROVAL_DASHBOARD_DIAGNOSTIC'
  observedAt = (Get-Date).ToUniversalTime().ToString('o')
  root = $Root
  process8787 = $null
  pm2 = $null
  liveHtml = $null
  localIndex = $null
  servedIndexCandidate = $null
  api = $null
  diagnosis = $null
  safety = [ordered]@{
    readOnly = $true
    filesChanged = 0
    processesStopped = 0
    servicesRestarted = 0
    providerMutation = $false
  }
}

try {
  $conn = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" -ErrorAction SilentlyContinue
    $result.process8787 = [ordered]@{
      listening = $true
      pid = $conn.OwningProcess
      executablePath = $proc.ExecutablePath
      commandLine = $proc.CommandLine
    }
  } else {
    $result.process8787 = [ordered]@{ listening = $false }
  }

  try {
    $pm2Raw = & pm2 jlist 2>$null
    if ($LASTEXITCODE -eq 0 -and $pm2Raw) {
      $pm2List = $pm2Raw | ConvertFrom-Json
      $match = @($pm2List | Where-Object { [int]$_.pid -eq [int]$conn.OwningProcess }) | Select-Object -First 1
      if ($match) {
        $envInfo = $match.pm2_env
        $result.pm2 = [ordered]@{
          matched = $true
          name = $match.name
          pid = $match.pid
          status = $envInfo.status
          pmExecPath = $envInfo.pm_exec_path
          pmCwd = $envInfo.pm_cwd
          nodeArgs = @($envInfo.node_args)
          args = @($envInfo.args)
          milesRoot = $envInfo.MILES_ROOT
          milesCommandPort = $envInfo.MILES_COMMAND_PORT
        }

        $candidateIndex = $null
        if ($envInfo.pm_exec_path) {
          $candidateIndex = Join-Path (Split-Path -Parent $envInfo.pm_exec_path) 'public\index.html'
        }
        if ($candidateIndex -and (Test-Path $candidateIndex)) {
          $candidateText = Get-Content $candidateIndex -Raw
          $result.servedIndexCandidate = [ordered]@{
            path = $candidateIndex
            bytes = [Text.Encoding]::UTF8.GetByteCount($candidateText)
            containsCompanyHealth = $candidateText -match 'COMPANY HEALTH'
            containsKevinApprovalMetric = $candidateText -match 'KEVIN APPROVAL'
            containsKevinApprovalQueue = $candidateText -match 'Kevin Approval Queue'
            containsCommandMiles = $candidateText -match 'Command MILES'
            sha256 = Get-Sha256 $candidateText
            matchesLive = $false
          }
        }
      } else {
        $result.pm2 = [ordered]@{ matched = $false }
      }
    } else {
      $result.pm2 = [ordered]@{ matched = $false; error = 'pm2 jlist unavailable' }
    }
  } catch {
    $result.pm2 = [ordered]@{ matched = $false; error = $_.Exception.Message }
  }

  $live = Invoke-WebRequest 'http://127.0.0.1:8787/' -UseBasicParsing -TimeoutSec 15
  $liveText = [string]$live.Content
  $liveHash = Get-Sha256 $liveText
  $result.liveHtml = [ordered]@{
    httpStatus = [int]$live.StatusCode
    bytes = [Text.Encoding]::UTF8.GetByteCount($liveText)
    containsCompanyHealth = $liveText -match 'COMPANY HEALTH'
    containsKevinApprovalMetric = $liveText -match 'KEVIN APPROVAL'
    containsKevinApprovalQueue = $liveText -match 'Kevin Approval Queue'
    containsCommandMiles = $liveText -match 'Command MILES'
    sha256 = $liveHash
  }
  if ($result.servedIndexCandidate) {
    $result.servedIndexCandidate.matchesLive = $result.servedIndexCandidate.sha256 -eq $liveHash
  }

  $indexPath = Join-Path $Root 'SERVICES\digital_coo\public\index.html'
  if (Test-Path $indexPath) {
    $indexText = Get-Content $indexPath -Raw
    $result.localIndex = [ordered]@{
      path = $indexPath
      bytes = [Text.Encoding]::UTF8.GetByteCount($indexText)
      containsCompanyHealth = $indexText -match 'COMPANY HEALTH'
      containsKevinApprovalMetric = $indexText -match 'KEVIN APPROVAL'
      containsKevinApprovalQueue = $indexText -match 'Kevin Approval Queue'
      containsCommandMiles = $indexText -match 'Command MILES'
      sha256 = Get-Sha256 $indexText
      matchesLive = $false
    }
    $result.localIndex.matchesLive = $result.localIndex.sha256 -eq $result.liveHtml.sha256
  }

  $cc = Invoke-RestMethod 'http://127.0.0.1:8787/api/dashboard' -TimeoutSec 15
  $pending = @($cc.operations | Where-Object {
    [string]$_.status -match 'AWAITING_APPROVAL|WAITING_FOR_CEO_APPROVAL|AWAITING_CEO_APPROVAL'
  })
  $result.api = [ordered]@{
    canonicalPendingApprovals = $pending.Count
    workerRuntimeAwaitingApproval = [int]($cc.taskQueue.awaitingApproval)
    taskQueueSource = [string]$cc.taskQueue.source
    operationSnapshotSource = [string]$cc.operationSnapshot.source
    operationSnapshotTotal = $cc.operationSnapshot.total
    pendingIds = @($pending | ForEach-Object { $_.id })
  }

  $issues = @()
  if ($result.api.canonicalPendingApprovals -ne 0) {
    $issues += 'Canonical queue has actual pending approvals.'
  }
  if ($result.api.workerRuntimeAwaitingApproval -ne $result.api.canonicalPendingApprovals) {
    $issues += 'Worker runtime approval backlog differs from canonical CEO approval count and must not drive the Kevin Approval metric.'
  }
  if ($result.localIndex -and -not $result.localIndex.matchesLive) {
    $issues += 'The HTML served on port 8787 does not byte-match the active-repo SERVICES/digital_coo/public/index.html.'
  }
  if ($result.servedIndexCandidate -and $result.servedIndexCandidate.matchesLive) {
    $issues += "Port 8787 is serving a different checkout: $($result.servedIndexCandidate.path)"
  }
  if ($result.liveHtml.containsKevinApprovalMetric -and $result.api.canonicalPendingApprovals -eq 0) {
    $issues += 'Live HTML contains a Kevin Approval metric while canonical pending approvals are zero; client-side/runtime data source must be verified.'
  }

  $result.diagnosis = [ordered]@{
    issueCount = $issues.Count
    issues = $issues
    canonicalTruth = "Kevin approvals = $($result.api.canonicalPendingApprovals)"
    workerRuntimeBacklog = $result.api.workerRuntimeAwaitingApproval
    activeRepoExpected = $Root
    runtimeCwd = $result.pm2.pmCwd
    runtimeExecPath = $result.pm2.pmExecPath
  }
  $result.ok = $true
} catch {
  $result.error = $_.Exception.Message
  $result.stack = $_.ScriptStackTrace
}

$result | ConvertTo-Json -Depth 10
if (-not $result.ok) { exit 2 }
