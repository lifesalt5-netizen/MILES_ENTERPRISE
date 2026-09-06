from __future__ import annotations

from dataclasses import dataclass

from bemse.orchestration import AllocationPlan, InboxRuntime, allocate_sends
from bemse.persistence import SQLiteStore
from bemse.reputation import ReputationSignals


@dataclass(frozen=True)
class PlannedSendBatch:
    campaign_id: str
    plan: AllocationPlan


class GovernedSendRuntime:
    """Durable boundary between BEMSE state and send execution.

    Planning is side-effect free. Capacity is reserved only through `reserve`,
    which atomically advances persisted counters per inbox and records an audit
    event. Provider connectors should execute only quantities successfully
    reserved here.
    """

    def __init__(self, store: SQLiteStore) -> None:
        self.store = store

    def plan(
        self,
        campaign_id: str,
        requested: int,
        signals: dict[str, ReputationSignals] | None = None,
    ) -> PlannedSendBatch:
        campaign = self.store.get_campaign(campaign_id)
        if campaign is None:
            raise ValueError("campaign not found")
        if campaign.status not in {"ready", "running"}:
            raise ValueError("campaign is not sendable")

        campaign_remaining = max(0, campaign.daily_cap - campaign.sent_today)
        safe_request = min(max(0, requested), campaign_remaining)
        signal_map = signals or {}
        runtimes = [
            InboxRuntime(
                inbox_id=inbox.inbox_id,
                provider=inbox.provider,
                requested_daily_limit=inbox.daily_cap,
                sent_today=inbox.sent_today,
                enabled=inbox.enabled,
                signals=signal_map.get(inbox.inbox_id, ReputationSignals()),
            )
            for inbox in self.store.list_inboxes(enabled_only=True)
        ]
        plan = allocate_sends(runtimes, safe_request)
        self.store.append_event(
            "send.plan",
            {
                "requested": requested,
                "campaign_capacity": campaign_remaining,
                "allocated": plan.allocated,
                "unallocated": plan.unallocated,
            },
            entity_type="campaign",
            entity_id=campaign_id,
        )
        return PlannedSendBatch(campaign_id=campaign_id, plan=plan)

    def reserve(self, batch: PlannedSendBatch) -> int:
        """Reserve approved capacity before handing work to connectors."""
        reserved = 0
        for allocation in batch.plan.allocations:
            if allocation.allocated <= 0:
                continue
            self.store.increment_inbox_sent(allocation.inbox_id, allocation.allocated)
            reserved += allocation.allocated

        if reserved:
            self.store.increment_campaign_sent(batch.campaign_id, reserved)
        self.store.append_event(
            "send.reserve",
            {"reserved": reserved, "requested": batch.plan.requested},
            entity_type="campaign",
            entity_id=batch.campaign_id,
        )
        return reserved
