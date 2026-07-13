from pathlib import Path
import os
from provider_requirements import PROVIDER_REQUIREMENTS

SECRET_MARK = '***SET***'

def _safe_value(key, value):
    if not value:
        return None
    if any(token in key.upper() for token in ['KEY', 'SECRET', 'TOKEN', 'PASSWORD']):
        return SECRET_MARK
    return value

def validate_provider(name, req):
    missing = []
    present = {}
    for key in req.get('required_env', []):
        value = os.environ.get(key)
        if value:
            present[key] = _safe_value(key, value)
        else:
            missing.append(key)

    checks = []
    if name == 'ORION':
        db_path = os.environ.get('ORION_DB_PATH') or req.get('known_default')
        checks.append({
            'check': 'orion_db_path_exists',
            'path': db_path,
            'passed': Path(db_path).exists() if db_path else False
        })

    if name == 'GOOGLE_WORKSPACE':
        service_file = os.environ.get('GOOGLE_SERVICE_ACCOUNT_FILE')
        if service_file:
            checks.append({
                'check': 'google_service_account_file_exists',
                'path': service_file,
                'passed': Path(service_file).exists()
            })

    ready = len(missing) == 0 and all(c.get('passed', True) for c in checks)
    return {
        'provider': name,
        'ready': ready,
        'present': present,
        'missing': missing,
        'checks': checks,
        'description': req.get('description')
    }

def validate_all():
    return {
        name: validate_provider(name, req)
        for name, req in PROVIDER_REQUIREMENTS.items()
    }
