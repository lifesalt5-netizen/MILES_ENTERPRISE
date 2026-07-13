MILES BUILD 030 - MINIMUM AUTONOMOUS COO

This build does not replace the whole MILES repository.
It updates only the minimum files needed to connect MILES to the autonomous COO loop:

1. SERVICES\Browser\Workers\InstantlyCampaignOperator.js
   - Opens Instantly without networkidle timeout
   - Uses existing browser session
   - Discovers real campaigns
   - Classifies draft / paused / active campaigns
   - Runs safe audit / execute cycles
   - Logs results and screenshots

2. TESTS\Test_Build030_MinimumAutonomousCOO.js
   - One-command Build 030 test runner

3. START_MILES_BUILD_030.ps1
   - Runs MILES COO cycle once or repeatedly

Apply:
cd D:\P2GC_Intelligence
Expand-Archive .\MILES_BUILD_030_Minimum_Autonomous_COO_REAL.zip -DestinationPath .\MILES_BUILD_030_Minimum_Autonomous_COO_REAL -Force
cd .\MILES_BUILD_030_Minimum_Autonomous_COO_REAL
.\APPLY_BUILD_030.ps1

Test:
cd D:\P2GC_Intelligence\MILES_OS
node .\TESTS\Test_Build030_MinimumAutonomousCOO.js --show
.\START_MILES_BUILD_030.ps1 -Once -Execute -Show
