from pathlib import Path
import pandas as pd

ROOT = Path(r"D:\P2GC_Intelligence")

FILES = {
    "AWARDS": ROOT / "ORION_CORE" / "USA_Spending" / "OUTPUT" / "MASTER_PRIME.csv",
    "VA_FSS": ROOT / "ORION_CORE" / "SAM_Registry" / "SAM_PUBLIC_MONTHLY_V2_20260301" / "OUT_FILTERED" / "va_fss_holders.csv",
    "SEWP": ROOT / "ARCHIVE_2026_REVIEW" / "Good Files to use" / "SEWP VENDORS.csv",
    "OASIS": ROOT / "ARCHIVE_2026_REVIEW" / "Good Files to use" / "ORION_EXPANSION_ACTUAL_DATA_PULL" / "OTHER_CONTRACT_VEHICLES" / "OASIS_PLUS_Small_Business.csv",
}


def read_any(path):
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path, dtype=str, low_memory=False)
    return pd.read_excel(path, dtype=str)


def show(name, path):
    print("\n" + "=" * 90)
    print(name, path)
    if not path.exists():
        print("MISSING")
        return
    df = read_any(path)
    print("ROWS:", len(df))
    print("COLUMNS:", list(df.columns))
    print(df.head(5).to_string(index=False))

    if name == "AWARDS":
        fy = "action_date_fiscal_year"
        if fy in df.columns:
            vc = df[fy].astype(str).str.strip().value_counts(dropna=False).head(30)
            print("\nFY VALUE COUNTS TOP 30:")
            print(vc.to_string())
            print("\nFY SAMPLE UNIQUE:", df[fy].astype(str).str.strip().drop_duplicates().head(50).tolist())

        for c in ["recipient_uei", "recipient_name", "federal_action_obligation"]:
            if c in df.columns:
                print(f"{c} nonblank:", int(df[c].astype(str).str.strip().ne("").sum()))


for name, path in FILES.items():
    try:
        show(name, path)
    except Exception as e:
        print("\nERROR", name, e)
