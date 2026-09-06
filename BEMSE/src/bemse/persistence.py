from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any, Iterable


@dataclass(frozen=True)
class InboxState:
    inbox_id: str
    provider: str
    email_address: str
    daily_cap: int
    sent_today: int = 0
    reputation_score: float = 100.0
    status: str = "healthy"
    enabled: bool = True
    updated_at: str = ""


@dataclass(frozen=True)
class CampaignState:
    campaign_id: str
    name: str
    status: str = "draft"
    daily_cap: int = 0
    sent_today: int = 0
    metadata: dict[str, Any] | None = None
    updated_at: str = ""


class SQLiteStore:
    """Zero-cost durable MVP persistence.

    SQLite is intentionally used for the first internal BEMSE build so the
    product can run locally without paid infrastructure. The public methods
    form a narrow repository boundary that can later be backed by PostgreSQL
    without changing the engines that consume it.
    """

    def __init__(self, path: str | Path = "bemse.db") -> None:
        self.path = str(path)
        self._lock = RLock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock, self._conn:
            self._conn.executescript(
                """
                PRAGMA journal_mode=WAL;
                PRAGMA foreign_keys=ON;

                CREATE TABLE IF NOT EXISTS inboxes (
                    inbox_id TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    email_address TEXT NOT NULL,
                    daily_cap INTEGER NOT NULL CHECK (daily_cap >= 0),
                    sent_today INTEGER NOT NULL DEFAULT 0 CHECK (sent_today >= 0),
                    reputation_score REAL NOT NULL DEFAULT 100,
                    status TEXT NOT NULL DEFAULT 'healthy',
                    enabled INTEGER NOT NULL DEFAULT 1,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS campaigns (
                    campaign_id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'draft',
                    daily_cap INTEGER NOT NULL DEFAULT 0 CHECK (daily_cap >= 0),
                    sent_today INTEGER NOT NULL DEFAULT 0 CHECK (sent_today >= 0),
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS suppression (
                    recipient_key TEXT PRIMARY KEY,
                    reason TEXT NOT NULL,
                    source TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS telemetry_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    entity_type TEXT,
                    entity_id TEXT,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_telemetry_event_type_created
                ON telemetry_events(event_type, created_at);
                """
            )

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def upsert_inbox(self, inbox: InboxState) -> InboxState:
        updated_at = inbox.updated_at or self._now()
        with self._lock, self._conn:
            self._conn.execute(
                """
                INSERT INTO inboxes (
                    inbox_id, provider, email_address, daily_cap, sent_today,
                    reputation_score, status, enabled, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(inbox_id) DO UPDATE SET
                    provider=excluded.provider,
                    email_address=excluded.email_address,
                    daily_cap=excluded.daily_cap,
                    sent_today=excluded.sent_today,
                    reputation_score=excluded.reputation_score,
                    status=excluded.status,
                    enabled=excluded.enabled,
                    updated_at=excluded.updated_at
                """,
                (
                    inbox.inbox_id,
                    inbox.provider,
                    inbox.email_address,
                    inbox.daily_cap,
                    inbox.sent_today,
                    inbox.reputation_score,
                    inbox.status,
                    int(inbox.enabled),
                    updated_at,
                ),
            )
        return InboxState(**{**asdict(inbox), "updated_at": updated_at})

    def get_inbox(self, inbox_id: str) -> InboxState | None:
        row = self._conn.execute(
            "SELECT * FROM inboxes WHERE inbox_id = ?", (inbox_id,)
        ).fetchone()
        if row is None:
            return None
        return InboxState(
            inbox_id=row["inbox_id"],
            provider=row["provider"],
            email_address=row["email_address"],
            daily_cap=row["daily_cap"],
            sent_today=row["sent_today"],
            reputation_score=row["reputation_score"],
            status=row["status"],
            enabled=bool(row["enabled"]),
            updated_at=row["updated_at"],
        )

    def list_inboxes(self, enabled_only: bool = False) -> list[InboxState]:
        sql = "SELECT inbox_id FROM inboxes"
        if enabled_only:
            sql += " WHERE enabled = 1"
        sql += " ORDER BY reputation_score DESC, inbox_id"
        rows = self._conn.execute(sql).fetchall()
        return [self.get_inbox(row["inbox_id"]) for row in rows if row]

    def increment_inbox_sent(self, inbox_id: str, amount: int = 1) -> InboxState:
        if amount < 0:
            raise ValueError("amount must be non-negative")
        with self._lock, self._conn:
            cursor = self._conn.execute(
                """
                UPDATE inboxes
                SET sent_today = sent_today + ?, updated_at = ?
                WHERE inbox_id = ? AND sent_today + ? <= daily_cap
                """,
                (amount, self._now(), inbox_id, amount),
            )
            if cursor.rowcount != 1:
                raise ValueError("inbox missing or daily cap would be exceeded")
        result = self.get_inbox(inbox_id)
        assert result is not None
        return result

    def upsert_campaign(self, campaign: CampaignState) -> CampaignState:
        updated_at = campaign.updated_at or self._now()
        metadata = campaign.metadata or {}
        with self._lock, self._conn:
            self._conn.execute(
                """
                INSERT INTO campaigns (
                    campaign_id, name, status, daily_cap, sent_today,
                    metadata_json, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(campaign_id) DO UPDATE SET
                    name=excluded.name,
                    status=excluded.status,
                    daily_cap=excluded.daily_cap,
                    sent_today=excluded.sent_today,
                    metadata_json=excluded.metadata_json,
                    updated_at=excluded.updated_at
                """,
                (
                    campaign.campaign_id,
                    campaign.name,
                    campaign.status,
                    campaign.daily_cap,
                    campaign.sent_today,
                    json.dumps(metadata, sort_keys=True),
                    updated_at,
                ),
            )
        return CampaignState(**{**asdict(campaign), "metadata": metadata, "updated_at": updated_at})

    def get_campaign(self, campaign_id: str) -> CampaignState | None:
        row = self._conn.execute(
            "SELECT * FROM campaigns WHERE campaign_id = ?", (campaign_id,)
        ).fetchone()
        if row is None:
            return None
        return CampaignState(
            campaign_id=row["campaign_id"],
            name=row["name"],
            status=row["status"],
            daily_cap=row["daily_cap"],
            sent_today=row["sent_today"],
            metadata=json.loads(row["metadata_json"]),
            updated_at=row["updated_at"],
        )

    def suppress(self, recipient_key: str, reason: str, source: str = "system") -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """
                INSERT INTO suppression(recipient_key, reason, source, created_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(recipient_key) DO UPDATE SET
                    reason=excluded.reason,
                    source=excluded.source,
                    created_at=excluded.created_at
                """,
                (recipient_key, reason, source, self._now()),
            )

    def is_suppressed(self, recipient_key: str) -> bool:
        row = self._conn.execute(
            "SELECT 1 FROM suppression WHERE recipient_key = ?", (recipient_key,)
        ).fetchone()
        return row is not None

    def append_event(
        self,
        event_type: str,
        payload: dict[str, Any],
        *,
        entity_type: str | None = None,
        entity_id: str | None = None,
    ) -> int:
        with self._lock, self._conn:
            cursor = self._conn.execute(
                """
                INSERT INTO telemetry_events(
                    event_type, entity_type, entity_id, payload_json, created_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    event_type,
                    entity_type,
                    entity_id,
                    json.dumps(payload, sort_keys=True),
                    self._now(),
                ),
            )
            return int(cursor.lastrowid)

    def iter_events(self, event_type: str | None = None) -> Iterable[dict[str, Any]]:
        if event_type:
            rows = self._conn.execute(
                "SELECT * FROM telemetry_events WHERE event_type = ? ORDER BY id",
                (event_type,),
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM telemetry_events ORDER BY id"
            ).fetchall()
        for row in rows:
            yield {
                "id": row["id"],
                "event_type": row["event_type"],
                "entity_type": row["entity_type"],
                "entity_id": row["entity_id"],
                "payload": json.loads(row["payload_json"]),
                "created_at": row["created_at"],
            }
