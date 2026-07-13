"use strict";

class BaseProviderController {
    constructor(options = {}) {
        this.key = options.key || "base";
        this.name = options.name || "Base Provider";
        this.executable = options.executable === true;
        this.supportedOperations = options.supportedOperations || [];
        this.envKeys = options.envKeys || [];
    }

    now() { return new Date().toISOString(); }

    hasCredentials() {
        return this.envKeys.every(key => Boolean(process.env[key]));
    }

    status() {
        return {
            ok: true,
            provider: this.key,
            providerName: this.name,
            executable: this.executable,
            credentialsPresent: this.hasCredentials(),
            supportedOperations: this.supportedOperations,
            generatedAt: this.now()
        };
    }

    async connect() {
        return {
            ok: this.hasCredentials(),
            provider: this.key,
            action: "CONNECT",
            connected: this.hasCredentials(),
            message: this.hasCredentials()
                ? `${this.name} credentials detected.`
                : `${this.name} credentials not configured.`,
            generatedAt: this.now()
        };
    }

    async validate(operation) {
        const supported = this.supportedOperations.includes(operation);
        return {
            ok: supported,
            provider: this.key,
            action: "VALIDATE",
            operation,
            supported,
            credentialsPresent: this.hasCredentials(),
            generatedAt: this.now()
        };
    }

    async execute(actionRecord) {
        const operation = actionRecord.operation;
        const validation = await this.validate(operation);
        if (!validation.ok) {
            return {
                ok: false,
                provider: this.key,
                operation,
                status: "UNSUPPORTED_OPERATION",
                executed: false,
                message: `${operation} is not supported by ${this.name}.`,
                generatedAt: this.now()
            };
        }

        if (!this.executable || !this.hasCredentials()) {
            return {
                ok: true,
                provider: this.key,
                operation,
                status: "SIMULATED_READY_WAITING_FOR_CREDENTIALS",
                executed: false,
                message: `${this.name} controller installed. Real execution is disabled until credentials/API method are configured.`,
                generatedAt: this.now()
            };
        }

        return {
            ok: true,
            provider: this.key,
            operation,
            status: "READY_FOR_REAL_EXECUTION_IMPLEMENTATION",
            executed: false,
            message: `${this.name} credentials detected, but real API execution must be enabled per operation safely.`,
            generatedAt: this.now()
        };
    }

    async verify(actionRecord, executionResult) {
        return {
            ok: true,
            provider: this.key,
            operation: actionRecord.operation,
            action: "VERIFY",
            verified: executionResult.executed === true,
            status: executionResult.executed === true ? "VERIFIED" : "WAITING_FOR_REAL_PROVIDER_EXECUTION",
            message: executionResult.executed === true
                ? "Provider action verified."
                : "Provider controller exists, but real execution was not performed.",
            generatedAt: this.now()
        };
    }

    async rollback(actionRecord) {
        return {
            ok: true,
            provider: this.key,
            operation: actionRecord.operation,
            action: "ROLLBACK",
            rollbackPerformed: false,
            status: "NO_ROLLBACK_REQUIRED_OR_AVAILABLE",
            generatedAt: this.now()
        };
    }
}

module.exports = BaseProviderController;
