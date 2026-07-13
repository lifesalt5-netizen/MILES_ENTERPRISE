# MILES Desktop Patch 007

Real additive source code for the MILES Desktop local COO app.

## What this patch adds

- Local FastAPI backend for MILES Desktop
- Durable JSON state store under `.miles_data`
- Work queue with Kevin authority matrix
- Twin routing by department
- Segment inventory scanner for CSV lead folders
- Bootstrap seed for known P2GC systems and immediate work
- React/Vite control-center UI
- PowerShell start/bootstrap/segment-scan scripts
- Pytest coverage for queue and segment inventory

## Install into the real repo

Copy the contents of this folder into:

```powershell
D:\P2GC_Intelligence\MILES_OS
```

Then run:

```powershell
cd D:\P2GC_Intelligence\MILES_OS
.\scripts\start_miles_api.ps1
```

In a second PowerShell window:

```powershell
.\scripts\bootstrap_miles.ps1
.\scripts\scan_segments.ps1
```

Optional UI:

```powershell
cd D:\P2GC_Intelligence\MILES_OS\ui
npm install
npm run dev
```

Open the Vite URL shown in the terminal.

## API endpoints

- `GET /health`
- `POST /bootstrap`
- `GET /systems`
- `POST /work`
- `GET /work`
- `POST /work/{item_id}/approve`
- `POST /work/{item_id}/complete`
- `POST /segments/scan`
- `GET /segments`

## Design rule preserved

MILES can execute automatically where safe. Kevin approval is required for pricing, proposals, legal/signing, destructive changes, website publishing, DNS, mailbox/domain changes, and Instantly launches.
