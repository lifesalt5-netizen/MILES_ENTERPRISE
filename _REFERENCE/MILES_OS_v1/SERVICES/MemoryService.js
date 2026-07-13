const db = require("../CORE/Database");

class MemoryService {

    remember(category, key, value) {

        const stmt = db.get().prepare(`
            INSERT INTO system_memory(category, key, value)
            VALUES (?, ?, ?)
            ON CONFLICT(key)
            DO UPDATE SET
                value=excluded.value,
                updated_at=CURRENT_TIMESTAMP;
        `);

        stmt.run(category, key, JSON.stringify(value));
    }

    recall(key) {

        const stmt = db.get().prepare(`
            SELECT value
            FROM system_memory
            WHERE key = ?
        `);

        const row = stmt.get(key);

        if (!row) return null;

        return JSON.parse(row.value);
    }

    forget(key) {

        db.get()
          .prepare("DELETE FROM system_memory WHERE key=?")
          .run(key);

    }

    list(category = null) {

        if (category) {

            return db.get()
                .prepare("SELECT * FROM system_memory WHERE category=?")
                .all(category);

        }

        return db.get()
            .prepare("SELECT * FROM system_memory")
            .all();

    }

}

module.exports = new MemoryService();