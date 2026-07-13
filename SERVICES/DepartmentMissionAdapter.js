"use strict";


class DepartmentMissionAdapter {


    constructor(router){
        this.router = router;
    }


    execute(mission){


        const route =
            this.router.routeMission(mission);


        if(route.status !== "ROUTED"){

            return route;

        }


        const department =
            route.handler;


        if(
            department &&
            typeof department.acceptMission === "function"
        ){

            return department.acceptMission(
                mission
            );

        }


        return {

            status:"ROUTED_ONLY",

            department:
            route.department,

            message:
            "Department selected but no mission handler exists",

            mission

        };

    }


}


module.exports =
DepartmentMissionAdapter;