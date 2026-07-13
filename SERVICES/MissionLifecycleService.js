"use strict";

const fs = require("fs");
const path = require("path");
const resolution =
require("./ResolutionEngine");

const ROOT = process.env.MILES_ROOT || process.cwd();

const QUEUE =
path.join(ROOT,"DATA","queue","completed.json");

const MISSIONS =
path.join(ROOT,"ENGINEERING","Missions");


class MissionLifecycleService {


    async process(){

    await this.resolveCompletedMissions();

        if(!fs.existsSync(QUEUE)){
            return;
        }


        const completed =
        JSON.parse(
            fs.readFileSync(
                QUEUE,
                "utf8"
            )
        );


        const missions =
        {};


        for(const task of completed){

            const missionId =
            task.payload?.missionId;


            if(!missionId)
                continue;


            if(!missions[missionId])
                missions[missionId]=[];


            missions[missionId].push(task);

        }



        for(const missionId of Object.keys(missions)){

            this.updateMission(
                missionId,
                missions[missionId]
            );

        }


    }
async resolveCompletedMissions(){

    if(!fs.existsSync(QUEUE)){
        return;
    }

    const completed =
    JSON.parse(
        fs.readFileSync(
            QUEUE,
            "utf8"
        )
    );


    for(const task of completed){

        const title =
        String(
            task.title ||
            task.payload?.title ||
            ""
        );


        if(
            title.includes("Repair Website") ||
            title.includes("WebsiteProvider")
        ){

            const result =
            await resolution.evaluate({

                type:
                "WebsiteProviderLoadFailure",

                title

            });


            console.log(
                "[RESOLUTION]",
                result.resolved
            );

        }

    }

}


    updateMission(id,tasks){


        const file =
        path.join(
            MISSIONS,
            `${id}.json`
        );


        if(!fs.existsSync(file))
            return;


        const mission =
        JSON.parse(
            fs.readFileSync(
                file,
                "utf8"
            )
        );



        const total =
        mission.tasks.length;


        const complete =
        tasks.length;



        if(complete >= total){

            mission.status =
            "COMPLETED";

            mission.completedAt =
            new Date().toISOString();

        }
        else{

            mission.status =
            "IN_PROGRESS";

        }



        mission.progress = {

            completed:
            complete,

            total

        };



        fs.writeFileSync(
            file,
            JSON.stringify(
                mission,
                null,
                2
            )
        );


    }


}


module.exports =
new MissionLifecycleService();