class EngineeringAssignmentEngine {

    constructor() {

        this.assignments = [];

        this.workers = [
            "Architecture",
            "Backend",
            "Frontend",
            "Infrastructure",
            "Database",
            "AI",
            "Testing",
            "Documentation"
        ];

    }

    assign(workItem) {

        let worker = "Backend";

        const title = (workItem.title || "").toLowerCase();

        if (title.includes("ui") || title.includes("dashboard")) {
            worker = "Frontend";
        }

        if (title.includes("database") || title.includes("schema")) {
            worker = "Database";
        }

        if (title.includes("provider") ||
            title.includes("dns") ||
            title.includes("workspace")) {
            worker = "Infrastructure";
        }

        if (title.includes("ai") ||
            title.includes("planner") ||
            title.includes("decision")) {
            worker = "AI";
        }

        if (title.includes("test")) {
            worker = "Testing";
        }

        if (title.includes("architecture")) {
            worker = "Architecture";
        }

        workItem.assignedWorker = worker;
        workItem.status = "Assigned";

        this.assignments.push(workItem);

        return workItem;

    }

    getAssignments() {

        return this.assignments;

    }

}

module.exports = EngineeringAssignmentEngine;