MILES BUILD 027 - Instantly COO Live Patch

Purpose:
- Replaces the approval-heavy InstantlyCampaignOperator with an autonomous COO audit/execute worker.
- Improves campaign extraction so MILES stops counting labels like Unibox, Status, and 0 as campaigns.
- Adds planned/executed/verified/failed action buckets.
- Keeps CEO approval only for true CEO-level actions.
- Adds --execute support in the test runner.

Files updated:
- SERVICES\Browser\Workers\InstantlyCampaignOperator.js
- TESTS\Test_InstantlyCampaignOperator.js

Safety:
- Default mode is AUDIT only.
- --execute currently performs safe browser campaign-open/audit verification only.
- It does not delete leads, delete campaigns, purchase services, or make irreversible changes.

Apply:
cd D:\P2GC_Intelligence\MILES_BUILD_027_Instantly_COO_Live_Patch
.\APPLY_BUILD_027.ps1

Test:
cd D:\P2GC_Intelligence\MILES_OS
node .\TESTS\Test_InstantlyCampaignOperator.js

Safe execute audit:
node .\TESTS\Test_InstantlyCampaignOperator.js --execute
