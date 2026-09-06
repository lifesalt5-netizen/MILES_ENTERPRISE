from pathlib import Path

import pytest

from bemse.persistence import CampaignState, InboxState, SQLiteStore
from bemse.runtime import GovernedSendRuntime


def test_plan_and_reserve_respects_campaign_and_inbox_caps(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "runtime.db")
    try:
        store.upsert_campaign(CampaignState("c1", "Test", status="ready", daily_cap=3))
        store.upsert_inbox(InboxState("i1", "google", "one@example.com", daily_cap=2))
        store.upsert_inbox(InboxState("i2", "microsoft", "two@example.com", daily_cap=2))
        runtime = GovernedSendRuntime(store)
        batch = runtime.plan("c1", 10)
        assert batch.plan.requested == 3
        assert batch.plan.allocated == 3
        assert runtime.reserve(batch) == 3
        assert store.get_campaign("c1").sent_today == 3
        assert sum(x.sent_today for x in store.list_inboxes()) == 3
        assert runtime.plan("c1", 10).plan.allocated == 0
    finally:
        store.close()


def test_draft_campaign_cannot_send(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "runtime.db")
    try:
        store.upsert_campaign(CampaignState("c1", "Draft", daily_cap=10))
        with pytest.raises(ValueError, match="not sendable"):
            GovernedSendRuntime(store).plan("c1", 1)
    finally:
        store.close()


def test_reservation_emits_audit_events(tmp_path: Path) -> None:
    store = SQLiteStore(tmp_path / "runtime.db")
    try:
        store.upsert_campaign(CampaignState("c1", "Test", status="running", daily_cap=1))
        store.upsert_inbox(InboxState("i1", "smtp", "one@example.com", daily_cap=1))
        runtime = GovernedSendRuntime(store)
        runtime.reserve(runtime.plan("c1", 1))
        assert len(list(store.iter_events("send.plan"))) == 1
        assert len(list(store.iter_events("send.reserve"))) == 1
    finally:
        store.close()
