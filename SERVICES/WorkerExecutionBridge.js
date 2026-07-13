"use strict";

const commandQueue =
require("../CORE/CommandQueue");


class WorkerExecutionBridge {


    constructor() {

        this.registry =
require("./WorkerRegistry");

    }


    register(name, worker) {

    return this.registry.register(
        name,
        worker
    );

}


    executeNext() {


        const task =
            commandQueue.claim("WorkerExecutionBridge");


        if (!task) {

            return {
                status:"NO_TASK"
            };

        }


        const worker =
        this.registry.get(task.type);


        if (!worker) {

            commandQueue.fail(
                task.id,
                new Error(
                    `No worker registered for ${task.type}`
                )
            );


            return {

                status:"FAILED",

                reason:
                `No worker: ${task.type}`

            };

        }


        try {


            const result =
                worker.execute(task);


            commandQueue.complete(
                task.id,
                result
            );


            return {

                status:"COMPLETED",

                task,

                result

            };


        } catch(error){


            commandQueue.fail(
                task.id,
                error
            );


            return {

                status:"FAILED",

                error:error.message

            };

        }


    }


}


module.exports = WorkerExecutionBridge;