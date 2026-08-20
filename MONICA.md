# MONICA — Market Expansion & Client Acquisition Intelligence

MONICA is P2GC's standalone, read-only acquisition-intelligence twin.

## Mission

`NET_NEW_ACQUISITION_SEGMENT_CENSUS`

MONICA discovers candidate companies from MILES/ORION data, qualifies trigger-based acquisition segments, suppresses companies already present in the P2GC master and Instantly universes, and produces company-level evidence before any new acquisition channel is approved.

## Initial segments

- RECOMPETE_REVENUE_AT_RISK
- FEDERAL_REVENUE_DECLINE
- FEDERAL_AGENCY_CONCENTRATION
- SUB_TO_PRIME_TRANSITION
- FEDERAL_BD_HIRING_INTENT
- OPPORTUNITY_VEHICLE_GAP
- 8A_GRADUATION_24M
- FEDERAL_WHITE_SPACE_EXPANSION
- RECENT_RECOMPETE_LOSS

## Safety / authority

MONICA is `DISCOVERY_ONLY` and `activationBlocked=true`.

She cannot send email, launch Instantly campaigns, spend ad budget, or activate prospects. Company-level suppression is mandatory. A census is not authoritative unless both the 26K master and an Instantly suppression source are discovered.

## One-command standalone install

From the MILES production root:

```powershell
node .\SCRIPTS\InstallMonicaStandalone.js
```

This performs syntax checks, unit/suppression tests, registers MONICA in the MILES workforce registry, runs the census, and writes installation acceptance evidence.

To install/register without running the live census:

```powershell
node .\SCRIPTS\InstallMonicaStandalone.js --no-census
```

## Individual commands

Register:

```powershell
node .\SCRIPTS\RegisterMonicaTwin.js
```

Run census:

```powershell
node .\SCRIPTS\RunMonicaNetNewAcquisitionCensus.js
```

Validate:

```powershell
node --check .\SERVICES\monica\MonicaAcquisitionIntelligenceService.js
node --check .\SCRIPTS\RegisterMonicaTwin.js
node --check .\SCRIPTS\RunMonicaNetNewAcquisitionCensus.js
node --check .\SCRIPTS\InstallMonicaStandalone.js
node .\TESTS\Test_MonicaAcquisitionIntelligence.js
```

## Census outputs

- `DATA\MONICA\NET_NEW_ACQUISITION_SEGMENT_CENSUS\MONICA_SEGMENT_CENSUS.csv`
- `DATA\MONICA\NET_NEW_ACQUISITION_SEGMENT_CENSUS\MONICA_SEGMENT_CENSUS.json`
- `DATA\MONICA\NET_NEW_ACQUISITION_SEGMENT_CENSUS\MONICA_RUN_MANIFEST.json`
- `DATA\MONICA\NET_NEW_ACQUISITION_SEGMENT_CENSUS\MONICA_ALL_QUALIFIED.csv`
- `DATA\MONICA\NET_NEW_ACQUISITION_SEGMENT_CENSUS\MONICA_NET_NEW_LEADS.csv`
- `DATA\MONICA\INSTALL_ACCEPTANCE\MONICA_INSTALL_ACCEPTANCE.json`

The census reports separately for every segment:

- raw qualifying companies
- overlap with the 26K master
- overlap with Instantly
- overlap with other P2GC datasets
- any existing overlap
- true net-new companies
- net-new contacts with email
- whether the result is authoritative
- TEST / NURTURE / HOLD recommendation

## Integration relationship

- MONICA owns market whitespace, net-new segment discovery, acquisition-market qualification and channel recommendations.
- ORION supplies federal market intelligence.
- ALLISON supplies recompete/expiration intelligence.
- JACKSON supplies competitive displacement intelligence.
- JASON supplies sub/prime intelligence.
- DANIEL / ISABEL / VICTORIA supply vehicle intelligence.
- ARIA owns messaging once a market is approved.
- RILEY owns approved multi-channel execution.
- ATLAS evaluates reply/intent signals.
- MILES owns orchestration and execution governance.

MONICA does not replace the existing twins. She converts their intelligence into a measurable, non-overlapping P2GC acquisition market.
