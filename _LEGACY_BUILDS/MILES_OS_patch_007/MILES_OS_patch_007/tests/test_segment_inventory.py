from miles_desktop.services.segment_inventory import SegmentInventoryService
from miles_desktop.storage.json_store import JsonStore


def test_segment_scan_counts_verified_email(tmp_path):
    csv_path = tmp_path / "GSA_NO_SALES.csv"
    csv_path.write_text("Company,email\nA,a@example.com\nB,\nC,c@example.com\n", encoding="utf-8")
    svc = SegmentInventoryService(JsonStore(tmp_path / "data"))
    record = svc.inspect_csv(csv_path)
    assert record.lead_count == 3
    assert record.verified_email_count == 2
    assert record.needs_upload is True
