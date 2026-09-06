from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from enum import Enum
import hashlib
from threading import Lock
from typing import Any, Protocol
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class EventType(str, Enum):
    EMAIL_VERIFICATION_COMPLETED = "email.verification.completed"
    EMAIL_VERIFICATION_BATCH_COMPLETED = "email.verification.batch_completed"
    GOVERNANCE_ACTION = "governance.action"
    REPUTATION_SCORE_CHANGED = "reputation.score_changed"
    SEND_ATTEMPTED = "send.attempted"
    SEND_RESULT = "send.result"


class TelemetryEvent(BaseModel):
    event_id: UUID = Field(default_factory=uuid4)
    event_type: EventType
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    schema_version: int = 1
    source: str = "bemse-api"
    tenant_id: str | None = None
    campaign_id: str | None = None
    inbox_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class TelemetrySink(Protocol):
    def emit(self, event: TelemetryEvent) -> None: ...


class InMemoryTelemetrySink:
    """Bounded, thread-safe MVP sink.

    This intentionally avoids a paid dependency while preserving the event contract that can
    later fan out to ClickHouse, PostgreSQL, Kafka/RabbitMQ, or object storage without changing
    producer code.
    """

    def __init__(self, max_events: int = 10_000) -> None:
        self._events: deque[TelemetryEvent] = deque(maxlen=max_events)
        self._lock = Lock()

    def emit(self, event: TelemetryEvent) -> None:
        with self._lock:
            self._events.append(event)

    def snapshot(self, limit: int = 100) -> list[TelemetryEvent]:
        safe_limit = max(0, min(limit, len(self._events)))
        with self._lock:
            return list(self._events)[-safe_limit:] if safe_limit else []

    def count(self) -> int:
        with self._lock:
            return len(self._events)


def identity_fingerprint(value: str) -> str:
    """Stable privacy-preserving identifier for telemetry correlation.

    Raw recipient addresses should not be copied into high-volume telemetry unless there is a
    specific operational need and retention policy. The transactional system can keep the source
    record while analytics correlates by this fingerprint.
    """
    normalized = value.strip().lower().encode("utf-8")
    return hashlib.sha256(normalized).hexdigest()


telemetry = InMemoryTelemetrySink()
