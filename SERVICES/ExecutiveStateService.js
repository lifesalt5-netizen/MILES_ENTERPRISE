const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const STATE_PATH = path.join(ROOT, "DATA", "executive_state.json");

class ExecutiveStateService {
  constructor() {
    this.state = {
      generatedAt: new Date().toISOString(),
      runtime: {},
      workforce: {},
      capabilities: {},
      connectors: {},
      tasks: {},
      business: {},
      approvals: [],
      risks: []
    };
  }

  update(section, value) {
    this.state[section] = value;
    this.state.generatedAt = new Date().toISOString();
    this.save();
    return this.state;
  }

  get(section = null) {
    return section ? this.state[section] : this.state;
  }

  save() {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(this.state, null, 2));
  }

  load() {
    if (fs.existsSync(STATE_PATH)) {
      this.state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    }
    return this.state;
  }
}

module.exports = new ExecutiveStateService();
