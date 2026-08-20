# MILES Full Runtime Stability

This change set implements the full-fix rule for the August 20, 2026 runtime incident.

Goals:
- prevent obsolete PM2 generations from continuing to operate;
- enforce one guarded worker, one guarded COO, and one guarded queue maintainer;
- make COO shutdown terminate deterministically;
- compact the hot TaskQueue earlier to reduce lock duration, CPU, and RAM pressure;
- provide one cutover and one acceptance soak instead of iterative patching.

Deployment is intentionally separate from this commit. The production cutover script is `SCRIPTS/RUN_MILES_FULL_RUNTIME_STABILITY_CUTOVER_WINDOWS.ps1`.
