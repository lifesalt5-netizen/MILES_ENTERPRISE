from fastapi.testclient import TestClient

from bemse.main import app


client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_reputation_api_scores_healthy_inbox() -> None:
    response = client.post(
        "/v1/reputation/score",
        json={
            "sent": 1000,
            "delivered": 990,
            "hard_bounces": 5,
            "soft_bounces": 5,
            "complaints": 0,
            "replies": 50,
            "inbox_id": "test-inbox",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "healthy"
    assert body["score"] >= 80


def test_governance_api_pauses_dangerous_sender() -> None:
    response = client.post(
        "/v1/governance/decide",
        json={
            "sent": 1000,
            "delivered": 990,
            "hard_bounces": 2,
            "complaints": 5,
            "requested_daily_sends": 100,
            "inbox_id": "danger-inbox",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["reputation"]["state"] == "danger"
    assert body["decision"]["action"] == "pause"
    assert body["decision"]["max_daily_sends"] == 0


def test_governance_api_limits_recovery_sender() -> None:
    response = client.post(
        "/v1/governance/decide",
        json={
            "sent": 1000,
            "delivered": 990,
            "hard_bounces": 2,
            "recent_pause": True,
            "requested_daily_sends": 100,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["decision"]["action"] == "recovery_only"
    assert body["decision"]["max_daily_sends"] == 10
