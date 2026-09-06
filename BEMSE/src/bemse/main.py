from dataclasses import asdict

from fastapi import FastAPI
from pydantic import BaseModel, Field

from bemse.governance import decide_governance
from bemse.reputation import ReputationSignals, score_reputation
from bemse.telemetry import EventType, TelemetryEvent, identity_fingerprint, telemetry
from bemse.verification import verify_batch, verify_email

app = FastAPI(title="BEMSE API", version="0.2.0")


class VerifyRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    check_mx: bool = True


class BatchVerifyRequest(BaseModel):
    emails: list[str] = Field(min_length=1, max_length=10000)
    check_mx: bool = True


class ReputationRequest(BaseModel):
    sent: int = Field(default=0, ge=0)
    delivered: int = Field(default=0, ge=0)
    hard_bounces: int = Field(default=0, ge=0)
    soft_bounces: int = Field(default=0, ge=0)
    complaints: int = Field(default=0, ge=0)
    unsubscribes: int = Field(default=0, ge=0)
    replies: int = Field(default=0, ge=0)
    recent_pause: bool = False
    inbox_id: str | None = None


class GovernanceRequest(ReputationRequest):
    requested_daily_sends: int = Field(default=0, ge=0)


def _signals(request: ReputationRequest) -> ReputationSignals:
    return ReputationSignals(
        sent=request.sent,
        delivered=request.delivered,
        hard_bounces=request.hard_bounces,
        soft_bounces=request.soft_bounces,
        complaints=request.complaints,
        unsubscribes=request.unsubscribes,
        replies=request.replies,
        recent_pause=request.recent_pause,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "bemse-api"}


@app.post("/v1/verify")
def verify(request: VerifyRequest) -> dict:
    result = verify_email(request.email, check_mx=request.check_mx)
    telemetry.emit(
        TelemetryEvent(
            event_type=EventType.EMAIL_VERIFICATION_COMPLETED,
            payload={
                "recipient_fingerprint": identity_fingerprint(result.email),
                "status": result.status.value,
                "confidence": result.confidence,
                "mail_route": result.mail_route.value,
                "disposable": result.disposable,
                "role_account": result.role_account,
                "reasons": result.reasons,
            },
        )
    )
    return asdict(result)


@app.post("/v1/verify/batch")
def verify_many(request: BatchVerifyRequest) -> dict:
    results = verify_batch(request.emails, check_mx=request.check_mx)
    counts = {"valid": 0, "risky": 0, "invalid": 0}
    for result in results:
        counts[result.status.value] += 1

    telemetry.emit(
        TelemetryEvent(
            event_type=EventType.EMAIL_VERIFICATION_BATCH_COMPLETED,
            payload={
                "count": len(results),
                "status_counts": counts,
                "check_mx": request.check_mx,
            },
        )
    )
    return {
        "count": len(results),
        "status_counts": counts,
        "results": [asdict(result) for result in results],
    }


@app.post("/v1/reputation/score")
def reputation_score(request: ReputationRequest) -> dict:
    result = score_reputation(_signals(request))
    telemetry.emit(
        TelemetryEvent(
            event_type=EventType.REPUTATION_SCORE_CHANGED,
            inbox_id=request.inbox_id,
            payload={
                "score": result.score,
                "state": result.state.value,
                "bounce_rate": result.bounce_rate,
                "complaint_rate": result.complaint_rate,
                "delivery_rate": result.delivery_rate,
                "reply_rate": result.reply_rate,
                "reasons": list(result.reasons),
            },
        )
    )
    return asdict(result)


@app.post("/v1/governance/decide")
def governance_decision(request: GovernanceRequest) -> dict:
    reputation = score_reputation(_signals(request))
    decision = decide_governance(reputation, request.requested_daily_sends)
    telemetry.emit(
        TelemetryEvent(
            event_type=EventType.GOVERNANCE_ACTION,
            inbox_id=request.inbox_id,
            payload={
                "action": decision.action.value,
                "max_daily_sends": decision.max_daily_sends,
                "reason": decision.reason,
                "reputation_score": reputation.score,
                "reputation_state": reputation.state.value,
            },
        )
    )
    return {
        "reputation": asdict(reputation),
        "decision": asdict(decision),
    }


@app.get("/v1/telemetry/recent")
def recent_telemetry(limit: int = 100) -> dict:
    events = telemetry.snapshot(limit=limit)
    return {
        "count": len(events),
        "events": [event.model_dump(mode="json") for event in events],
    }
