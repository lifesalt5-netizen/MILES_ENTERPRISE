MILES BUILD 026 - Instantly Autonomous COO Worker

What this patch changes:
- Replaces weak semantic campaign scraping with link/card/grid-based campaign extraction.
- Filters UI junk labels like Unibox, Status, and 0.
- Adds real COO decision planning for paused campaigns, lead gaps, inbox gaps, bounce/deliverability signals, and optimization.
- Integrates the existing AuthorityEngine so only CEO-level decisions go to approval.
- Adds safe observe mode by default.
- Adds execute mode for authorized browser actions: --execute.
- Adds execution + verification result buckets.
- Persists campaign memory to DATA/browser/operator_memory.json.

Apply:
PowerShell: .\APPLY_BUILD_026.ps1

Test observe mode:
cd D:\P2GC_Intelligence\MILES_OS
node .\TESTS\Test_InstantlyCampaignOperator.js

Test execute mode:
cd D:\P2GC_Intelligence\MILES_OS
node .\TESTS\Test_InstantlyCampaignOperator.js --execute

Expected improvement:
The operator should stop returning nav labels as campaigns and should produce a planned COO action list instead of routing every item to CEO approval.
