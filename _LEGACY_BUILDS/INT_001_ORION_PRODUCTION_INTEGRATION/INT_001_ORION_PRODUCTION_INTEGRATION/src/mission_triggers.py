import json
from pathlib import Path
from datetime import datetime, timezone

def generate_mission_triggers(health):
    triggers = []

    if not health.get("connected"):
        triggers.append({
            "signal": "ORION_CONNECTION_FAILED",
            "severity": "HIGH",
            "mission": "Repair ORION Connection",
            "requires_kevin": False
        })

    for table, status in health.get("expected_tables", {}).items():
        if not status.get("exists"):
            triggers.append({
                "signal": "ORION_EXPECTED_TABLE_MISSING",
                "severity": "HIGH",
                "table": table,
                "mission": "Investigate ORION Schema Gap",
                "requires_kevin": False
            })
        elif status.get("row_count") in (0, None):
            triggers.append({
                "signal": "ORION_TABLE_EMPTY",
                "severity": "MEDIUM",
                "table": table,
                "mission": "Refresh ORION Dataset",
                "requires_kevin": False
            })

    if health.get("connected") and not triggers:
        triggers.append({
            "signal": "ORION_HEALTH_PASS",
            "severity": "INFO",
            "mission": "Continue Daily ORION Operations",
            "requires_kevin": False
        })

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "triggers": triggers
    }

def write_mission_triggers(triggers, output_path):
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(triggers, indent=2), encoding="utf-8")
    return path
