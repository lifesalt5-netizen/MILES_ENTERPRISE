from __future__ import annotations

from dataclasses import dataclass

from bemse.governance import GovernanceAction, decide_governance
from bemse.reputation import ReputationSignals, ReputationState, score_reputation


@dataclass(frozen=True)
class InboxRuntime:
    inbox_id: str
    provider: str
    requested_daily_limit: int
    sent_today: int = 0
    enabled: bool = True
    signals: ReputationSignals = ReputationSignals()


@dataclass(frozen=True)
class SendAllocation:
    inbox_id: str
    provider: str
    reputation_score: int
    reputation_state: ReputationState
    governance_action: GovernanceAction
    remaining_capacity: int
    allocated: int
    reason: str


@dataclass(frozen=True)
class AllocationPlan:
    requested: int
    allocated: int
    unallocated: int
    allocations: tuple[SendAllocation, ...]


def allocate_sends(inboxes: list[InboxRuntime], requested: int) -> AllocationPlan:
    """Allocate send volume across inboxes without exceeding governance limits.

    V1 uses reputation-first ordering and never allocates to paused/disabled infrastructure.
    This core is provider-agnostic; provider connectors only execute an already-approved plan.
    """
    requested = max(0, requested)
    remaining = requested
    evaluated: list[tuple[InboxRuntime, object, object, int]] = []

    for inbox in inboxes:
        if not inbox.enabled:
            continue
        reputation = score_reputation(inbox.signals)
        decision = decide_governance(reputation, inbox.requested_daily_limit)
        cap = max(0, decision.max_daily_sends or 0)
        remaining_capacity = max(0, cap - max(0, inbox.sent_today))
        evaluated.append((inbox, reputation, decision, remaining_capacity))

    # Infrastructure with the strongest current reputation carries traffic first.
    evaluated.sort(key=lambda item: (item[1].score, item[3]), reverse=True)

    allocations: list[SendAllocation] = []
    for inbox, reputation, decision, capacity in evaluated:
        if remaining <= 0:
            break
        allocated = 0
        if decision.action is not GovernanceAction.PAUSE and capacity > 0:
            allocated = min(capacity, remaining)
            remaining -= allocated

        allocations.append(
            SendAllocation(
                inbox_id=inbox.inbox_id,
                provider=inbox.provider,
                reputation_score=reputation.score,
                reputation_state=reputation.state,
                governance_action=decision.action,
                remaining_capacity=capacity,
                allocated=allocated,
                reason=decision.reason,
            )
        )

    return AllocationPlan(
        requested=requested,
        allocated=requested - remaining,
        unallocated=remaining,
        allocations=tuple(allocations),
    )
