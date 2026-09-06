from dataclasses import asdict

from fastapi import FastAPI
from pydantic import BaseModel, Field

from bemse.telemetry import EventType, TelemetryEvent, identity_fingerprint, telemetry
from bemse.verification import verify_batch, verify_email

app = FastAPI(title="BEMSE API", version="0.1.0")


class VerifyRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    check_mx: bool = True


class BatchVerifyRequest(BaseModel):
    emails: list[str] = Field(min_length=1, max_length=10000)
    check_mx: bool = True


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


@app.get("/v1/telemetry/recent")
def recent_telemetry(limit: int = 100) -> dict:
    events = telemetry.snapshot(limit=limit)
    return {
        "count": len(events),
        "events": [event.model_dump(mode="json") for event in events],
    }
