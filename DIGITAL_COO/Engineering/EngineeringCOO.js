class EngineeringCOO {

    constructor() {

        this.department = "Engineering";

        this.status = "Healthy";

        this.activeProjects = [];

        this.activeSprint = 1;

        this.pendingApprovals = [];

        this.completedToday = [];

        this.blocked = [];

    }

    getDashboard() {

        return {

            department: this.department,

            status: this.status,

            sprint: this.activeSprint,

            activeProjects: this.activeProjects.length,

            pendingApprovals: this.pendingApprovals.length,

            completedToday: this.completedToday.length,

            blocked: this.blocked.length

        };

    }

    registerProject(project){

        this.activeProjects.push(project);

    }

    approve(item){

        this.pendingApprovals =
            this.pendingApprovals.filter(x=>x.id!==item.id);

    }

}

module.exports = EngineeringCOO;