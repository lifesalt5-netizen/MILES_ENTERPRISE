"use strict";

/**
 * MILES Action Retry Service
 * EXEC_001
 * Complete replacement file.
 */

class ActionRetryService {
    shouldRetry(actionRecord, dispatchResult, verification) {
        if (!actionRecord) return false;
        if (actionRecord.requiresKevin === true) return false;
        if (verification?.status === "WAITING_FOR_PROVIDER_CONNECTOR") return false;
        if (verification?.verified === true) return false;

        const attempts = Number(actionRecord.attempts || 0);
        const maxRetries = Number(actionRecord.maxRetries || 1);
        return attempts < maxRetries;
    }

    buildRetry(actionRecord, reason) {
        return {
            ...actionRecord,
            status: "RETRY_QUEUED",
            attempts: Number(actionRecord.attempts || 0) + 1,
            lastRetryAt: new Date().toISOString(),
            retryReason: reason || "Verification failed."
        };
    }
}

module.exports = new ActionRetryService();
