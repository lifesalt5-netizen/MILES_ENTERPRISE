import csv, json, glob, os
from pathlib import Path
from collections import defaultdict

ROOT = Path(os.environ.get('MILES_ROOT', r'C:\P2GC_Intelligence\MILES_ENTERPRISE'))
ROSTER = ROOT / 'DATA' / 'staging' / 'government_data' / 'K7F_VA_FSS_BULK_AWARD_REFRESH' / 'VA_FSS_CONTRACT_ROSTER.csv'
SCHEDULE_DIR = Path(r'C:\P2GC_Intelligence\SAM_Registry\VA')
OUT_DIR = ROOT / 'DATA' / 'OUTBOUND' / 'FEDERAL_VA_FSS_GOVERNED'
OUT_CSV = OUT_DIR / 'FEDERAL_VA_FSS_MASTER_CLEAN.csv'
OUT_JSON = OUT_DIR / 'FEDERAL_VA_FSS_MASTER_CLEAN_SUMMARY.json'

# Hard namespace rule: this script is FEDERAL VA/FSS only.
# It never reads STATE_SLED data and never emits STATE_SLED - VA assignments.


def norm(v):
    return str(v or '').strip()


def low(v):
    return norm(v).lower()


def read_csv(path):
    with open(path, 'r', encoding='utf-8-sig', newline='') as f:
        return list(csv.DictReader(f))


def first_nonblank(*values):
    for v in values:
        if norm(v):
            return norm(v)
    return ''


def schedule_flags(row):
    return {
        'small_business': norm(row.get('Small \nBusiness - s')),
        'woman_owned': norm(row.get('Woman Owned - w')),
        'wosb': norm(row.get('Women Owned (WOSB) - wo')),
        'edwosb': norm(row.get('Women Owned (EDWOSB) - ew')),
        'veteran_owned': norm(row.get('Veteran Owned - v')),
        'sdvosb': norm(row.get('Service Disabled Veteran Owned - dv')),
        'small_disadvantaged': norm(row.get('Small Disadv - d')),
        'eight_a': norm(row.get('8(a) - 8a')),
        'hubzone': norm(row.get('Hub \nZone - h')),
    }


