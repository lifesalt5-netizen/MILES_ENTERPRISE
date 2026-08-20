# MONICA — Market Expansion & Client Acquisition Intelligence

MONICA is a read-only acquisition-intelligence twin for P2GC.

## First mission

`NET_NEW_ACQUISITION_SEGMENT_CENSUS`

MONICA discovers candidate companies from existing MILES/ORION data, qualifies them into trigger-based acquisition segments, suppresses any company already present in the P2GC master/Instantly universe, and outputs a census plus lead-level evidence.

### Initial segments

- RECOMPETE_REVENUE_AT_RISK
- FEDERAL_REVENUE_DECLINE
- FEDERAL_AGENCY_CONCENTRATION
- SUB_TO_PRIME_TRANSITION
- FEDERAL_BD_HIRING_INTENT
- OPPORTUNITY_VEHICLE_GAP
- 8A_GRADUATION_24M
- FEDERAL_WHITE_SPACE_EXPANSION
- RECENT_RECOMPETE_LOSS

## Safety

MONICA V1 is `DISCOVERY_ONLY`.

It does not send email, launch Instantly campaigns, buy ads, or activate prospects. Company-level suppression is mandatory.

## Register

```powershell
node .\SCRIPTS\RegisterMonicaTwin.js
```

## Run census

```powershell
node .\SCRIPTS\RunMonicaNetNewAcquisitionCensus.js
```

Outputs:

- `DATA\MONICA\NET_NEW_ACQUISITION_SEGMENT_CENSUS\MONICA_SEGMENT_CENSUS.csv`
- `DATA\MONICA\NET_NEW_ACQUISITION_SEGMENT_CENSUS\MONICA_SEGMENT_CENSUS.json`
- `DATA\MONICA\NET_NEW_ACQUISITION_SEGMENT_CENSUS\MONICA_NET_NEW_LEADS.csv`

## Validate

```powershell
node --check .\SERVICES\monica\MonicaAcquisitionIntelligenceService.js
node --check .\SCRIPTS\RegisterMonicaTwin.js
node --check .\SCRIPTS\RunMonicaNetNewAcquisitionCensus.js
node .\TESTS\Test_MonicaAcquisitionIntelligence.js
```
