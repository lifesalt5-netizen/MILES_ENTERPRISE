const supervisor = require("./CORE/Supervisor");

supervisor.start(60000);

process.on("SIGINT", () => {

    supervisor.stop();

    process.exit(0);

});