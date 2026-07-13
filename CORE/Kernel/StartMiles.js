const kernel = require("./MilesKernel");

kernel.start();

process.on("SIGINT", () => {
    console.log("");
    console.log("MILES shutting down.");
    process.exit(0);
});