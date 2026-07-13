const AutonomousCOOLoopService = require("./SERVICES/AutonomousCOOLoopService");

(async () => {
    const loop = new AutonomousCOOLoopService({
        maxCycles: 1,
        intervalMs: 1000
    });

    const result = await loop.start();

    console.log(JSON.stringify(result, null, 2));
})();
