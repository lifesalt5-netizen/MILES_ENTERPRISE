from datetime import datetime
from pathlib import Path
import csv
import json

def write_inventory_csv(inventory, output_path):
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for item in inventory:
        rows.append({
            "table": item.get("table"),
            "row_count": item.get("row_count"),
            "column_count": item.get("column_count"),
            "columns": "|".join(item.get("columns", []))
        })
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["table", "row_count", "column_count", "columns"])
        writer.writeheader()
        writer.writerows(rows)
    return path

def generate_executive_brief(health, output_path):
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    lines = []
    lines.append("# ORION Executive Brief")
    lines.append("")
    lines.append(f"Generated: {datetime.now().isoformat()}")
    lines.append("")
    lines.append(f"Database: `{health.get('db_path')}`")
    lines.append(f"Connected: {'YES' if health.get('connected') else 'NO'}")
    lines.append("")

    lines.append("## Expected Table Status")
    lines.append("")
    for table, status in health.get("expected_tables", {}).items():
        exists = "YES" if status.get("exists") else "NO"
        rows = status.get("row_count")
        lines.append(f"- {table}: exists={exists}, rows={rows}")

    lines.append("")
    lines.append("## Issues")
    errs = health.get("errors") or []
    if errs:
        for err in errs:
            lines.append(f"- {err}")
    else:
        lines.append("- No blocking health errors detected.")

    path.write_text("\n".join(lines), encoding="utf-8")
    return path

def write_health_json(health, output_path):
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(health, indent=2), encoding="utf-8")
    return path
