class EngineeringProjectQueue {

    constructor() {
        this.projects = [];
    }

    add(project) {

        const record = {
            id: this.projects.length + 1,
            status: "Queued",
            created: new Date().toISOString(),
            ...project
        };

        this.projects.push(record);

        return record;
    }

    next() {
        return this.projects.find(p => p.status === "Queued");
    }

    start(id) {

        const project = this.projects.find(p => p.id === id);

        if (!project) return null;

        project.status = "In Progress";

        return project;
    }

    complete(id) {

        const project = this.projects.find(p => p.id === id);

        if (!project) return null;

        project.status = "Completed";

        project.completed =
            new Date().toISOString();

        return project;
    }

    dashboard() {

        return {

            queued:
                this.projects.filter(x => x.status === "Queued").length,

            active:
                this.projects.filter(x => x.status === "In Progress").length,

            completed:
                this.projects.filter(x => x.status === "Completed").length,

            total:
                this.projects.length
        };

    }

}

module.exports = EngineeringProjectQueue;