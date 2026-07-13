# EXEC_004 — Controlled Write Mode

Purpose: move from read-only Instantly integration to controlled, allowlisted, auditable write operations.

Default behavior is safe: writes are disabled and produce dry-run/audit records.

Installed services:

- ControlledWritePolicyService.js
- ControlledWriteAuditService.js
- InstantlyControlledWriteService.js
- ControlledWriteService.js

Allowed initial write operations:

- CREATE_TEST_CAMPAIGN
- PAUSE_TEST_CAMPAIGN
- RESUME_TEST_CAMPAIGN

Blocked operations:

- Delete campaign
- Bulk production lead upload
- Start production campaign

Live writes require:

- INSTANTLY_API_KEY present
- MILES_CONTROLLED_WRITE_ENABLED=true
- INSTANTLY_WRITE_ENABLED=true
- test campaign name starts with MILES_TEST_
