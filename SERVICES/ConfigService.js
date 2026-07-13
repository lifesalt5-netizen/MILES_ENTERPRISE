"use strict";

const path = require("path");
const fs = require("fs");

class ConfigService {
    constructor() {
        this.root = process.env.MILES_ROOT || path.resolve(__dirname, "..");
        this.environment = process.env.MILES_ENV || "enterprise";
        this.version = "BUILD_042";
    }

    getRoot() {
        return this.root;
    }

    getDataPath(...parts) {
        return path.join(this.root, "DATA", ...parts);
    }

    getServicesPath(...parts) {
        return path.join(this.root, "SERVICES", ...parts);
    }

    getTestsPath(...parts) {
        return path.join(this.root, "TESTS", ...parts);
    }

    getRuntimePath(...parts) {
        return this.getDataPath("runtime", ...parts);
    }

    getLogsPath(...parts) {
        return this.getDataPath("logs", ...parts);
    }

    getSelfLearningPath(...parts) {
        return this.getDataPath("self_learning", ...parts);
    }

    describe() {
        return {
            ok: true,
            version: this.version,
            environment: this.environment,
            root: this.getRoot(),
            data: this.getDataPath(),
            services: this.getServicesPath(),
            tests: this.getTestsPath(),
            runtime: this.getRuntimePath(),
            logs: this.getLogsPath(),
            selfLearning: this.getSelfLearningPath()
        };
    }

    ensureDirectory(dirPath) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        return dirPath;
    }
}

module.exports = new ConfigService();