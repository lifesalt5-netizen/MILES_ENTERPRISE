"use strict";

class ExecutiveMissionRouter {

    constructor(departmentRegistry){
        this.registry = departmentRegistry;
    }


    routeMission(mission = {}){

        const objective =
            String(
                mission.objective ||
                mission.title ||
                ""
            ).toLowerCase();


        let department = null;


        if(
    objective.includes("build") ||
    objective.includes("code") ||
    objective.includes("system") ||
    objective.includes("integration") ||
    objective.includes("provider") ||
    objective.includes("engineering") ||
    objective.includes("create") ||
    objective.includes("develop") ||
    objective.includes("development") ||
    objective.includes("automation") ||
    objective.includes("provisioning") ||
    objective.includes("api") ||
    objective.includes("software") ||
    objective.includes("platform")
){
    department = "Engineering";
}


        else if(
            objective.includes("revenue") ||
            objective.includes("sales") ||
            objective.includes("lead") ||
            objective.includes("customer")
        ){
            department = "Revenue";
        }


        else if(
            objective.includes("marketing") ||
            objective.includes("campaign") ||
            objective.includes("email")
        ){
            department = "Marketing";
        }


        if(!department){

            return {
                status:"UNROUTED",
                reason:"No department match",
                mission
            };

        }


        const registered =
            this.registry.get(department);


        if(!registered){

            return {
                status:"FAILED",
                reason:
                `${department} department not registered`,
                mission
            };

        }


        return {

            status:"ROUTED",

            department,

            mission,

            handler:
            registered.department

        };

    }

}


module.exports = ExecutiveMissionRouter;