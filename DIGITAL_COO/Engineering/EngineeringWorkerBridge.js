const EventBus =
require("../../CORE/CANONICAL/EventBus");


class EngineeringWorkerBridge {

    constructor() {

        this.dispatched = [];

    }


    dispatch(project) {

        const task = {

            taskId:
                `ENG-${Date.now()}`,

            title:
                project.title,

            priority:
                project.priority,

            assignedWorker:
                project.assignedWorker,

            source:
                "Engineering Department",

            created:
                new Date().toISOString()

        };


        this.dispatched.push(task);


        EventBus.publish(
            "worker.task.created",
            task
        );


        return task;

    }


    history(){

        return this.dispatched;

    }


}


module.exports = EngineeringWorkerBridge;