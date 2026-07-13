const dispatcher =
require("../../SERVICES/ExecutiveDispatcher");


class EngineeringMissionAdapter {


    submitProject(project) {


        const mission =
            dispatcher.acceptMission({

                title: project.title,

                objective:
                    project.description ||
                    project.title,

                priority:
                    project.priority === "Critical"
                        ? 1
                        : 2,

                authority:
                    "ENGINEERING_AUTOMATIC"

            });


        return mission;

    }


}


module.exports = EngineeringMissionAdapter;