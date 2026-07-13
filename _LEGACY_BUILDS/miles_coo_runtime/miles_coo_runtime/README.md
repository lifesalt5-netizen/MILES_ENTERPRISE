# MILES Digital COO Runtime MVP

This is the fastest production scaffold for MILES.

## Run
```bash
python miles_runtime.py
```

## What it does now
- Loads authority/governance rules.
- Runs COO operators.
- Produces an executive report.
- Logs every cycle to `/logs`.
- Keeps CEO approval separate from autonomous operational work.

## Next live-connection step
Replace operator stubs with real connectors for:
- Instantly
- Google Workspace
- B12
- ORION
- USAspending/GSA/VA FSS/SAM

## Governance
MILES operates autonomously below CEO-level decisions.
CEO approvals remain required for spending, pricing, legal commitments, final proposal submissions, major strategy changes, hiring/firing, and critical data deletion.
