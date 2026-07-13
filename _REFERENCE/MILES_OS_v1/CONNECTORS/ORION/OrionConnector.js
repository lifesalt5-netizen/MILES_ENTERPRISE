const Database = require("better-sqlite3");

const ORION_DB_PATH =
    "D:\\P2GC_Intelligence\\Orion Demo 6126\\orion_live_demo_ready\\ORION_DEMO_LIVE_READY.db";

class OrionConnector {
    constructor() {
        this.db = null;
        this.connected = false;
        this.error = null;
    }

    connect() {
        try {
            this.db = new Database(ORION_DB_PATH, { readonly: true });
            this.connected = true;
            this.error = null;
            return true;
        } catch (err) {
            this.connected = false;
            this.error = err.message;
            return false;
        }
    }

    count(tableName) {
        if (!this.connected) this.connect();
        if (!this.connected) return null;

        try {
            const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get();
            return row.count;
        } catch {
            return null;
        }
    }

    health() {
        if (!this.connected) this.connect();

        return {
            system: "ORION",
            connected: this.connected,
            error: this.error,
            contractors: this.count("contractors"),
            buyers: this.count("buyers"),
            opportunities: this.count("opportunities"),
            recompetes: this.count("recompetes"),
            primeRecommendations: this.count("prime_recs"),
            checkedAt: new Date().toISOString()
        };
    }
}

module.exports = new OrionConnector();