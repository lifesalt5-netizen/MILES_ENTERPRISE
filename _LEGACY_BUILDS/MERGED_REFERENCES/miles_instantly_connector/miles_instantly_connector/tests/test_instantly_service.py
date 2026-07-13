from miles_os.services.instantly.service import InstantlyService


class FakeClient:
    def list_campaigns(self, limit=100, starting_after=None):
        return {"items": [{"id": "camp_1", "name": "Test Campaign"}]}

    def list_accounts(self, limit=100):
        return {"items": [{"email": "cora@example.com"}]}

    def create_lead(self, payload):
        return {"dry_run": True, "would_create_lead": payload}


def test_health_check_ok():
    service = InstantlyService(client=FakeClient())
    result = service.health_check()
    assert result.ok is True
    assert result.service == "instantly_connector"
    assert result.details["api_version"] == "v2"


def test_dashboard_snapshot_includes_campaigns_and_accounts():
    service = InstantlyService(client=FakeClient())
    snapshot = service.dashboard_snapshot()
    assert snapshot["health"]["ok"] is True
    assert "campaigns" in snapshot
    assert "accounts" in snapshot


def test_add_verified_lead_to_campaign_payload():
    service = InstantlyService(client=FakeClient())
    result = service.add_verified_lead_to_campaign(
        campaign_id="camp_1",
        email="lead@example.com",
        first_name="Jane",
        company_name="Acme",
        payload={"segment": "GSA_NO_SALES"},
    )
    lead = result["would_create_lead"]
    assert lead["campaign_id"] == "camp_1"
    assert lead["email"] == "lead@example.com"
    assert lead["payload"]["segment"] == "GSA_NO_SALES"
