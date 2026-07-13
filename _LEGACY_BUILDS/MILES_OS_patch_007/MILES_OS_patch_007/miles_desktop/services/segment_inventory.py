from __future__ import annotations

import csv
from pathlib import Path
from typing import Iterable, List

from miles_desktop.models.entities import SegmentRecord
from miles_desktop.storage.json_store import JsonStore


class SegmentInventoryService:
    COLLECTION = "segment_inventory"

    EMAIL_FIELDS = ("email", "Email", "contact_email", "Contact_Email", "Verified_Email", "Contact person's email")
    COMPANY_FIELDS = ("company", "Company", "legal_name", "Legal_Name", "vendor", "Vendor")

    def __init__(self, store: JsonStore):
        self.store = store

    def scan_folder(self, folder: str | Path) -> List[SegmentRecord]:
        folder = Path(folder)
        if not folder.exists():
            raise FileNotFoundError(folder)
        records: List[SegmentRecord] = []
        for csv_path in sorted(folder.glob("*.csv")):
            records.append(self.inspect_csv(csv_path))
        self.store.save_all(self.COLLECTION, [r.to_dict() for r in records])
        return records

    def inspect_csv(self, csv_path: str | Path) -> SegmentRecord:
        csv_path = Path(csv_path)
        lead_count = 0
        verified = 0
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            fieldnames = reader.fieldnames or []
            email_field = next((f for f in self.EMAIL_FIELDS if f in fieldnames), None)
            for row in reader:
                lead_count += 1
                if email_field and (row.get(email_field) or "").strip() and "@" in (row.get(email_field) or ""):
                    verified += 1
        needs_enrichment = verified == 0 or (lead_count > 0 and verified / lead_count < 0.25)
        needs_upload = verified > 0
        return SegmentRecord(
            segment_name=csv_path.stem,
            source_file=str(csv_path),
            lead_count=lead_count,
            verified_email_count=verified,
            needs_enrichment=needs_enrichment,
            needs_upload=needs_upload,
            priority=90 if "EXPIR" in csv_path.stem.upper() else 70 if "GSA" in csv_path.stem.upper() else 50,
        )

    def list(self) -> List[SegmentRecord]:
        return [SegmentRecord.from_dict(row) for row in self.store.list(self.COLLECTION)]

    def upsert_many(self, records: Iterable[SegmentRecord]) -> None:
        for record in records:
            self.store.upsert(self.COLLECTION, record.to_dict())
