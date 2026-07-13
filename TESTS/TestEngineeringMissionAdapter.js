const Adapter =
require("../DIGITAL_COO/Engineering/EngineeringMissionAdapter");


const adapter = new Adapter();


const mission =
adapter.submitProject({

    title:
    "Build Google Workspace Provider",

    description:
    "Create autonomous Google Workspace provisioning capability for MILES",

    priority:
    "Critical"

});


console.log(
JSON.stringify(
mission,
null,
2
));