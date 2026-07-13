const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SESSION_DIR = path.join(ROOT, "DATA", "browser");

class SessionManager {
    constructor() {
        if (!fs.existsSync(SESSION_DIR)) {
            fs.mkdirSync(SESSION_DIR, { recursive: true });
        }
    }

    sessionPath(name) {
        return path.join(SESSION_DIR, `${name.toLowerCase()}.json`);
    }

    exists(name) {
        return fs.existsSync(this.sessionPath(name));
    }

    list() {
        return fs.readdirSync(SESSION_DIR)
            .filter(f => f.endsWith(".json"))
            .map(f => f.replace(".json", ""));
    }

    get(name) {
        return this.sessionPath(name);
    }

    status() {
        return {
            ok: true,
            directory: SESSION_DIR,
            sessions: this.list(),
            checkedAt: new Date().toISOString()
        };
    }
}

module.exports = new SessionManager();