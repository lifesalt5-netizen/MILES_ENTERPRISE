const EngineeringPlanner =
require("./EngineeringPlanner");

const EngineeringAssignmentEngine =
require("./EngineeringAssignmentEngine");


class EngineeringOrchestrator {

    constructor(queue) {

        this.queue = queue;

        this.planner = new EngineeringPlanner();

        this.assignment =
            new EngineeringAssignmentEngine();

    }


    processNext(){

        const nextProject =
            this.queue.next();


        if (!nextProject){

            return {

                status:"No Work Available"

            };

        }


        // Add queued work into planner

        this.planner.addWork(nextProject);


        // Build sprint

        const sprint =
            this.planner.buildSprint(1);


        if (!sprint.length){

            return {

                status:"Planner Returned No Work"

            };

        }


        // Move work to ready state

        const ready =
            this.planner.queueReady();


        const project =
            ready[0];


        // Assign worker

        const assignment =
            this.assignment.assign(project);


        return {

            status:"Assigned",

            project: assignment,

            planner:
                this.planner.getStatus()

        };

    }

}


module.exports = EngineeringOrchestrator;