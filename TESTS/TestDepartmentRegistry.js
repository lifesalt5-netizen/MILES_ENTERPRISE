const DepartmentRegistry = require("../CORE/DepartmentRegistry");
const RunEngineeringCOO = require("../DIGITAL_COO/Engineering/RunEngineeringCOO");

const registry = new DepartmentRegistry();
const engineering = new RunEngineeringCOO();

registry.register("Engineering", engineering);

console.log(JSON.stringify({
    departments: registry.list(),
    health: registry.health()
}, null, 2));