# INT_001 Operating Procedure

1. Extract this package into the MILES OS folder.
2. Copy `config/orion_config.example.json` to `config/orion_config.json`.
3. Confirm the database path:

```text
D:\P2GC_Intelligence\Orion Demo 6126\orion_live_demo_ready\ORION_DEMO_LIVE_READY.db
```

4. Run:

```powershell
python src\run_orion_health.py
```

5. Review outputs:

- `reports/orion_health_report.json`
- `reports/orion_table_inventory.csv`
- `reports/orion_executive_brief.md`
- `reports/orion_mission_triggers.json`

This sprint is read-only by default.
