# MILES Platform v0.3.0

This is a production drop-in release for the existing repository:

`D:\P2GC_Intelligence\MILES_OS`

It implements the controlled local execution architecture for Miles as Digital COO.

## Install

1. Copy all folders/files from this release into the existing repo root.
2. Run:

```powershell
cd D:\P2GC_Intelligence\MILES_OS
.\scripts\install_miles_operator.ps1 -RepoRoot "D:\P2GC_Intelligence\MILES_OS"
```

## Use

Submit a safe task:

```powershell
python .\miles_operator.py submit --title "Git status check" --action git_status --module CORE --objective "Check repo status"
python .\miles_operator.py run-once
python .\miles_operator.py report
```

List tasks:

```powershell
python .\miles_operator.py list
python .\miles_operator.py list --state inbox
```

Approve a CEO-required task:

```powershell
python .\miles_operator.py approve op_TASKID
python .\miles_operator.py run-once
```

Reject a task:

```powershell
python .\miles_operator.py reject op_TASKID --reason "Not approved"
```
