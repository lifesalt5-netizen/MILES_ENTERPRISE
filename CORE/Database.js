const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

class MilesDatabase {
    constructor() {
        const dbFolder = path.join(__dirname, "..", "DATABASE");

        if (!fs.existsSync(dbFolder)) {
            fs.mkdirSync(dbFolder, { recursive: true });
        }

        const dbPath = path.join(dbFolder, "miles.db");

        this.db = new Database(dbPath);

        this.initialize();
    }

    initialize() {

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS system_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT,
                key TEXT UNIQUE,
                value TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS task_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task TEXT,
                status TEXT,
                priority INTEGER DEFAULT 5,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS execution_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                level TEXT,
                message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

    }

    get() {
        return this.db;
    }

}

module.exports = new MilesDatabase();