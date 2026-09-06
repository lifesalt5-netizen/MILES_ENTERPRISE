from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class ReputationState(str, Enum):
    HEALTHY = "healthy"
    AT_RISK = "at_risk"
    DANGER = "danger"
    RECOVERING = "recovering"


@dataclass(frozen=True)
class ReputationSignals:
    sent: int = 0
    delivered: int = 0
    hard_bounces: int = 0
    soft_bounces: int = 0
    complaints: int = 0
    unsubscribes: int = 0
    replies: int = 0
    recent_pause: bool = False


@dataclass(frozen=True)
class ReputationScore:
    score: int
    state: ReputationState
    bounce_rate: float
    complaint_rate: float
    delivery_rate: float
    reply_rate: float
    reasons: tuple[str, ...]


def _rate(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return max(0.0, numerator / denominator)


def score_reputation(signals: ReputationSignals) -> ReputationScore:
    """Compute a conservative 0-100 reputation score.

    V1 intentionally favors infrastructure protection over send volume. It is deterministic and
    explainable so future telemetry-trained models can be compared against a stable baseline.
    """
    sent = max(0, signals.sent)
    delivered = max(0, min(signals.delivered, sent)) if sent else 0
    hard_bounce_rate = _rate(max(0, signals.hard_bounces), sent)
    soft_bounce_rate = _rate(max(0, signals.soft_bounces), sent)
    complaint_rate = _rate(max(0, signals.complaints), delivered or sent)
    unsubscribe_rate = _rate(max(0, signals.unsubscribes), delivered or sent)
    reply_rate = _rate(max(0, signals.replies), delivered or sent)
    delivery_rate = _rate(delivered, sent)

    score = 100.0
    reasons: list[str] = []

    if sent == 0:
        score = 70.0
        reasons.append("insufficient_send_history")

    if sent:
        score -= min(55.0, hard_bounce_rate * 900.0)
        score -= min(18.0, soft_bounce_rate * 180.0)
        score -= min(70.0, complaint_rate * 20_000.0)
        score -= min(20.0, unsubscribe_rate * 500.0)

        if delivery_rate < 0.90:
            score -= min(25.0, (0.90 - delivery_rate) * 100.0)
            reasons.append("low_delivery_rate")
        if hard_bounce_rate >= 0.02:
            reasons.append("hard_bounce_rate_elevated")
        if complaint_rate >= 0.001:
            reasons.append("complaint_rate_elevated")
        if unsubscribe_rate >= 0.01:
            reasons.append("unsubscribe_rate_elevated")
        if reply_rate >= 0.03:
            score += min(5.0, reply_rate * 40.0)
            reasons.append("positive_reply_signal")

    if signals.recent_pause:
        score = min(score, 64.0)
        reasons.append("recent_governance_pause")

    final_score = int(round(max(0.0, min(100.0, score))))

    if signals.recent_pause and final_score >= 45:
        state = ReputationState.RECOVERING
    elif final_score >= 80:
        state = ReputationState.HEALTHY
    elif final_score >= 55:
        state = ReputationState.AT_RISK
    else:
        state = ReputationState.DANGER

    return ReputationScore(
        score=final_score,
        state=state,
        bounce_rate=round(hard_bounce_rate + soft_bounce_rate, 6),
        complaint_rate=round(complaint_rate, 6),
        delivery_rate=round(delivery_rate, 6),
        reply_rate=round(reply_rate, 6),
        reasons=tuple(dict.fromkeys(reasons)),
    )
