"use strict";

class TesterAdapter {

    constructor() {
        this.name = "TESTER";
    }


    execute(task) {

        return {
            worker: this.name,
            completed: true,
            task: task.title,
            validation: "PASSED",
            testedAt: new Date().toISOString()
        };

    }

}


module.exports = TesterAdapter;