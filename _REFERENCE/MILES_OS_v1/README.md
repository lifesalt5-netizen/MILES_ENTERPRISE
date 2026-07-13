# MILES OS v1.0 — GovCon Revenue Execution Kernel

MILES OS is the operating framework for the P2GC Digital COO.

It is designed so Miles can run operations while Kevin remains responsible for:
- Client demos
- Sales calls
- Pricing
- Contract negotiation
- Major approvals
- Protected email decisions

## Critical protected rule

`pathways2gc.com` is website/admin only.

Never use `pathways2gc.com` for outbound Instantly campaigns.

## Current connector status

- Website B12 connector: implemented in safe observe mode.
- Instantly connector: scaffold.
- ORION connector: scaffold.
- Google Workspace connector: scaffold.
- IONOS connector: scaffold.
- Calendly connector: scaffold.

## Install for B12 connector

From PowerShell:

```powershell
cd D:\P2GC_Intelligence\MILES_OS\CONNECTORS\WEBSITE_B12
npm install
npx playwright install chromium
node controller.js
```

## Safe automation policy

The B12 connector can observe, screenshot, audit, and prepare changes.
It should not publish without Kevin approval.