def main():
    if not ROSTER.exists():
        raise FileNotFoundError(f'Missing roster: {ROSTER}')

    roster_rows = read_csv(ROSTER)
    roster_by_contract = {norm(r.get('contract_number')).upper(): r for r in roster_rows if norm(r.get('contract_number'))}

    schedule_files = sorted(glob.glob(str(SCHEDULE_DIR / 'schedule_65*.csv')))
    schedule_rows = []
    for file in schedule_files:
        for row in read_csv(file):
            row['_schedule_file'] = os.path.basename(file)
            schedule_rows.append(row)

    by_contract = defaultdict(list)
    for row in schedule_rows:
        c = norm(row.get('Contract #')).upper()
        if c:
            by_contract[c].append(row)

    all_contracts = sorted(set(roster_by_contract) | set(by_contract))
    output = []

    for contract in all_contracts:
        roster = roster_by_contract.get(contract, {})
        sched = by_contract.get(contract, [])
        primary = sched[0] if sched else {}

        vendors = sorted({norm(x.get('Vendor')) for x in sched if norm(x.get('Vendor'))})
        emails = sorted({low(x.get('Email')) for x in sched if norm(x.get('Email'))})
        phones = sorted({norm(x.get('Phone')) for x in sched if norm(x.get('Phone'))})
        urls = sorted({norm(x.get('URL')) for x in sched if norm(x.get('URL'))})
        ueis = sorted({norm(x.get('SAM UEI')).upper() for x in sched if norm(x.get('SAM UEI'))})
        schedule_sources = sorted({norm(x.get('_schedule_file')) for x in sched if norm(x.get('_schedule_file'))})
        categories = sorted({norm(x.get('Category')) for x in sched if norm(x.get('Category'))})
        subcategories = sorted({norm(x.get('Sub Category')) for x in sched if norm(x.get('Sub Category'))})

        flags = schedule_flags(primary) if primary else {
            'small_business':'','woman_owned':'','wosb':'','edwosb':'','veteran_owned':'','sdvosb':'','small_disadvantaged':'','eight_a':'','hubzone':''
        }

        row = {
            'namespace': 'FEDERAL_VA_FSS',
            'federal_agency': 'U.S. Department of Veterans Affairs',
            'contract_number': contract,
            'vendor': first_nonblank(roster.get('vendor'), vendors[0] if vendors else ''),
            'sam_uei': ueis[0] if len(ueis) == 1 else '',
            'sam_uei_status': 'SCHEDULE_EXACT_CONTRACT' if len(ueis) == 1 else ('MULTIPLE_UEIS_FOR_CONTRACT' if len(ueis) > 1 else 'UNRESOLVED'),
            'sin': first_nonblank(roster.get('sin')),
            'email': '; '.join(emails),
            'phone': '; '.join(phones),
            'url': '; '.join(urls),
            'current_option_period_end_date': first_nonblank(*[x.get('Current Option Period End Date') for x in sched]),
            'ultimate_contract_end_date': first_nonblank(*[x.get('Ultimate Contract End Date') for x in sched]),
            'schedule_sources': '; '.join(schedule_sources),
            'categories': '; '.join(categories),
            'subcategories': '; '.join(subcategories),
            'roster_present': 'true' if contract in roster_by_contract else 'false',
            'schedule_present': 'true' if sched else 'false',
            'small_business': first_nonblank(roster.get('small'), flags['small_business']),
            'veteran_owned': first_nonblank(roster.get('veteran_owned'), flags['veteran_owned']),
            'sdvosb': first_nonblank(roster.get('sdvosb'), flags['sdvosb']),
            'small_disadvantaged': first_nonblank(roster.get('sdb'), flags['small_disadvantaged']),
            'eight_a': first_nonblank(roster.get('eight_a'), flags['eight_a']),
            'woman_owned': first_nonblank(roster.get('woman_owned'), flags['woman_owned']),
            'wosb': flags['wosb'],
            'edwosb': flags['edwosb'],
            'hubzone': first_nonblank(roster.get('hubzone'), flags['hubzone']),
            'federal_revenue': '',
            'revenue_bucket': 'UNENRICHED_REVENUE',
            'campaign_mapping_status': 'BLOCKED_PENDING_REVENUE_ENRICHMENT',
            'state_sled_va_excluded': 'true',
        }
        output.append(row)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    headers = list(output[0].keys()) if output else []
    with open(OUT_CSV, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=headers)
        w.writeheader()
        w.writerows(output)

    roster_contracts = set(roster_by_contract)
    schedule_contracts = set(by_contract)
    summary = {
        'ok': True,
        'gate': 'FEDERAL_VA_FSS_IDENTITY_MASTER_READ_ONLY',
        'namespace': 'FEDERAL_VA_FSS',
        'stateVirginiaSledExcluded': True,
        'rosterRows': len(roster_rows),
        'rosterUniqueContracts': len(roster_contracts),
        'scheduleFiles': [os.path.basename(x) for x in schedule_files],
        'scheduleRows': len(schedule_rows),
        'scheduleUniqueContracts': len(schedule_contracts),
        'contractsInBoth': len(roster_contracts & schedule_contracts),
        'rosterOnlyContracts': len(roster_contracts - schedule_contracts),
        'scheduleOnlyContracts': len(schedule_contracts - roster_contracts),
        'masterContracts': len(output),
        'masterWithSingleExactScheduleUei': sum(1 for x in output if x['sam_uei_status'] == 'SCHEDULE_EXACT_CONTRACT'),
        'masterWithEmail': sum(1 for x in output if x['email']),
        'masterWithPhone': sum(1 for x in output if x['phone']),
        'masterWithUrl': sum(1 for x in output if x['url']),
        'writesToInstantly': False,
        'campaignMutations': False,
        'outputCsv': str(OUT_CSV),
        'nextAction': 'JOIN_FEDERAL_REVENUE_THEN_BUILD_VA_FSS_CAMPAIGN_BUCKETS'
    }
    with open(OUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2)

    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
