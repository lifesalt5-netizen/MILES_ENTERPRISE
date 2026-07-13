"use strict";

const EngineeringMissionAdapter =
require("./EngineeringMissionAdapter");


class EngineeringDepartment {


    constructor(){

        this.adapter =
        new EngineeringMissionAdapter();

    }


    status(){

        return {

            department:"Engineering",

            status:"Healthy"

        };

    }


    acceptMission(project){

        return this.adapter.submitProject(project);

    }


}


module.exports =
EngineeringDepartment;