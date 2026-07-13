from __future__ import annotations
import time
from typing import Any, Dict, Optional
import requests
from .config import InstantlyConfig


class InstantlyAPIError(RuntimeError):
    pass


class InstantlyClient:
    """Thin Instantly API v2 client. Keeps transport separate from business logic."""

    def __init__(self, config: Optional[InstantlyConfig] = None, session: Optional[requests.Session] = None):
        self.config = config or InstantlyConfig.from_env()
        self.session = session or requests.Session()
        if self.config.api_key:
            self.session.headers.update({"Authorization": f"Bearer {self.config.api_key}"})
        self.session.headers.update({"Content-Type": "application/json", "Accept": "application/json"})

    def request(self, method: str, path: str, *, params: Optional[Dict[str, Any]] = None,
                json: Optional[Dict[str, Any]] = None, retries: int = 2) -> Any:
        if not self.config.api_key:
            raise InstantlyAPIError("Missing INSTANTLY_API_KEY")
        url = f"{self.config.base_url}/{path.lstrip('/')}"
        last_error: Optional[Exception] = None
        for attempt in range(retries + 1):
            try:
                resp = self.session.request(method, url, params=params, json=json, timeout=self.config.timeout_seconds)
                if resp.status_code == 429 and attempt < retries:
                    time.sleep(2 ** attempt)
                    continue
                if resp.status_code >= 400:
                    raise InstantlyAPIError(f"Instantly API {resp.status_code}: {resp.text[:500]}")
                return resp.json() if resp.text else {}
            except requests.RequestException as exc:
                last_error = exc
                if attempt < retries:
                    time.sleep(2 ** attempt)
                    continue
        raise InstantlyAPIError(str(last_error))

    def list_campaigns(self, limit: int = 100, starting_after: Optional[str] = None) -> Any:
        params: Dict[str, Any] = {"limit": limit}
        if starting_after:
            params["starting_after"] = starting_after
        return self.request("GET", "/campaigns", params=params)

    def get_campaign(self, campaign_id: str) -> Any:
        return self.request("GET", f"/campaigns/{campaign_id}")

    def pause_campaign(self, campaign_id: str) -> Any:
        return self.request("POST", f"/campaigns/{campaign_id}/pause")

    def activate_campaign(self, campaign_id: str) -> Any:
        return self.request("POST", f"/campaigns/{campaign_id}/activate")

    def campaign_analytics(self, campaign_id: str) -> Any:
        return self.request("GET", "/campaigns/analytics", params={"id": campaign_id})

    def list_accounts(self, limit: int = 100) -> Any:
        return self.request("GET", "/accounts", params={"limit": limit})

    def test_account_vitals(self, emails: list[str]) -> Any:
        return self.request("POST", "/accounts/test/vitals", json={"emails": emails})

    def list_leads(self, filters: Dict[str, Any]) -> Any:
        return self.request("POST", "/leads/list", json=filters)

    def create_lead(self, payload: Dict[str, Any]) -> Any:
        if self.config.dry_run:
            return {"dry_run": True, "would_create_lead": payload}
        return self.request("POST", "/leads", json=payload)
