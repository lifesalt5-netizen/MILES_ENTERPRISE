# EXEC_003 — Instantly Live Integration

This package installs the first live external-provider bridge for Miles.

It does not change architecture. It extends the verified EXEC_001 Action Engine and EXEC_002 Provider Controller framework.

## Services

- `InstantlyApiClient.js`
- `InstantlyLiveProviderController.js`
- `InstantlyActionBridgeService.js`
- `InstantlyLiveIntegrationService.js`
- cumulative `BuilderService.js`

## Supported Operations

- HEALTH_CHECK
- LIST_CAMPAIGNS
- GET_CAMPAIGN
- CREATE_CAMPAIGN
- PAUSE_CAMPAIGN
- RESUME_CAMPAIGN
- UPLOAD_LEADS
- ASSIGN_SENDING_ACCOUNTS
- GENERATE_CAMPAIGN_REPORT

## Safety

Writes are blocked unless `INSTANTLY_WRITE_ENABLED=true`.

This prevents Miles from creating or modifying live campaigns until Kevin intentionally enables write mode.
