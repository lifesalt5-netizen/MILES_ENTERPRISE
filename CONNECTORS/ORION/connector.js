"use strict";

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const {
    ORION_ACTIONS,
    normalizeOrionAction
} = require("../../CORE/ExecutionActionContracts");

const DB_NAME = "ORION_DEMO_LIVE_READY.db";
const OrionSidecarOverlayService = require("../../SERVICES/orion/OrionSidecarOverlayService");

function isFile(file) {
    try {
        return fs.statSync(file).isFile();
    } catch {
        return false;
    }
}

function findNamedFile(root, maxDepth = 4) {
    if (!root || !fs.existsSync(root)) return null;

    const visit = (dir, depth) => {
        if (depth > maxDepth) return null;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return null;
        }

        for (const entry of entries) {
            if (entry.isFile() && entry.name.toLowerCase() === DB_NAME.toLowerCase()) {
                return path.join(dir, entry.name);
            }
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const found = visit(path.join(dir, entry.name), depth + 1);
            if (found) return found;
        }
        return null;
    };

    return visit(root, 0);
}

function resolveOrionDb() {
    const milesRoot = process.env.MILES_ROOT || process.cwd();
    const parent = path.dirname(milesRoot);
    const candidates = [
        process.env.ORION_DB,
        process.env.ORION_DB_PATH,
        path.join(parent, "Orion Demo 6126", "orion_live_demo_ready", DB_NAME),
        path.join(milesRoot, "DATA", "orion", DB_NAME),
        "C:\\P2GC_Intelligence\\Orion Demo 6126\\orion_live_demo_ready\\ORION_DEMO_LIVE_READY.db",
        "D:\\P2GC_Intelligence\\Orion Demo 6126\\orion_live_demo_ready\\ORION_DEMO_LIVE_READY.db"
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (isFile(candidate)) return path.resolve(candidate);
    }

    for (const searchRoot of [parent, "C:\\P2GC_Intelligence", "D:\\P2GC_Intelligence"]) {
        if (!searchRoot || !fs.existsSync(searchRoot)) continue;
        let topLevel = [];
        try {
            topLevel = fs.readdirSync(searchRoot, { withFileTypes: true })
                .filter(entry => entry.isDirectory() && /orion/i.test(entry.name))
                .map(entry => path.join(searchRoot, entry.name));
        } catch {}
        for (const dir of topLevel) {
            const found = findNamedFile(dir, 4);
            if (found) return path.resolve(found);
        }
    }

    return path.resolve(candidates[0] || path.join(parent, "Orion Demo 6126", "orion_live_demo_ready", DB_NAME));
}

const ORION_DB = resolveOrionDb();

class OrionConnector {

    constructor() {
        this.db = null;
        this.supportedActions = [...ORION_ACTIONS];
        this.sidecar = new OrionSidecarOverlayService({ rootDir: process.env.MILES_ROOT || process.cwd() });
    }

    canExecuteAction(action) {
        return Boolean(normalizeOrionAction(action));
    }

    initialize() {
        if (!fs.existsSync(ORION_DB)) {
            return {
                ok: false,
                status: "ERROR",
                message: `ORION DB not found after configured/P2GC-root discovery: ${ORION_DB}`
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
            supportedActions: [...ORION_ACTIONS],
            sidecar: this.sidecar.status(),
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
            personas: this.getTableCount("persona_scores"),
            contractSidecar: this.sidecar.status()
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
        return this.sidecar.enrichContractors(this.getRows("contractors", limit, offset));
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

        const normalized = String(term || "").trim();
        const q = `%${normalized}%`;

        if (!normalized) {
            return [];
        }

        return this.db.prepare(`
            SELECT *
            FROM contractors
            WHERE company LIKE ?
               OR company_norm LIKE ?
               OR uei LIKE ?
            ORDER BY
                CASE WHEN uei = ? THEN 0 ELSE 1 END,
                company ASC
            LIMIT ?
        `).all(q, q, q, normalized, this.safeLimit(limit));
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
        const requested =
            task.payload?.action ||
            task.action ||
            task.type ||
            "ORION_HEALTH";

        return normalizeOrionAction(requested) || String(requested).trim().toUpperCase();
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
                    supportedActions: [...ORION_ACTIONS],
                    originalAction:
                        task.payload?.action ||
                        task.action ||
                        task.type
                };
        }
    }

    shutdown() {
        this.sidecar.close();
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
