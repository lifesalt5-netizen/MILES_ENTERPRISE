from .base import BaseOperator

class ExecutiveBriefOperator(BaseOperator):
    name = "executive_brief"

    def run(self, context):
        prior = context.get("operator_results", [])
        actions = [f"Compile executive brief from {len(prior)} operator results"]
        approvals = []
        for r in prior:
            approvals.extend(r.get("approvals", []))
        return self.result(actions=actions, approvals=approvals, notes=["Brief includes completed actions, blockers, and CEO approvals only."])
