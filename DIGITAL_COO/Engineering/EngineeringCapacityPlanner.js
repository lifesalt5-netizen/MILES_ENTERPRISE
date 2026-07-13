class EngineeringCapacityPlanner {

    constructor() {

        this.maxConcurrentProjects = 10;

        this.activeProjects = [];

        this.availableWorkers = 8;

    }

    setAvailableWorkers(count) {

        this.availableWorkers = count;

    }

    registerProject(project) {

        this.activeProjects.push(project);

    }

    getCapacity() {

        const active = this.activeProjects.length;
        const remaining = Math.max(0, this.maxConcurrentProjects - active);

        return {
            maxProjects: this.maxConcurrentProjects,
            activeProjects: active,
            availableWorkers: this.availableWorkers,
            remainingCapacity: remaining,
            utilization:
                Math.round((active / this.maxConcurrentProjects) * 100)
        };

    }

    canAcceptProject() {

        return this.activeProjects.length < this.maxConcurrentProjects;

    }

    recommendAction() {

        const capacity = this.getCapacity();

        if (capacity.utilization >= 90) {

            return {
                action: "Scale Engineering",
                reason: "Engineering utilization exceeds 90%."
            };

        }

        if (capacity.utilization >= 70) {

            return {
                action: "Monitor Capacity",
                reason: "Engineering workload is approaching limits."
            };

        }

        return {
            action: "Capacity Healthy",
            reason: "Engineering has room for additional work."
        };

    }

}

module.exports = EngineeringCapacityPlanner;