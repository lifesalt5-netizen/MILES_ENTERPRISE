param(
  [string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS",
  [string]$DataRoot = "$RepoRoot\.miles_data",
  [int]$Port = 8765
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Set-Location $RepoRoot
$env:MILES_DATA_ROOT = $DataRoot

if (-not (Test-Path ".venv")) {
  py -m venv .venv
}

& ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt
& ".\.venv\Scripts\python.exe" -m uvicorn miles_desktop.api.app:app --host 127.0.0.1 --port $Port --reload
