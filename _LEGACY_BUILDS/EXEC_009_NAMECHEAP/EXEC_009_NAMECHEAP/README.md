# EXEC_009 — Namecheap Live Integration

MILES OS implementation package for Namecheap domain and DNS operations.

This module extends the verified Provider Framework and is designed to plug into the existing MILES OS chain:

Executive Brain → Mission Automation Engine → Business Execution Engine → Unified Action Engine → Provider Controllers → Verification → Audit → Self Learning

## Status

Implementation package: built.
Live credentials: pending Kevin configuration.
Controlled writes: supported but disabled by default.

## Capabilities

- Domain inventory
- DNS read/sync
- DNS verification
- SPF verification and desired-state planning
- DKIM verification and desired-state planning
- DMARC verification and desired-state planning
- MX verification and desired-state planning
- Domain health scoring
- DNS drift detection
- Audit logging
- Provider synchronization payloads
- Governance-aware controlled writes

## Governance

Automatic by default:

- List domains
- Read DNS
- Verify DNS
- Health checks
- Registry sync
- Drift reports

Approval required:

- Purchase domains
- Transfer domains
- Change nameservers
- Delete DNS records
- Disable mail routing
- Apply DNS mutations when controlled writes are disabled

## Environment

Copy `.env.example` to `.env` and configure credentials outside source control.

```bash
NAMECHEAP_API_USER=
NAMECHEAP_API_KEY=
NAMECHEAP_USERNAME=
NAMECHEAP_CLIENT_IP=
NAMECHEAP_SANDBOX=true
MILES_CONTROLLED_WRITES=false
```

## Install

PowerShell:

```powershell
./install_EXEC_009.ps1
```

Python:

```bash
python install_EXEC_009.py
```

## Example

```bash
python examples/run_domain_health_check.py
```

## Notes

This package avoids storing or embedding secrets. The provider can run in read-only verification mode until Kevin enables controlled writes.
