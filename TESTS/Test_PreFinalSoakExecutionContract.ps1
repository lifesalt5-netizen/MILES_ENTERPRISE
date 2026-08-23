$ErrorActionPreference = 'Stop'

$path = Join-Path $PSScriptRoot '..\SCRIPTS\RunPreFinalSoakReadiness.ps1'
$text = Get-Content -Raw -LiteralPath $path

$required = @(
    '[string[]]$Arguments',
    '@Arguments',
    'instantly_weekday_repair_execute_verification',
    'instantly_weekday_repair_postcheck',
    "'instantly_send_window_since_gate_start'",
    '"--since=$startedAt"',
    'localOperationalConfigStable',
    'blockingUntracked'
)
foreach($token in $required){
    if($text -notmatch [regex]::Escape($token)){ throw "Missing pre-final execution invariant: $token" }
}

if($text -match "'instantly_send_window_last24h'"){ throw 'Legacy rolling-24h pre-final send-window gate is still present.' }
if($text -match '\[string\[\]\]\$Args'){ throw 'Legacy Args parameter remains and can lose explicit node arguments under Windows PowerShell.' }

Write-Host 'PRE_FINAL_SOAK_EXECUTION_CONTRACT=PASS'
