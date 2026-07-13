from __future__ import annotations

from miles_desktop.models.entities import Department, WorkItem


class TwinRouter:
    DEFAULT_TWINS = {
        Department.EXECUTIVE_OPS: "Miles",
        Department.SALES_OPS: "Sophia",
        Department.OUTBOUND_OPS: "Evan",
        Department.WEBSITE_OPS: "Maya",
        Department.ORION_OPS: "Eleanor",
        Department.ENGINEERING_OPS: "Miles Builder",
        Department.EXECUTIVE_DEMO_OPS: "Eleanor",
        Department.GOV_INTEL_OPS: "Jeff",
        Department.KNOWLEDGE: "Miles Memory",
    }

    def assign(self, item: WorkItem) -> WorkItem:
        if not item.assigned_twin:
            item.assigned_twin = self.DEFAULT_TWINS.get(item.department, "Miles")
            item.add_event("assigned", f"Assigned to {item.assigned_twin}")
        return item
