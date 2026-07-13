"use strict";

module.exports = {

    execute(task){

        return {

            worker:"VALIDATOR",

            completed:true,

            output:
            `Validation completed for: ${task.title}`,

            taskId:task.id

        };

    }

};