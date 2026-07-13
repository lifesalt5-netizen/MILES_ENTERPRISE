from __future__ import annotations

from miles_desktop.models.entities import ApprovalLevel, Department, SystemRecord, WorkItem
from miles_desktop.storage.json_store import JsonStore
from miles_desktop.core.work_queue import WorkQueue


SYSTEMS = [
    SystemRecord("ORION", Department.ORION_OPS, "Contractor intelligence and executive demo data", "known"),
    SystemRecord("Instantly", Department.OUTBOUND_OPS, "Outbound campaigns, inbox rotation, warmup, replies", "needs_connected_api", ApprovalLevel.DAILY),
    SystemRecord("Namecheap", Department.OUTBOUND_OPS, "Domains and DNS for outbound infrastructure", "manual_login_required", ApprovalLevel.DAILY),
    SystemRecord("Google Workspace", Department.OUTBOUND_OPS, "Mailbox creation and routing", "manual_login_required", ApprovalLevel.DAILY),
    SystemRecord("IONOS Website", Department.WEBSITE_OPS, "pathways2gc.com website host", "manual_login_required", ApprovalLevel.DAILY),
    SystemRecord("Calendly", Department.SALES_OPS, "GovCon Win Probability Review booking", "known"),
    SystemRecord("LinkedIn", Department.SALES_OPS, "Founder profile and demand generation", "manual_login_required", ApprovalLevel.DAILY),
]

SEED_WORK = [
    WorkItem("Build Segment Inventory UI", Department.ENGINEERING_OPS, "Show segment name, lead count, verified email count, campaign status, enrichment and upload flags.", priority=95),
    WorkItem("Load Segment Inventory from CSV Folder", Department.OUTBOUND_OPS, "Scan authoritative segmentation folder and create campaign fill backlog.", system="Segment Inventory", priority=100),
    WorkItem("Create Website Change Queue", Department.WEBSITE_OPS, "Track approved website copy and CTA changes before publishing.", priority=80),
    WorkItem("Create Instantly Campaign Setup Queue", Department.OUTBOUND_OPS, "Prepare campaigns by segment, sender pool, daily limit, and upload status.", priority=90),
    WorkItem("ORION Demo Health Check", Department.EXECUTIVE_DEMO_OPS, "Verify contractor profile demo data availability and gaps.", priority=85),
]


def initialize(store: JsonStore) -> dict:
    store.save_all("systems", [s.to_dict() for s in SYSTEMS])
    queue = WorkQueue(store)
    created = [queue.add(item).to_dict() for item in SEED_WORK]
    return {"systems": len(SYSTEMS), "work_items": len(created)}
