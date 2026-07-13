"use strict";

const fs = require("fs");
const path = require("path");

const ROOT =
process.env.MILES_ROOT || process.cwd();

const MISSIONS_DIR =
path.join(
    ROOT,
    "ENGINEERING",
    "Missions"
);


class MissionSupervisor {


    listMissions(){

        if(!fs.existsSync(MISSIONS_DIR)){
            return [];
        }


        return fs.readdirSync(MISSIONS_DIR)
        .filter(f=>f.endsWith(".json"))
        .map(file=>{

            return JSON.parse(
                fs.readFileSync(
                    path.join(MISSIONS_DIR,file),
                    "utf8"
                )
            );

        });

    }



    summarize(){

        const missions =
        this.listMissions();


        const summary = {

            total:
            missions.length,

            accepted:
            0,

            completed:
            0,

            failed:
            0,

            active:
            0

        };


        for(const mission of missions){

            switch(mission.status){

                case "ACCEPTED":
                    summary.accepted++;
                    break;

                case "COMPLETED":
                    summary.completed++;
                    break;

                case "FAILED":
                    summary.failed++;
                    break;

                default:
                    summary.active++;

            }

        }


        return {

            generatedAt:
            new Date().toISOString(),

            summary

        };

    }

}


module.exports =
new MissionSupervisor();