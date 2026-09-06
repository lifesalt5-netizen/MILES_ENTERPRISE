from bemse.governance import GovernanceAction, decide_governance
from bemse.reputation import ReputationSignals, ReputationState, score_reputation


def test_healthy_reputation_allows_requested_volume() -> None:
    score = score_reputation(
        ReputationSignals(sent=1000, delivered=990, hard_bounces=5, soft_bounces=5, complaints=0, replies=50)
    )
    assert score.state is ReputationState.HEALTHY
    decision = decide_governance(score, 100)
    assert decision.action is GovernanceAction.ALLOW
    assert decision.max_daily_sends == 100


def test_elevated_bounces_trigger_throttle_or_pause() -> None:
    score = score_reputation(
        ReputationSignals(sent=1000, delivered=940, hard_bounces=25, soft_bounces=15, complaints=0)
    )
    assert score.state in {ReputationState.AT_RISK, ReputationState.DANGER}
    decision = decide_governance(score, 100)
    assert decision.action in {GovernanceAction.THROTTLE, GovernanceAction.PAUSE}
    assert decision.max_daily_sends <= 50


def test_complaints_force_danger_pause() -> None:
    score = score_reputation(
        ReputationSignals(sent=1000, delivered=990, hard_bounces=2, complaints=5)
    )
    assert score.state is ReputationState.DANGER
    decision = decide_governance(score, 100)
    assert decision.action is GovernanceAction.PAUSE
    assert decision.max_daily_sends == 0


def test_recent_pause_enters_recovery_mode() -> None:
    score = score_reputation(
        ReputationSignals(sent=1000, delivered=990, hard_bounces=2, complaints=0, recent_pause=True)
    )
    assert score.state is ReputationState.RECOVERING
    decision = decide_governance(score, 100)
    assert decision.action is GovernanceAction.RECOVERY_ONLY
    assert decision.max_daily_sends == 10


def test_no_history_starts_conservatively() -> None:
    score = score_reputation(ReputationSignals())
    assert score.score == 70
    assert score.state is ReputationState.AT_RISK
    assert "insufficient_send_history" in score.reasons
