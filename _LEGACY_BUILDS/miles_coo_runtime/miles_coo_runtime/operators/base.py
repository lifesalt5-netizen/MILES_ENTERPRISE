from datetime import datetime

class OperatorResult(dict):
    pass

class BaseOperator:
    name = "base"

    def run(self, context):
        raise NotImplementedError

    def result(self, status="ok", actions=None, approvals=None, notes=None):
        return OperatorResult({
            "operator": self.name,
            "status": status,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "actions": actions or [],
            "approvals": approvals or [],
            "notes": notes or []
        })
