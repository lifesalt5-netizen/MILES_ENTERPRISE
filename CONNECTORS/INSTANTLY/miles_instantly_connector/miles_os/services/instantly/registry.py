from __future__ import annotations
from .service import InstantlyService


def register(service_registry) -> InstantlyService:
    service = InstantlyService()
    service_registry.register(
        name=service.name,
        service=service,
        health_check=service.health_check,
        dashboard_snapshot=service.dashboard_snapshot,
    )
    return service
