"use strict";

/**
 * MILES Action Verification Service
 * EXEC_001
 * Complete replacement file.
 */

const fs = require("fs");
const path = require("path");

class ActionVerificationService {
    verify(actionRecord, dispatchResult = {}) {
        const provider = actionRecord.provider || "general_operations";
        const operation = actionRecord.operation || "UNKNOWN";

        if (dispatchResult.status === "NEEDS_PROVIDER_CONNECTOR") {
            return {
                ok: true,
                action: "ACTION_VERIFICATION",
                verified: false,
                status: "WAITING_FOR_PROVIDER_CONNECTOR",
                provider,
                operation,
                message: "Action normalized and queued, but provider connector is not yet executable."
            };
        }

        if (provider === "filesystem" && actionRecord.payload?.verifyFile) {
            const filePath = path.resolve(actionRecord.payload.verifyFile);
            const exists = fs.existsSync(filePath);
            return {
                ok: exists,
                action: "ACTION_VERIFICATION",
                verified: exists,
                status: exists ? "VERIFIED" : "FAILED_VERIFICATION",
                provider,
                operation,
                message: exists ? "File output verified." : "Expected file output was not found."
            };
        }

        if (["orion", "general_operations", "filesystem"].includes(provider) && dispatchResult.ok === true) {
            return {
                ok: true,
                action: "ACTION_VERIFICATION",
                verified: true,
                status: "VERIFIED",
                provider,
                operation,
                message: "Internal provider action verified by successful dispatch result."
            };
        }

        return {
            ok: dispatchResult.ok === true,
            action: "ACTION_VERIFICATION",
            verified: dispatchResult.ok === true,
            status: dispatchResult.ok === true ? "VERIFIED" : "FAILED_VERIFICATION",
            provider,
            operation,
            message: dispatchResult.ok === true ? "Provider reported success." : "Provider did not report success."
        };
    }
}

module.exports = new ActionVerificationService();
