'use strict';

// Canonical acceptance entrypoint intentionally delegates to the bounded,
// regression-tested targeted scanner. The former default service invocation
// crawled broad P2GC roots and repeatedly exceeded the revenue acceptance
// child's 10-minute safety timeout. The targeted implementation remains
// read-only and still writes the same latest_rebuild_readiness.json evidence.
require('./AuditOrionRebuildReadinessFast');
