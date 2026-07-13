"use strict";


const DepartmentRegistry =
require("../CORE/DepartmentRegistry");


const EngineeringDepartment =
require("../DIGITAL_COO/Engineering/EngineeringDepartment");


const registry =
new DepartmentRegistry();


registry.register(

    "Engineering",

    new EngineeringDepartment()

);


console.log(

    registry.list()

);


console.log(

    registry.health()

);


module.exports = registry;