const COOOrchestratorService = require("./SERVICES/COOOrchestratorService");

(async () => {
    const orchestrator = new COOOrchestratorService({
        executeRuntimeTasks: false
    });

    const result = await orchestrator.runOnce();

    console.log(JSON.stringify({
        ok: result.ok,
        service: result.service,
        businessHealth: result.businessHealth,
        generatedWorkCount: result.generatedWorkCount,
        workflowResults: result.workflowResults,
        executionResults: result.executionResults,
        openWorkCount: result.openWorkCount,
        escalations: result.escalations
    }, null, 2));
})();
