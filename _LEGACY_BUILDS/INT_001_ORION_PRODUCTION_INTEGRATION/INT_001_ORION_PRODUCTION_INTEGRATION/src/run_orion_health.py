from config_loader import load_config
from health import run_health_check
from executive_report import write_health_json, write_inventory_csv, generate_executive_brief
from mission_triggers import generate_mission_triggers, write_mission_triggers
from pathlib import Path

def main():
    config = load_config()
    output_dir = Path(config.get("report_output_dir", "reports"))

    health = run_health_check(config)

    health_path = write_health_json(health, output_dir / "orion_health_report.json")
    inventory_path = write_inventory_csv(health.get("inventory", []), output_dir / "orion_table_inventory.csv")
    brief_path = generate_executive_brief(health, output_dir / "orion_executive_brief.md")

    triggers = generate_mission_triggers(health)
    triggers_path = write_mission_triggers(triggers, output_dir / "orion_mission_triggers.json")

    print("INT_001 ORION Production Integration")
    print(f"Connected: {health.get('connected')}")
    print(f"Health report: {health_path}")
    print(f"Inventory: {inventory_path}")
    print(f"Executive brief: {brief_path}")
    print(f"Mission triggers: {triggers_path}")

    if health.get("errors"):
        print("Errors:")
        for err in health["errors"]:
            print(f" - {err}")

if __name__ == "__main__":
    main()
