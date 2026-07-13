"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

class EnterpriseRuntimeManager {

    constructor() {

        this.version = "1.0.0";
        this.service = "ENTERPRISE_RUNTIME_MANAGER";

        this.root =
            process.env.MILES_ROOT ||
            process.cwd();

        this.runtimeMode =
            process.env.MILES_ENV ||
            "production";

        this.config = {

            root: this.root,

            runtimeMode: this.runtimeMode,

            legacyRuntimeEnabled: false,

            enterpriseRuntimeEnabled: true

        };

    }

    // =====================================================
    // PATHS
    // =====================================================

    paths() {

        return {

            root: this.root,

            config:
                path.join(
                    this.root,
                    "CONFIG"
                ),

            data:
                path.join(
                    this.root,
                    "DATA"
                ),

            runtime:
                path.join(
                    this.root,
                    "DATA",
                    "runtime"
                ),

            providers:
                path.join(
                    this.root,
                    "PROVIDERS"
                ),

            services:
                path.join(
                    this.root,
                    "SERVICES"
                ),

            engineering:
                path.join(
                    this.root,
                    "ENGINEERING"
                ),

            logs:
                path.join(
                    this.root,
                    "LOGS"
                )

        };

    }

    // =====================================================
    // STATUS
    // =====================================================

    status() {

        return {

            ok: true,

            service: this.service,

            version: this.version,

            runtimeRoot:
                this.root,

            runtimeMode:
                this.runtimeMode,

            generatedAt:
                new Date().toISOString()

        };

    }

    // =====================================================
    // HEALTH
    // =====================================================

    health() {

        const p =
            this.paths();

        const health = {

            runtimeRoot:
                fs.existsSync(p.root),

            data:
                fs.existsSync(p.data),

            runtime:
                fs.existsSync(p.runtime),

            providers:
                fs.existsSync(p.providers),

            services:
                fs.existsSync(p.services),

            engineering:
                fs.existsSync(p.engineering),

            logs:
                fs.existsSync(p.logs)

        };

        health.ok =
            Object.values(health)
                .every(v => v === true);

        return health;

    }

    // =====================================================
    // VALIDATION
    // =====================================================

    validate() {

        const health =
            this.health();

        const issues = [];

        for (const key of Object.keys(health)) {

            if (
                key === "ok"
            )
                continue;

            if (!health[key]) {

                issues.push({

                    area: key,

                    severity: "HIGH",

                    message:
                        `${key} directory missing.`

                });

            }

        }

        return {

            ok:
                issues.length === 0,

            issues,

            checkedAt:
                new Date().toISOString()

        };

    }

    // =====================================================
    // SUMMARY
    // =====================================================

    summary() {

        return {

            ok: true,

            runtime:
                this.status(),

            health:
                this.health(),

            validation:
                this.validate(),

            paths:
                this.paths()

        };

    }

}

module.exports =
    new EnterpriseRuntimeManager();