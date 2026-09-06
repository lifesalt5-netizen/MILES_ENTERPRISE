# BEMSE

BEMSE is an autonomous growth infrastructure platform. The MVP begins with safe outbound: list verification, reputation protection, sending governance, telemetry, and AI-assisted optimization.

## MVP operating rules

- Separate from P2GC.
- Free/open-source first; paid services only when validation requires them.
- Maximum speed with accuracy.
- Deliverability-first, reputation-first, telemetry-first.
- Self-healing and continuously evolving.
- Replace the founder's existing outbound stack first.
- Outcome-first UX: users state goals; BEMSE handles technical setup wherever possible.
- Premium autonomous growth infrastructure positioning, not cheap email software.

## Current implementation status

- Verification Engine V1: implemented.
- Telemetry/Event Contract V1: implemented with privacy-preserving recipient fingerprints.
- Reputation Intelligence V1: implemented with explainable 0-100 scoring and Healthy / At Risk / Danger / Recovering states.
- Autonomous Governance V1: implemented with Allow / Throttle / Pause / Recovery-only actions.
- Provider-agnostic Send Allocation V1: implemented; reputation-first routing respects inbox caps, sent-today volume, disabled infrastructure, and governance pauses.
- Google/Microsoft/custom SMTP execution connectors: pending.
- Persistent PostgreSQL/Redis/ClickHouse adapters: pending; current telemetry sink is intentionally dependency-light for MVP development.
- AI optimization: pending.

## Current build order

1. Verification engine - implemented, hardening continues
2. Telemetry/event architecture - V1 implemented
3. Reputation intelligence - V1 implemented
4. Autonomous governance - V1 implemented
5. Sending orchestration - allocation core implemented; provider connectors next
6. Persistence and campaign/lead models
7. AI optimization
8. Closed beta hardening

## Local development

```bash
cd BEMSE
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -e .[dev]
uvicorn bemse.main:app --reload
pytest
```
