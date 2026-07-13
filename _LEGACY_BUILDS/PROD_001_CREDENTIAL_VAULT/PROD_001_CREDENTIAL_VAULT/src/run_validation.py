from env_loader import load_dotenv
from validator import validate_all
from report import write_report

def main():
    loaded = load_dotenv('.env')
    results = validate_all()
    report_path = write_report(results)

    print('PROD_001 Provider Validation')
    print(f'.env loaded: {loaded}')
    print(f'Report: {report_path}')
    print('')

    for name, result in results.items():
        status = 'READY' if result['ready'] else 'MISSING_CONFIG'
        print(f'{name}: {status}')
        if result['missing']:
            print('  Missing:', ', '.join(result['missing']))
        for check in result.get('checks', []):
            print(f"  Check {check['check']}: {'PASS' if check['passed'] else 'FAIL'}")

if __name__ == '__main__':
    main()
