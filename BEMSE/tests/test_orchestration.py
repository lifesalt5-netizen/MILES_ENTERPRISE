from bemse.orchestration import InboxRuntime, allocate_sends
from bemse.reputation import ReputationSignals


def healthy() -> ReputationSignals:
    return ReputationSignals(sent=1000, delivered=990, hard_bounces=3, replies=40)


def risky() -> ReputationSignals:
    return ReputationSignals(sent=1000, delivered=950, hard_bounces=22, soft_bounces=10)


def danger() -> ReputationSignals:
    return ReputationSignals(sent=1000, delivered=990, hard_bounces=2, complaints=5)


def test_allocator_prefers_healthiest_inbox() -> None:
    plan = allocate_sends(
        [
            InboxRuntime("risky", "google", 100, signals=risky()),
            InboxRuntime("healthy", "microsoft", 100, signals=healthy()),
        ],
        requested=80,
    )
    assert plan.allocated == 80
    assert plan.unallocated == 0
    assert plan.allocations[0].inbox_id == "healthy"
    assert plan.allocations[0].allocated == 80


def test_allocator_never_uses_paused_inbox() -> None:
    plan = allocate_sends(
        [
            InboxRuntime("danger", "google", 100, signals=danger()),
            InboxRuntime("healthy", "microsoft", 100, signals=healthy()),
        ],
        requested=60,
    )
    assert plan.allocated == 60
    danger_rows = [row for row in plan.allocations if row.inbox_id == "danger"]
    assert not danger_rows or danger_rows[0].allocated == 0


def test_allocator_respects_sent_today_and_caps() -> None:
    plan = allocate_sends(
        [InboxRuntime("healthy", "google", 100, sent_today=90, signals=healthy())],
        requested=50,
    )
    assert plan.allocated == 10
    assert plan.unallocated == 40


def test_disabled_inbox_is_excluded() -> None:
    plan = allocate_sends(
        [InboxRuntime("disabled", "google", 100, enabled=False, signals=healthy())],
        requested=25,
    )
    assert plan.allocated == 0
    assert plan.unallocated == 25
    assert plan.allocations == ()
