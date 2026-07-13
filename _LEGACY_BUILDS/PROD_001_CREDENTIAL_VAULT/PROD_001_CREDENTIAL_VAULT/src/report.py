import json
from datetime import datetime, timezone
from pathlib import Path

def readiness_score(results):
    total = len(results)
    ready = sum(1 for r in results.values() if r['ready'])
    return round((ready / total) * 100, 2) if total else 0

def write_report(results, output='reports/provider_readiness_report.json'):
    path = Path(output)
    path.parent.mkdir(parents=True, exist_ok=True)
    report = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'readiness_score': readiness_score(results),
        'providers': results
    }
    path.write_text(json.dumps(report, indent=2), encoding='utf-8')
    return path
