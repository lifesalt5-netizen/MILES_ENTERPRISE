"use strict";

class RetryManagerService {
    shouldRetry(result = {}, item = {}) {
        const attempts = Number(item?.metadata?.executionAttempts || 0);
        const transient = /timeout|network|rate|temporary|retry/i.test(JSON.stringify(result || {}));
        return {
            ok: true,
            action: "RETRY_EVALUATION",
            retry: !result?.ok && transient && attempts < 2,
            attempts,
            maxAttempts: 2,
            reason: transient ? "Transient failure pattern detected." : "No retryable condition detected."
        };
    }
}

module.exports = new RetryManagerService();
