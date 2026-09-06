from pathlib import Path

import pytest

from bemse.persistence import CampaignState, InboxState, SQLiteStore


def make_store(tmp_path: Path) -> SQLiteStore:
    return SQLiteStore(tmp_path / "bemse-test.db")


def test_inbox_round_trip_and_cap_enforcement(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    try:
        saved = store.upsert_inbox(
            InboxState(
                inbox_id="inbox-1",
                provider="google",
                email_address="sender@example.com",
                daily_cap=2,
                reputation_score=92.5,
            )
        )
        assert saved.updated_at
        loaded = store.get_inbox("inbox-1")
        assert loaded is not None
        assert loaded.provider == "google"
        assert loaded.reputation_score == 92.5

        assert store.increment_inbox_sent("inbox-1").sent_today == 1
        assert store.increment_inbox_sent("inbox-1").sent_today == 2
        with pytest.raises(ValueError):
            store.increment_inbox_sent("inbox-1")
    finally:
        store.close()


def test_campaign_round_trip(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    try:
        saved = store.upsert_campaign(
            CampaignState(
                campaign_id="campaign-1",
                name="Internal validation",
                status="ready",
                daily_cap=50,
                metadata={"segment": "test"},
            )
        )
        assert saved.updated_at
        loaded = store.get_campaign("campaign-1")
        assert loaded is not None
        assert loaded.status == "ready"
        assert loaded.metadata == {"segment": "test"}
    finally:
        store.close()


def test_suppression_is_durable(tmp_path: Path) -> None:
    path = tmp_path / "bemse-test.db"
    first = SQLiteStore(path)
    first.suppress("recipient-hash", "hard_bounce")
    first.close()

    second = SQLiteStore(path)
    try:
        assert second.is_suppressed("recipient-hash") is True
        assert second.is_suppressed("other") is False
    finally:
        second.close()


def test_telemetry_event_round_trip(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    try:
        event_id = store.append_event(
            "governance.decision",
            {"action": "throttle", "factor": 0.5},
            entity_type="inbox",
            entity_id="inbox-1",
        )
        events = list(store.iter_events("governance.decision"))
        assert event_id > 0
        assert len(events) == 1
        assert events[0]["entity_id"] == "inbox-1"
        assert events[0]["payload"]["action"] == "throttle"
    finally:
        store.close()


def test_enabled_inboxes_are_ranked_by_reputation(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    try:
        store.upsert_inbox(InboxState("low", "smtp", "low@example.com", 10, reputation_score=60))
        store.upsert_inbox(InboxState("high", "smtp", "high@example.com", 10, reputation_score=95))
        store.upsert_inbox(InboxState("off", "smtp", "off@example.com", 10, reputation_score=100, enabled=False))
        assert [x.inbox_id for x in store.list_inboxes(enabled_only=True)] == ["high", "low"]
    finally:
        store.close()
