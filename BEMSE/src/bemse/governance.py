from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from bemse.reputation import ReputationScore, ReputationState


class GovernanceAction(str, Enum):
    ALLOW = "allow"
    THROTTLE = "throttle"
    PAUSE = "pause"
    RECOVERY_ONLY = "recovery_only"


@dataclass(frozen=True)
class GovernanceDecision:
    action: GovernanceAction
    max_daily_sends: int | None
    reason: str


def decide_governance(
    reputation: ReputationScore,
    requested_daily_sends: int,
) -> GovernanceDecision:
    """Map reputation health to a deterministic protective sending policy.

    The policy is deliberately conservative. It can later be replaced or augmented by learned
    policies, but BEMSE always keeps a hard safety floor that favors infrastructure health and
    reputation over raw volume.
    """
    requested = max(0, requested_daily_sends)

    if reputation.state is ReputationState.DANGER or reputation.score < 45:
        return GovernanceDecision(
            action=GovernanceAction.PAUSE,
            max_daily_sends=0,
            reason="reputation_danger_pause",
        )

    if reputation.state is ReputationState.RECOVERING:
        return GovernanceDecision(
            action=GovernanceAction.RECOVERY_ONLY,
            max_daily_sends=min(requested, 10),
            reason="recovery_mode_limited_sends",
        )

    if reputation.state is ReputationState.AT_RISK or reputation.score < 80:
        return GovernanceDecision(
            action=GovernanceAction.THROTTLE,
            max_daily_sends=min(requested, max(5, int(requested * 0.5))),
            reason="reputation_at_risk_throttle",
        )

    return GovernanceDecision(
        action=GovernanceAction.ALLOW,
        max_daily_sends=requested,
        reason="reputation_healthy",
    )
