from __future__ import annotations
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from .client import InstantlyClient, InstantlyAPIError
from .config import InstantlyConfig


@dataclass
class HealthResult:
    service: str
    ok: bool
    checked_at: str
    details: Dict[str, Any]


class InstantlyService:
    name = "instantly_connector"

    def __init__(self, client: Optional[InstantlyClient] = None):
        self.client = client or InstantlyClient()

    def health_check(self) -> HealthResult:
        checked_at = datetime.now(timezone.utc).isoformat()
        try:
            campaigns = self.client.list_campaigns(limit=1)
            accounts = self.client.list_accounts(limit=1)
            return HealthResult(self.name, True, checked_at, {
                "api_version": "v2",
                "campaigns_reachable": True,
                "accounts_reachable": True,
                "campaign_sample_type": type(campaigns).__name__,
                "account_sample_type": type(accounts).__name__,
            })
        except Exception as exc:
            return HealthResult(self.name, False, checked_at, {"error": str(exc)})

    def dashboard_snapshot(self) -> Dict[str, Any]:
        health = self.health_check()
        snapshot: Dict[str, Any] = {"service": self.name, "health": asdict(health)}
        if not health.ok:
            return snapshot
        snapshot["campaigns"] = self.client.list_campaigns(limit=25)
        snapshot["accounts"] = self.client.list_accounts(limit=100)
        return snapshot

    def safe_pause_campaign(self, campaign_id: str, reason: str) -> Dict[str, Any]:
        # Production guardrail: all campaign shutdowns return reason in event log payload.
        result = self.client.pause_campaign(campaign_id)
        return {"campaign_id": campaign_id, "action": "pause", "reason": reason, "result": result}

    def add_verified_lead_to_campaign(self, *, campaign_id: str, email: str, first_name: str = "",
                                      last_name: str = "", company_name: str = "",
                                      payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        lead_payload = {
            "campaign_id": campaign_id,
            "email": email,
            "first_name": first_name,
            "last_name": last_name,
            "company_name": company_name,
            "payload": payload or {},
        }
        return self.client.create_lead(lead_payload)
