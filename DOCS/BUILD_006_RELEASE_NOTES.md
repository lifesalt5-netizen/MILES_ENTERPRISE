# MILES Build 006 — Outbound Operations Department

## Added
- Outbound Operations service
- Domain Status Master
- Inbox Status Master
- Campaign Status Master
- Segment Inventory Master
- Outbound Asset Registry
- Outbound Daily Report
- Outbound dashboard page
- Executive Chat responses for outbound, workforce, priorities, approvals
- CEO Approval Center action recording endpoint

## Safety Rules
- `pathways2gc.com` is protected and excluded from outbound.
- `info@pathways2gc.com` remains Super Admin only.

## Test
Run:

```powershell
npm test
npm run audit:outbound
```

## Rollback
Installer creates `BACKUPS/build006_<timestamp>` before replacing files.
