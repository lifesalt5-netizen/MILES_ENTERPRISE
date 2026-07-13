"use strict";

const BusinessWorker =
require("../SERVICES/BusinessWorker");

console.log("\n=== BUILD 046 Business Worker ===\n");

class MockBrowserWorker extends BusinessWorker {

    constructor() {

        super("MockBrowserWorker","Browser");

    }

}

const worker =
new MockBrowserWorker();

console.log(worker.initialize());

console.log(worker.connect());

console.log(worker.getStatus());

const result =
worker.execute({

    type:"browser_task"

});

console.log(result);

console.log(worker.disconnect());

if(!result.ok)
    process.exit(1);

console.log("\nPASS\n");