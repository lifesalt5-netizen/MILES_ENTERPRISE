from pathlib import Path
from db import connect_orion, fetch_all
from inventory import build_inventory

def run_health_check(config):
    db_path = config["orion_db_path"]
    read_only = config.get("read_only", True)
    expected_tables = config.get("expected_tables", [])

    result = {
        "db_path": db_path,
        "db_exists": Path(db_path).exists(),
        "connected": False,
        "expected_tables": {},
        "inventory": [],
        "errors": []
    }

    if not result["db_exists"]:
        result["errors"].append("Database path does not exist.")
        return result

    try:
        conn = connect_orion(db_path, read_only=read_only)
        result["connected"] = True

        result["inventory"] = build_inventory(conn)
        existing = {row["table"] for row in result["inventory"]}

        for table in expected_tables:
            result["expected_tables"][table] = {
                "exists": table in existing,
                "row_count": next((r["row_count"] for r in result["inventory"] if r["table"] == table), None)
            }

        conn.close()
    except Exception as e:
        result["errors"].append(str(e))

    return result
