param(
  [string]$Root = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'

function Safe-Count($items) {
  if ($null -eq $items) { return 0 }
  return @($items).Count
}

$result = [ordered]@{
  ok = $false
  service = 'MILES_CANONICAL_APPROVAL_DASHBOARD_DIAGNOSTIC'
  observedAt = (Get-Date).ToUniversalTime().ToString('o')
  root = $Root
  process8787 = $null
  liveHtml = $null
  localIndex = $null
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

  $live = Invoke-WebRequest 'http://127.0.0.1:8787/' -UseBasicParsing -TimeoutSec 15
  $liveText = [string]$live.Content
  $result.liveHtml = [ordered]@{
    httpStatus = [int]$live.StatusCode
    bytes = [Text.Encoding]::UTF8.GetByteCount($liveText)
    containsCompanyHealth = $liveText -match 'COMPANY HEALTH'
    containsKevinApprovalMetric = $liveText -match 'KEVIN APPROVAL'
    containsKevinApprovalQueue = $liveText -match 'Kevin Approval Queue'
    containsCommandMiles = $liveText -match 'Command MILES'
    sha256 = ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($liveText)) | ForEach-Object ToString x2) -join ''
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
      sha256 = ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($indexText)) | ForEach-Object ToString x2) -join ''
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
    $issues += 'The HTML served on port 8787 does not byte-match SERVICES/digital_coo/public/index.html.'
  }
  if ($result.liveHtml.containsKevinApprovalMetric -and $result.api.canonicalPendingApprovals -eq 0) {
    $issues += 'Live HTML contains a Kevin Approval metric while canonical pending approvals are zero; client-side/runtime data source must be verified.'
  }

  $result.diagnosis = [ordered]@{
    issueCount = $issues.Count
    issues = $issues
    canonicalTruth = "Kevin approvals = $($result.api.canonicalPendingApprovals)"
    workerRuntimeBacklog = $result.api.workerRuntimeAwaitingApproval
  }
  $result.ok = $true
} catch {
  $result.error = $_.Exception.Message
  $result.stack = $_.ScriptStackTrace
}

$result | ConvertTo-Json -Depth 8
if (-not $result.ok) { exit 2 }
