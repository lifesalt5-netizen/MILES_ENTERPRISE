const Database = require('better-sqlite3');

const db = new Database('./DATA/enterprise_db/Enterprise.db');

const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();

console.log(rows);
