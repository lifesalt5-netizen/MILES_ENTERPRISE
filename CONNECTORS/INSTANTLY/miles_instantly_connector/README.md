# MILES OS — Instantly Connector Module

Production-ready first connector package for MILES OS.

## Why this module comes first
Instantly API v1 was deprecated on January 19, 2026, so this connector targets API v2 only. API v2 uses Bearer token auth and supports campaign, lead, account, analytics, blocklist, and unibox operations.

## Files
- `miles_os/services/instantly/config.py` — env config
- `miles_os/services/instantly/client.py` — Instantly API v2 transport client
- `miles_os/services/instantly/service.py` — COO-level service actions and health check
- `miles_os/services/instantly/registry.py` — service registry integration
- `miles_os/dashboard/instantly_panel.py` — dashboard integration panel
- `tests/test_instantly_service.py` — unit tests with fake client

## Environment
```bash
INSTANTLY_API_KEY=your_v2_key
MILES_DRY_RUN=true
```

Keep `MILES_DRY_RUN=true` until Kevin approves live lead creation and campaign mutations.

## Install
```bash
pip install requests pytest
pytest tests/test_instantly_service.py
```

## Wire into MILES startup
```python
from miles_os.services.instantly.registry import register as register_instantly
register_instantly(service_registry)
```

## First operational uses
1. Read campaign inventory.
2. Read sending account inventory.
3. Health check API access.
4. Pull campaign analytics.
5. Add verified leads to campaigns in dry-run mode.
6. Pause unsafe campaigns with reason logging.
