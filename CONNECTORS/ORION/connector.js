"use strict";

const Database = require("better-sqlite3");
const fs = require("fs");

const ORION_DB =
    process.env.ORION_DB ||
    process.env.ORION_DB_PATH ||
    "D:\\P2GC_Intelligence\\Orion Demo 6126\\orion_live_demo_ready\\ORION_DEMO_LIVE_READY.db";

class OrionConnector {

    constructor() {
        this.db = null;
    }

    initialize() {
        if (!fs.existsSync(ORION_DB)) {
            return {
                ok: false,
                status: "ERROR",
                message: `ORION DB not found: ${ORION_DB}`
            };
        }

        if (!this.db) {
            this.db = new Database(ORION_DB, { readonly: true });
        }

        return {
            ok: true,
            status: "INITIALIZED",
            db: ORION_DB
        };
    }

    healthCheck() {
        const init = this.initialize();

        if (!init.ok) {
            return init;
        }

        const tableCount = this.db.prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'"
        ).get().count;

        return {
            ok: true,
            service: "ORION",
            status: "OK",
            db: ORION_DB,
            tableCount,
            checkedAt: new Date().toISOString()
        };
    }

    getTables() {
        this.initialize();

        return this.db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).all();
    }

    getTableCount(tableName) {
        this.initialize();

        const safeTable = String(tableName).replace(/[^a-zA-Z0-9_]/g, "");

        try {
            const row = this.db.prepare(
                `SELECT COUNT(*) AS count FROM ${safeTable}`
            ).get();

            return {
                ok: true,
                table: safeTable,
                count: row.count
            };
        } catch (err) {
            return {
                ok: false,
                table: safeTable,
                error: err.message,
                count: 0
            };
        }
    }

    getSummary() {
        return {
            health: this.healthCheck(),
            contractors: this.getTableCount("contractors"),
            buyers: this.getTableCount("buyers"),
            opportunities: this.getTableCount("opportunities"),
            recompetes: this.getTableCount("recompetes"),
            recommendations: this.getTableCount("contractor_recommendations_v2"),
            personas: this.getTableCount("persona_scores")
        };
    }

    safeLimit(limit = 100) {
        const n = Number(limit) || 100;
        return Math.max(1, Math.min(n, 1000));
    }

    getRows(tableName, limit = 100, offset = 0) {
        this.initialize();

        const safeTable = String(tableName).replace(/[^a-zA-Z0-9_]/g, "");
        const safeOffset = Math.max(0, Number(offset) || 0);

        return this.db.prepare(
            `SELECT * FROM ${safeTable} LIMIT ? OFFSET ?`
        ).all(this.safeLimit(limit), safeOffset);
    }

    query(sql, params = []) {
        this.initialize();
        return this.db.prepare(sql).all(...params);
    }

    getContractors(limit = 100, offset = 0) {
        return this.getRows("contractors", limit, offset);
    }

    getBuyers(limit = 100, offset = 0) {
        return this.getRows("buyers", limit, offset);
    }

    getOpportunities(limit = 100, offset = 0) {
        return this.getRows("opportunities", limit, offset);
    }

    getRecompetes(limit = 100, offset = 0) {
        return this.getRows("recompetes", limit, offset);
    }

    getRecommendations(limit = 100, offset = 0) {
        return this.getRows("contractor_recommendations_v2", limit, offset);
    }

    getPersonas(limit = 100, offset = 0) {
        return this.getRows("persona_scores", limit, offset);
    }

    searchContractors(term, limit = 50) {
        this.initialize();

        const q = `%${String(term || "").trim()}%`;

        if (!term) {
            return [];
        }

        return this.db.prepare(`
            SELECT *
            FROM contractors
            WHERE legal_name LIKE ?
               OR uei LIKE ?
               OR cage LIKE ?
            LIMIT ?
        `).all(q, q, q, this.safeLimit(limit));
    }

    getTopRecommendations(limit = 100) {
        this.initialize();

        try {
            return this.db.prepare(`
                SELECT *
                FROM contractor_recommendations_v2
                LIMIT ?
            `).all(this.safeLimit(limit));
        } catch {
            return [];
        }
    }

    normalizeAction(task = {}) {
        let action =
            task.payload?.action ||
            task.action ||
            task.type ||
            "ORION_HEALTH";

        const text = String(action).toLowerCase();

        if (text.includes("health") || text.includes("system health")) {
            return "ORION_HEALTH";
        }

        if (text.includes("summary") || text.includes("executive")) {
            return "ORION_SUMMARY";
        }

        if (text.includes("table")) {
            return "ORION_TABLES";
        }

        if (text.includes("contractor")) {
            return "ORION_CONTRACTORS";
        }

        if (text.includes("buyer")) {
            return "ORION_BUYERS";
        }

        if (text.includes("opportunit")) {
            return "ORION_OPPORTUNITIES";
        }

        if (text.includes("recompete")) {
            return "ORION_RECOMPETES";
        }

        if (text.includes("recommend")) {
            return "ORION_RECOMMENDATIONS";
        }

        if (text.includes("persona")) {
            return "ORION_PERSONAS";
        }

        if (text.includes("search")) {
            return "ORION_SEARCH_CONTRACTORS";
        }

        return action;
    }

    execute(task = {}) {
        const action = this.normalizeAction(task);

        const limit =
            task.limit ||
            task.payload?.limit ||
            100;

        const offset =
            task.offset ||
            task.payload?.offset ||
            0;

        switch (action) {
            case "ORION_HEALTH":
                return this.healthCheck();

            case "ORION_TABLES":
                return {
                    ok: true,
                    tables: this.getTables()
                };

            case "ORION_SUMMARY":
                return this.getSummary();

            case "ORION_CONTRACTORS":
                return {
                    ok: true,
                    contractors: this.getContractors(limit, offset)
                };

            case "ORION_BUYERS":
                return {
                    ok: true,
                    buyers: this.getBuyers(limit, offset)
                };

            case "ORION_OPPORTUNITIES":
                return {
                    ok: true,
                    opportunities: this.getOpportunities(limit, offset)
                };

            case "ORION_RECOMPETES":
                return {
                    ok: true,
                    recompetes: this.getRecompetes(limit, offset)
                };

            case "ORION_RECOMMENDATIONS":
                return {
                    ok: true,
                    recommendations: this.getRecommendations(limit, offset)
                };

            case "ORION_PERSONAS":
                return {
                    ok: true,
                    personas: this.getPersonas(limit, offset)
                };

            case "ORION_SEARCH_CONTRACTORS":
                return {
                    ok: true,
                    contractors: this.searchContractors(
                        task.term || task.payload?.term,
                        limit
                    )
                };

            default:
                return {
                    ok: false,
                    error: `Unsupported ORION action: ${action}`,
                    originalAction:
                        task.payload?.action ||
                        task.action ||
                        task.type
                };
        }
    }

    shutdown() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }

        return {
            ok: true,
            status: "SHUTDOWN"
        };
    }
}

module.exports = new OrionConnector();