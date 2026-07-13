import json
import os
from datetime import datetime
from operators.instantly import InstantlyOperator
from operators.website import WebsiteOperator
from operators.linkedin import LinkedInOperator
from operators.government_data import GovernmentDataOperator
from operators.executive import ExecutiveBriefOperator

ROOT = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(ROOT, "logs")
os.makedirs(LOG_DIR, exist_ok=True)

OPERATORS = [
    InstantlyOperator(),
    WebsiteOperator(),
    LinkedInOperator(),
    GovernmentDataOperator(),
]

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_log(report):
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = os.path.join(LOG_DIR, f"miles_cycle_{stamp}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    return path

def run_cycle():
    context = {
        "authority": load_json(os.path.join(ROOT, "config", "authority.json")),
        "systems": load_json(os.path.join(ROOT, "config", "systems.json")),
        "operator_results": []
    }
    for op in OPERATORS:
        result = op.run(context)
        context["operator_results"].append(result)

    executive = ExecutiveBriefOperator().run(context)
    report = {
        "cycle_started": datetime.utcnow().isoformat() + "Z",
        "mode": "MILES Digital COO MVP",
        "operator_results": context["operator_results"],
        "executive_brief": executive
    }
    log_path = save_log(report)
    report["log_path"] = log_path
    return report

if __name__ == "__main__":
    report = run_cycle()
    print(json.dumps(report, indent=2))
