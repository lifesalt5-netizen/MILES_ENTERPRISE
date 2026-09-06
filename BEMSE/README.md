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

## Current build order

1. Verification engine
2. Telemetry/event architecture
3. Reputation intelligence
4. Sending orchestration
5. Autonomous governance
6. AI optimization
7. Closed beta hardening

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
