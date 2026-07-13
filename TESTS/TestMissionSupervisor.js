const supervisor =
require("../SERVICES/MissionSupervisor");


console.log(
JSON.stringify(
supervisor.summarize(),
null,
2
)
);