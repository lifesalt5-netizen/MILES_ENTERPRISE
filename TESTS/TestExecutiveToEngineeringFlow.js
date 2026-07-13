"use strict";


const registry =
require("../SERVICES/DepartmentBootstrap");


const Router =
require("../SERVICES/ExecutiveMissionRouter");


const router =
new Router(registry);


const result =
router.routeMission({

    title:
    "Build Google Workspace Provider",

    objective:
    "Create autonomous Google Workspace provisioning capability",

    priority:
    "Critical"

});


console.log(result);


if(result.status === "ROUTED"){

    const execution =
    result.handler.acceptMission({

        title:
        "Build Google Workspace Provider",

        description:
        "Create autonomous Google Workspace provisioning capability",

        priority:
        "Critical"

    });


    console.log(
        execution
    );

}