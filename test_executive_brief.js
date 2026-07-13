const ExecutiveIntelligenceService = require("./SERVICES/ExecutiveIntelligenceService");
const ExecutiveBriefService = require("./SERVICES/ExecutiveBriefService");

(async () => {
    const intelligence = new ExecutiveIntelligenceService();

    await intelligence.refresh();

    const state = intelligence.getExecutiveState();

    const brief = new ExecutiveBriefService(state);

    console.log(brief.toMarkdown());
})();