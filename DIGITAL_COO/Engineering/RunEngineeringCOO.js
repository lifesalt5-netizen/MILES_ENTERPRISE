const EngineeringCOO = require("./EngineeringCOO");
const EngineeringPlanner = require("./EngineeringPlanner");
const EngineeringAssignmentEngine = require("./EngineeringAssignmentEngine");
const EngineeringCapacityPlanner = require("./EngineeringCapacityPlanner");
const EngineeringRegistry = require("./EngineeringRegistry");

class RunEngineeringCOO {

    constructor() {

        this.coo = new EngineeringCOO();

        this.planner = new EngineeringPlanner();

        this.assignment = new EngineeringAssignmentEngine();

        this.capacity = new EngineeringCapacityPlanner();

        this.registry = new EngineeringRegistry();

    }

    status() {

        return {

            coo: this.coo.getDashboard(),

            planner: this.planner.getStatus(),

            capacity: this.capacity.getCapacity(),

            registry: this.registry.getSummary()

        };

    }

}

module.exports = RunEngineeringCOO;

if (require.main === module) {

    const engineering = new RunEngineeringCOO();

    console.log(JSON.stringify(engineering.status(), null, 2));

}