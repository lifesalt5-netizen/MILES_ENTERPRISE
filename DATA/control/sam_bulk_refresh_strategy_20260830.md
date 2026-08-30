# SAM.gov bulk refresh strategy

ORION-scale SAM refreshes use SAM.gov public Data Services extracts as the primary source. A high-volume API probe is not the authority on whether a known SAM API key is valid.

Primary official sources:
- Entity Registration Public V2 monthly UTF-8 extract: https://sam.gov/data-services/Entity%20Registration/Public%20V2
- Contract Opportunities full public CSV: https://sam.gov/data-services/Contract%20Opportunities/datagov?privacy=Public

Operational rules:
- Full entity refresh: discover the newest public Entity Registration V2 UTF-8 monthly extract using SAM.gov file-extract services, then stage it locally before import.
- Full current opportunity refresh: use the public ContractOpportunitiesFullCSV.csv extract, stage it locally, then import.
- SAM API: targeted/incremental lookups only, with throttling/backoff. 401/429/timeouts during an automated probe are treated as probe/runtime evidence, not proof that a user-confirmed key is invalid.
- GSA MAS/SIN/contractor truth remains sourced from official GSA eLibrary, not SAM APIs.
- Never automate Login.gov or scrape authenticated SAM.gov pages. Use permitted public Data Services extracts.
- Preserve source URL, file name, modified date, byte count, checksum, acquisition time, and component-level freshness. Never fabricate freshness.
