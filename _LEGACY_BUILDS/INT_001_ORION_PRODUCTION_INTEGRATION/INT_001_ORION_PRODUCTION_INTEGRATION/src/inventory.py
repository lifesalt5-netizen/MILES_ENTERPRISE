from db import fetch_all

def list_tables(conn):
    return fetch_all(conn, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")

def table_count(conn, table):
    try:
        row = fetch_all(conn, f'SELECT COUNT(*) AS row_count FROM "{table}"')[0]
        return row["row_count"]
    except Exception as e:
        return {"error": str(e)}

def table_columns(conn, table):
    try:
        return fetch_all(conn, f'PRAGMA table_info("{table}")')
    except Exception as e:
        return [{"error": str(e)}]

def build_inventory(conn):
    tables = [r["name"] for r in list_tables(conn)]
    inventory = []
    for table in tables:
        count = table_count(conn, table)
        cols = table_columns(conn, table)
        inventory.append({
            "table": table,
            "row_count": count,
            "column_count": len(cols) if isinstance(cols, list) else None,
            "columns": [c.get("name") for c in cols if isinstance(c, dict) and "name" in c]
        })
    return inventory
