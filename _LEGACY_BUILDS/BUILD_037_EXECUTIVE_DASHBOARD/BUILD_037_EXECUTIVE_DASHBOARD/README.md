# BUILD_037 Executive Dashboard

Read-only CEO Control Center for MILES OS.

## Install

```powershell
cd "D:\P2GC_Intelligence\MILES_OS\BUILD_037_EXECUTIVE_DASHBOARD"
powershell -ExecutionPolicy Bypass -File .\INSTALL_EXECUTIVE_DASHBOARD.ps1
```

## Verify

```powershell
cd "D:\P2GC_Intelligence\MILES_OS\BUILD_037_EXECUTIVE_DASHBOARD"
powershell -ExecutionPolicy Bypass -File .\VERIFY_EXECUTIVE_DASHBOARD.ps1
```

## Run once

```powershell
cd "D:\P2GC_Intelligence\MILES_OS\BUILD_037_EXECUTIVE_DASHBOARD"
powershell -ExecutionPolicy Bypass -File .\RUN_EXECUTIVE_DASHBOARD.ps1
```

## Run local dashboard server

```powershell
cd "D:\P2GC_Intelligence\MILES_OS\BUILD_037_EXECUTIVE_DASHBOARD"
powershell -ExecutionPolicy Bypass -File .\RUN_EXECUTIVE_DASHBOARD_SERVER.ps1
```

Open:

```text
http://127.0.0.1:8737
```

## Outputs

- `DATA\executive_dashboard\dashboard_state.json`
- `DATA\executive_dashboard\dashboard_summary.json`
- `DATA\executive_dashboard\dashboard_alerts.json`
- `DATA\executive_dashboard\executive_dashboard_report.md`
- `DATA\executive_dashboard\index.html`

## Build Scope

BUILD_037 reads from the verified MILES OS runtime outputs:

- Repository Registry
- Capability Registry
- Executive Brain
- Company State
- Task Router
- Continuous COO Loop
- Runtime Health
- Work Queue

BUILD_037 is read-only. It does not modify operational data.
