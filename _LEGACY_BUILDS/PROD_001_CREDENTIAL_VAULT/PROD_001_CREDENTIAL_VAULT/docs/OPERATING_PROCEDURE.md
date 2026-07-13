# PROD_001 Operating Procedure

1. Extract the package into the MILES OS root.
2. Copy `examples/.env.example` to `.env`.
3. Add real values locally.
4. Run `python src/run_validation.py`.
5. Review `reports/provider_readiness_report.json`.
6. Enable provider rollout only after validation passes.

No secrets should be uploaded back to ChatGPT.
