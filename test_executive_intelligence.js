const ExecutiveIntelligenceService =
require("./SERVICES/ExecutiveIntelligenceService");

(async () => {

    const executive = new ExecutiveIntelligenceService();

    await executive.refresh();

    console.log(
        JSON.stringify(
            executive.getExecutiveState(),
            null,
            2
        )
    );

})();