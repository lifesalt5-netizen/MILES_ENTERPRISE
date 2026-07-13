const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const ENGINEERING_DIR = path.join(ROOT, "DATA", "engineering");

const PROJECT_FILE = path.join(
    ENGINEERING_DIR,
    "projects.json"
);

const CAPABILITY_FILE = path.join(
    ENGINEERING_DIR,
    "capabilities.json"
);

function ensure() {
    fs.mkdirSync(ENGINEERING_DIR, { recursive: true });

    if (!fs.existsSync(PROJECT_FILE)) {
        fs.writeFileSync(
            PROJECT_FILE,
            JSON.stringify([], null, 2)
        );
    }

    if (!fs.existsSync(CAPABILITY_FILE)) {
        fs.writeFileSync(
            CAPABILITY_FILE,
            JSON.stringify([], null, 2)
        );
    }
}

function read(file) {
    return JSON.parse(
        fs.readFileSync(file, "utf8")
    );
}

function write(file, data) {
    fs.writeFileSync(
        file,
        JSON.stringify(data, null, 2)
    );
}

class EngineeringManager {

    constructor() {
        ensure();
    }

    status() {

        return {

            ok: true,

            service: "EngineeringManager",

            projects: this.projects().length,

            capabilities: this.capabilities().length,

            checkedAt: new Date().toISOString()

        };

    }

    projects() {

        return read(PROJECT_FILE);

    }

    capabilities() {

        return read(CAPABILITY_FILE);

    }

    addCapability(capability) {

        const capabilities = this.capabilities();

        const existing = capabilities.find(
            c => c.name === capability.name
        );

        if (existing) {

            return existing;

        }

        const item = {

            id: "CAP-" + Date.now(),

            name: capability.name,

            version: capability.version || "1.0.0",

            status: capability.status || "ACTIVE",

            owner: capability.owner || "MILES",

            dependencies:
                capability.dependencies || [],

            createdAt: new Date().toISOString(),

            updatedAt: new Date().toISOString()

        };

        capabilities.push(item);

        write(CAPABILITY_FILE, capabilities);

        return item;

    }

    createProject({

        name,

        priority = "MEDIUM",

        reason = "",

        owner = "MILES",

        dependencies = [],

        tests = []

    }) {

        const projects = this.projects();

        const project = {

            id: "ENG-" + Date.now(),

            name,

            priority,

            status: "PLANNED",

            owner,

            reason,

            dependencies,

            tests,

            createdAt: new Date().toISOString(),

            updatedAt: new Date().toISOString()

        };

        projects.push(project);

        write(PROJECT_FILE, projects);

        return project;

    }

    updateProject(id, patch) {

        const projects = this.projects();

        const index = projects.findIndex(
            p => p.id === id
        );

        if (index < 0) {

            throw new Error(
                "Project not found: " + id
            );

        }

        projects[index] = {

            ...projects[index],

            ...patch,

            updatedAt: new Date().toISOString()

        };

        write(PROJECT_FILE, projects);

        return projects[index];

    }

    backlog() {

        return this.projects().sort((a, b) => {

            const order = {
                CRITICAL: 5,
                HIGH: 4,
                MEDIUM: 3,
                LOW: 2,
                BACKLOG: 1
            };

            return (
                (order[b.priority] || 0) -
                (order[a.priority] || 0)
            );

        });

    }

    initializeBaseline() {

        if (this.projects().length > 0) {

            return;

        }

        this.createProject({

            name: "Recovery Intelligence",

            priority: "CRITICAL",

            reason:
                "Classify and reduce failed task backlog.",

            dependencies: [

                "TaskQueue",

                "ExecutionEngine",

                "AutonomousLoop"

            ],

            tests: [

                "Recovery classification",

                "Retry policy",

                "Failure reporting"

            ]

        });

        this.createProject({

            name: "Executive Memory",

            priority: "HIGH",

            reason:
                "Track historical state and trends.",

            dependencies: [

                "AutonomousLoop"

            ],

            tests: [

                "State history",

                "Trend detection"

            ]

        });

        this.createProject({

            name: "Decision Engine",

            priority: "HIGH",

            reason:
                "Allow autonomous decision making.",

            dependencies: [

                "Recovery Intelligence",

                "Executive Memory"

            ],

            tests: [

                "Decision routing",

                "Approval rules"

            ]

        });

    }

}

module.exports = new EngineeringManager();