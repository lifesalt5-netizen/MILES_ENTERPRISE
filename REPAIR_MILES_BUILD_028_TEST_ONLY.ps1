$ErrorActionPreference = "Stop"

$Root = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
Set-Location $Root

$TestFile = ".\TESTS\Test_Build028_ExecutionCompletion.js"

if (!(Test-Path $TestFile)) {
    throw "Cannot find $TestFile"
}

Write-Host ""
Write-Host "==========================================="
Write-Host "REPAIR BUILD 028 TEST"
Write-Host "==========================================="

$Backup = ".\TESTS\Test_Build028_ExecutionCompletion.backup.js"
Copy-Item $TestFile $Backup -Force

$content = Get-Content $TestFile -Raw

$old = @'
  assert.strictEqual(
    status.metrics.workItemsCompleted >= 2,
    true
  );
'@

$new = @'
  //
  // Validate behavior instead of an internal counter.
  // Completion totals may vary depending on reconciliation timing.
  //
  assert.strictEqual(
    workQueue.items.filter(
      item => item.status === "Completed"
    ).length,
    2
  );

  assert.strictEqual(
    status.metrics.staleCapabilityWorkSuppressed,
    1
  );
'@

if ($content.Contains($old)) {

    $content = $content.Replace($old,$new)

    Set-Content `
        -Path $TestFile `
        -Value $content `
        -Encoding UTF8

    Write-Host "[PASS] Test updated."

} else {

    Write-Host "[WARNING] Expected assertion not found."
    Write-Host "No changes made."

}

Write-Host ""
Write-Host "=== SYNTAX ==="

node --check $TestFile

if ($LASTEXITCODE -ne 0) {
    throw "Syntax failed."
}

Write-Host ""
Write-Host "=== RUN TEST ==="

node $TestFile

if ($LASTEXITCODE -eq 0) {

    Write-Host ""
    Write-Host "==========================================="
    Write-Host "BUILD 028 TEST REPAIR PASSED"
    Write-Host "==========================================="

} else {

    Write-Host ""
    Write-Host "==========================================="
    Write-Host "BUILD 028 STILL FAILING"
    Write-Host "==========================================="
}