from dataclasses import asdict

from fastapi import FastAPI
from pydantic import BaseModel, Field

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
    return asdict(verify_email(request.email, check_mx=request.check_mx))


@app.post("/v1/verify/batch")
def verify_many(request: BatchVerifyRequest) -> dict:
    results = verify_batch(request.emails, check_mx=request.check_mx)
    return {
        "count": len(results),
        "results": [asdict(result) for result in results],
    }
